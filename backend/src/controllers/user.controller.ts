import { Request, Response } from "express";
import { z } from "zod";
import { User } from "../models/user.model.js";
import { hashPassword } from "../services/auth.service.js";

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["staff", "client"]),
  name: z.string().optional()
});

export async function listUsers(_req: Request, res: Response): Promise<Response> {
  const users = await User.find()
    .select("email role name isVerified userStatus hasSeenWelcome lockedUntil")
    .lean()
    .exec();
  return res.status(200).json({ success: true, users });
}

export async function createUser(req: Request, res: Response): Promise<Response> {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.format() });

  const { email, password, role, name } = parsed.data;

  const existing = await User.findOne({ email }).exec();
  if (existing) return res.status(409).json({ success: false, message: "User already exists" });

  const passwordHash = await hashPassword(password);

  const user = await User.create({ email, passwordHash, role, name, isVerified: true });

  return res.status(201).json({ success: true, user: { id: user._id, email: user.email, role: user.role, name: user.name } });
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

  user.userStatus = parsed.data.status;
  if (parsed.data.status === "active") {
    user.lockedUntil = null;
    user.failedLoginAttempts = 0;
  }
  await user.save();

  return res.status(200).json({ success: true, user: { _id: user._id, email: user.email, role: user.role, name: user.name, isVerified: user.isVerified, userStatus: user.userStatus, hasSeenWelcome: user.hasSeenWelcome, lockedUntil: user.lockedUntil } });
}

export async function changeRole(req: Request, res: Response): Promise<Response> {
  const { id } = req.params;
  const { role } = req.body as { role?: string };
  if (!role || !["admin", "staff", "client"].includes(role)) {
    return res.status(400).json({ success: false, message: "Invalid role" });
  }

  const user = await User.findById(id).exec();
  if (!user) return res.status(404).json({ success: false });

  user.role = role as any;
  await user.save();

  return res.status(200).json({ success: true });
}
