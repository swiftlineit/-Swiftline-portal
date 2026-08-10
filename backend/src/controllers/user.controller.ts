import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Branch } from "../models/branch.model.js";
import { assignableRoleValues, roleValues, User } from "../models/user.model.js";
import { hashPassword } from "../services/auth.service.js";
import { endSessions } from "../services/userSession.service.js";
import { syncAccessWithUserStatus } from "../services/userStatusSync.service.js";
import { validateAssignedBranches } from "../utils/assignedBranches.js";
import { normalizePortalRole } from "../utils/portalRole.js";
import { serializeStaffProfile } from "./staff.controller.js";

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(assignableRoleValues),
  name: z.string().optional(),
  assignedBranches: z.array(z.string()).optional().default([])
});

export async function listUsers(_req: Request, res: Response): Promise<Response> {
  const users = await User.find()
    .select("email role name firstName lastName phone isVerified userStatus hasSeenWelcome lockedUntil assignedBranches staffProfile profileImage")
    .populate("assignedBranches", "name code status")
    .lean()
    .exec();
  return res.status(200).json({
    success: true,
    users: users.map((user) => ({
      ...user,
      role: normalizePortalRole(user.role),
      hasProfileImage: Boolean(user.profileImage?.storageKey),
      assignedBranches: user.assignedBranches ?? [],
      // Serialized rather than passed through: it masks the Aadhaar number and
      // drops the document storage keys.
      staffProfile: serializeStaffProfile(user.staffProfile)
    }))
  });
}

export async function createUser(req: Request, res: Response): Promise<Response> {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.format() });

  const { email, password, role, name, assignedBranches } = parsed.data;

  const existing = await User.findOne({ email }).exec();
  if (existing) return res.status(409).json({ success: false, message: "User already exists" });

  const passwordHash = await hashPassword(password);

  const branchIds = await validateAssignedBranches(assignedBranches);
  if (!branchIds) return res.status(400).json({ success: false, message: "Select valid active branches." });
  const user = await User.create({
    email,
    passwordHash,
    role,
    name,
    isVerified: true,
    assignedBranches: role === "client" ? [] : branchIds
  });

  return res.status(201).json({ success: true, user: { id: user._id, email: user.email, role: user.role, name: user.name, assignedBranches: user.assignedBranches } });
}

export async function unlockUser(req: Request, res: Response): Promise<Response> {
  const { id } = req.params;
  const user = await User.findById(id).exec();
  if (!user) return res.status(404).json({ success: false });

  user.lockedUntil = null;
  user.failedLoginAttempts = 0;
  await user.save();

  return res.status(200).json({ success: true });
}

const updateUserStatusSchema = z.object({
  status: z.enum(["invited", "active", "suspended", "disabled"])
});

export async function updateUserStatus(req: Request, res: Response): Promise<Response> {
  const { id } = req.params;
  const parsed = updateUserStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.format() });

  const user = await User.findById(id).exec();
  if (!user) return res.status(404).json({ success: false });

  // Suspending or disabling your own login could lock the portal's last
  // administrator out, so the change is refused on your own record.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requesterId = (req as any).user?._id;
  if (requesterId && String(requesterId) === String(user._id) && parsed.data.status !== user.userStatus) {
    return res.status(400).json({
      success: false,
      message: "You cannot change your own login status. Ask another administrator to do it."
    });
  }

  user.userStatus = parsed.data.status;
  if (parsed.data.status === "active") {
    user.lockedUntil = null;
    user.failedLoginAttempts = 0;
  }
  await user.save();

  // Their driver profile or client-access record shows the status the rest of the
  // portal reads, so it has to follow the login rather than drift out of step.
  await syncAccessWithUserStatus(user._id as mongoose.Types.ObjectId, user.userStatus);

  // Blocking a login has to end the sessions already open under it. The status
  // check in `attachUser` would catch them on their next request anyway, but
  // ending the sessions is what makes the audit log record the moment access was
  // actually withdrawn, and what the admin session list then reflects.
  if (user.userStatus !== "active") {
    await endSessions(
      { userId: user._id },
      "terminated_by_admin",
      requesterId ? new mongoose.Types.ObjectId(String(requesterId)) : undefined
    );
  }

  await user.populate("assignedBranches", "name code status");

  return res.status(200).json({
    success: true,
    user: {
      _id: user._id,
      email: user.email,
      role: normalizePortalRole(user.role),
      name: user.name,
      isVerified: user.isVerified,
      userStatus: user.userStatus,
      hasSeenWelcome: user.hasSeenWelcome,
      lockedUntil: user.lockedUntil,
      assignedBranches: user.assignedBranches
    }
  });
}

const accessSchema = z.object({
  role: z.enum(roleValues),
  assignedBranches: z.array(z.string()).default([])
});

export async function listUserBranchOptions(_req: Request, res: Response): Promise<Response> {
  const branches = await Branch.find({ status: "ACTIVE" }).select("name code").sort({ name: 1 }).lean().exec();
  return res.status(200).json({
    success: true,
    branches: branches.map((branch) => ({ id: String(branch._id), name: branch.name, code: branch.code }))
  });
}

export async function updateUserAccess(req: Request, res: Response): Promise<Response> {
  const { id } = req.params;
  const parsed = accessSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Select a valid role and branch access." });

  const user = await User.findById(id).exec();
  if (!user) return res.status(404).json({ success: false });

  const branchIds = await validateAssignedBranches(parsed.data.assignedBranches);
  if (!branchIds) return res.status(400).json({ success: false, message: "Select valid active branches." });

  user.role = parsed.data.role;
  user.assignedBranches = ["admin", "client"].includes(parsed.data.role) ? [] : branchIds;
  await user.save();

  await user.populate("assignedBranches", "name code status");
  return res.status(200).json({
    success: true,
    user: {
      _id: user._id,
      email: user.email,
      role: user.role,
      name: user.name,
      isVerified: user.isVerified,
      userStatus: user.userStatus,
      hasSeenWelcome: user.hasSeenWelcome,
      lockedUntil: user.lockedUntil,
      assignedBranches: user.assignedBranches
    }
  });
}
