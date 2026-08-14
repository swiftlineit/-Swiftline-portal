import crypto from "crypto";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { env } from "../config/env.js";
import { Branch } from "../models/branch.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { BusinessAccountInvitation } from "../models/businessAccountInvitation.model.js";
import {
  BusinessAccountMember,
  businessAccountMemberRoleValues,
  IBusinessAccountMember
} from "../models/businessAccountMember.model.js";
import { IUser, User } from "../models/user.model.js";
import { sendClientInvitationEmail } from "../services/mail.service.js";
import { normalizeUserPhone } from "../services/userIdentity.service.js";
import { syncUserStatusWithMembership } from "../services/userStatusSync.service.js";

const invitationLifetimeMs = 24 * 60 * 60 * 1000;

const createClientAccessSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().toLowerCase(),
  phone: z.string().trim().min(8, "Enter the phone number in international format.").max(30),
  role: z.enum(businessAccountMemberRoleValues),
  assignedBranches: z.array(z.string().trim()).optional().default([]),
  sendInvitationEmail: z.boolean().optional().default(true)
});

function getAuthenticatedUserId(request: Request): mongoose.Types.ObjectId | null {
  const user = (request as Request & { user?: { _id?: unknown } }).user;
  const id = user?._id;

  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) return null;
  return new mongoose.Types.ObjectId(String(id));
}

function hashInvitationToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createInvitationToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function buildActivationUrl(token: string) {
  return `${env.CLIENT_URL.replace(/\/$/, "")}/auth/activate?token=${encodeURIComponent(token)}`;
}

function formatUserName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim();
}

function isClientAccessAllowed(account: Awaited<ReturnType<typeof BusinessAccount.findOne>>) {
  return Boolean(
    account
    && ["approved", "active"].includes(account.status)
    && account.kycReview?.overallStatus === "verified"
  );
}

async function resolveClientAccessBranch(account: Awaited<ReturnType<typeof BusinessAccount.findOne>>, branchIds: string[]) {
  if (!account?.assignedBranch) {
    throw new Error("Assign a branch to this business account before creating client access.");
  }

  const uniqueBranchIds = [...new Set(branchIds.filter(Boolean))];
  const assignedBranchId = String(account.assignedBranch);

  if (uniqueBranchIds.some((branchId) => !mongoose.Types.ObjectId.isValid(branchId))) {
    throw new Error("Invalid assigned branch.");
  }

  if (uniqueBranchIds.length > 1) {
    throw new Error("Client access can only use the business account assigned branch.");
  }

  if (uniqueBranchIds[0] && uniqueBranchIds[0] !== assignedBranchId) {
    throw new Error("Client access branch must match the business account assigned branch.");
  }

  const branchExists = await Branch.exists({ _id: account.assignedBranch }).exec();
  if (!branchExists) throw new Error("The assigned business account branch does not exist.");

  return [new mongoose.Types.ObjectId(assignedBranchId)];
}

async function createInvitation(
  member: IBusinessAccountMember,
  createdBy: mongoose.Types.ObjectId
) {
  // Only one pending invitation should be usable for a member at a time.
  await BusinessAccountInvitation.updateMany(
    { member: member._id, acceptedAt: null, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  ).exec();

  const token = createInvitationToken();
  const invitation = await BusinessAccountInvitation.create({
    user: member.user,
    businessAccount: member.businessAccount,
    member: member._id,
    tokenHash: hashInvitationToken(token),
    expiresAt: new Date(Date.now() + invitationLifetimeMs),
    createdBy
  });

  return {
    invitation,
    activationUrl: buildActivationUrl(token)
  };
}

async function deliverInvitationEmail(input: {
  user: Pick<IUser, "email" | "firstName" | "lastName" | "name">;
  companyName: string;
  activationUrl: string;
  expiresAt: Date;
}) {
  const displayName = input.user.name || formatUserName(input.user.firstName ?? "", input.user.lastName ?? "");

  return sendClientInvitationEmail({
    to: input.user.email,
    name: displayName,
    companyName: input.companyName,
    activationUrl: input.activationUrl,
    expiresAt: input.expiresAt
  });
}

async function serializeMember(member: IBusinessAccountMember) {
  const invitation = await BusinessAccountInvitation.findOne({
    member: member._id,
    acceptedAt: null,
    revokedAt: null
  })
    .sort({ createdAt: -1 })
    .lean()
    .exec();

  const rawUser = member.user && typeof member.user === "object"
    ? member.user as unknown as Partial<IUser> & { _id?: mongoose.Types.ObjectId }
    : null;
  const rawBranches = Array.isArray(member.assignedBranches)
    ? member.assignedBranches as unknown as Array<{ _id?: mongoose.Types.ObjectId; name?: string; code?: string } | mongoose.Types.ObjectId | null>
    : [];

  return {
    _id: String(member._id),
    role: member.role,
    status: member.status,
    joinedAt: member.joinedAt ?? null,
    createdAt: member.createdAt,
    user: {
      _id: String(rawUser?._id ?? member.user ?? ""),
      firstName: rawUser?.firstName ?? "",
      lastName: rawUser?.lastName ?? "",
      name: rawUser?.name ?? "",
      email: rawUser?.email ?? "",
      phone: rawUser?.phone ?? "",
      userStatus: rawUser?.userStatus ?? "active",
      lastLogin: rawUser?.lastLogin ?? null
    },
    assignedBranches: rawBranches
      .filter((branch): branch is { _id?: mongoose.Types.ObjectId; name?: string; code?: string } | mongoose.Types.ObjectId => Boolean(branch))
      .map((branch) => {
        const branchDocument = branch && typeof branch === "object" && "_id" in branch
          ? branch
          : { _id: branch as mongoose.Types.ObjectId };

        return {
          _id: String(branchDocument._id ?? ""),
          name: "name" in branchDocument ? branchDocument.name ?? "" : "",
          code: "code" in branchDocument ? branchDocument.code ?? "" : ""
        };
      }),
    invitation: invitation ? {
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt ?? null,
      revokedAt: invitation.revokedAt ?? null
    } : null
  };
}

export async function listBusinessAccountMembers(request: Request, response: Response): Promise<Response> {
  const account = await BusinessAccount.findOne({ accountId: request.params.accountId }).select("_id").lean().exec();

  if (!account) {
    return response.status(404).json({ success: false, message: "Business account not found." });
  }

  const members = await BusinessAccountMember.find({ businessAccount: account._id })
    .populate("user", "firstName lastName name email phone userStatus lastLogin")
    .populate("assignedBranches", "name code")
    .sort({ createdAt: -1 })
    .exec();

  return response.status(200).json({
    success: true,
    members: await Promise.all(members.map(serializeMember))
  });
}

export type GrantClientAccessResult =
  | {
    ok: true;
    member: Awaited<ReturnType<typeof serializeMember>> | null;
    emailQueued: boolean;
    emailSent: boolean;
    emailSkipped: boolean;
    emailError?: string;
  }
  | { ok: false; status: number; message: string; code?: string };

/**
 * Creates a client login, its membership and its password invitation.
 *
 * Extracted from the HTTP handler so that approving a customer's access
 * request runs exactly these rules — the account and KYC gate, the global
 * identity check, the invitation email — rather than a second implementation
 * of who is allowed to sign in to Swiftline. Both callers are thin wrappers.
 *
 * Returns a result rather than writing a response, because one caller answers
 * a request for this action and the other answers a request to approve one.
 */
export async function grantClientAccess(input: {
  accountId: string;
  data: z.infer<typeof createClientAccessSchema>;
  adminId: mongoose.Types.ObjectId;
}): Promise<GrantClientAccessResult> {
  const { data, adminId } = input;

  const account = await BusinessAccount.findOne({ accountId: input.accountId }).exec();
  if (!account) return { ok: false, status: 404, message: "Business account not found." };

  if (!isClientAccessAllowed(account)) {
    return {
      ok: false,
      status: 409,
      message: "Client login can be created only after account approval and KYC verification."
    };
  }

  let assignedBranches: mongoose.Types.ObjectId[];
  try {
    assignedBranches = await resolveClientAccessBranch(account, data.assignedBranches);
  } catch (error) {
    return { ok: false, status: 400, message: error instanceof Error ? error.message : "Invalid assigned branches." };
  }

  const normalizedPhone = normalizeUserPhone(data.phone);
  if (!normalizedPhone) {
    return {
      ok: false,
      status: 400,
      message: "Enter a valid phone number in international format, for example +919876543210."
    };
  }

  // A login is one global identity. Existing users are restored through their
  // original business account; they are never silently reused for another one.
  const existingUser = await User.findOne({
    $or: [{ email: data.email }, { phone: normalizedPhone }]
  }).select("email phone").lean().exec();
  if (existingUser) {
    const emailExists = existingUser.email === data.email;
    return {
      ok: false,
      status: 409,
      code: emailExists ? "USER_EMAIL_EXISTS" : "USER_PHONE_EXISTS",
      message: emailExists
        ? "A user with this email address already exists. Restore their existing access instead of creating another login."
        : "A user with this phone number already exists. Restore their existing access instead of creating another login."
    };
  }

  let user: InstanceType<typeof User>;
  try {
    user = await User.create({
      firstName: data.firstName,
      lastName: data.lastName,
      name: formatUserName(data.firstName, data.lastName),
      email: data.email,
      phone: normalizedPhone,
      role: "client",
      userStatus: "invited",
      isVerified: false,
      invitedBy: adminId
    });
  } catch (error) {
    // The unique indexes close the race where two invitations pass the preflight
    // together. Map that database error to the same friendly contract.
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
      const phoneConflict = Boolean(error.keyPattern?.phone);
      return {
        ok: false,
        status: 409,
        code: phoneConflict ? "USER_PHONE_EXISTS" : "USER_EMAIL_EXISTS",
        message: phoneConflict
          ? "A user with this phone number already exists. Restore their existing access instead of creating another login."
          : "A user with this email address already exists. Restore their existing access instead of creating another login."
      };
    }
    throw error;
  }

  const member = await BusinessAccountMember.create({
    businessAccount: account._id,
    user: user._id,
    role: data.role,
    assignedBranches,
    status: "invited",
    invitedBy: adminId
  });

  const { invitation, activationUrl } = await createInvitation(member, adminId);
  let emailDelivery = { sent: false, skipped: !data.sendInvitationEmail };
  let emailError = "";

  if (data.sendInvitationEmail) {
    try {
      emailDelivery = await deliverInvitationEmail({
        user,
        companyName: account.company.companyName,
        activationUrl,
        expiresAt: invitation.expiresAt
      });
    } catch (error) {
      // The member and invitation already exist. A failed email must not fail the
      // whole request, or the admin is stranded (a retry hits "already has access").
      // The link can still be delivered manually via the copy-link action.
      emailError = error instanceof Error ? error.message : "Invitation email could not be sent.";
    }
  }

  const populatedMember = await BusinessAccountMember.findById(member._id)
    .populate("user", "firstName lastName name email phone userStatus lastLogin")
    .populate("assignedBranches", "name code")
    .exec();

  return {
    ok: true,
    member: populatedMember ? await serializeMember(populatedMember) : null,
    emailQueued: data.sendInvitationEmail,
    emailSent: emailDelivery.sent,
    emailSkipped: emailDelivery.skipped,
    emailError: emailError || undefined
  };
}

export async function createBusinessAccountClientAccess(request: Request, response: Response): Promise<Response> {
  const parsed = createClientAccessSchema.safeParse(request.body);

  if (!parsed.success) {
    return response.status(400).json({ success: false, errors: parsed.error.format() });
  }

  const adminId = getAuthenticatedUserId(request);
  if (!adminId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const result = await grantClientAccess({
    accountId: String(request.params.accountId),
    data: parsed.data,
    adminId
  });

  if (!result.ok) {
    return response.status(result.status).json({
      success: false,
      message: result.message,
      ...(result.code ? { code: result.code } : {})
    });
  }

  // The activation URL (which carries the raw token) is intentionally not returned
  // here; it is only exposed through the explicit copy-link endpoint.
  return response.status(201).json({
    success: true,
    member: result.member,
    emailQueued: result.emailQueued,
    emailSent: result.emailSent,
    emailSkipped: result.emailSkipped,
    emailError: result.emailError
  });
}

export async function resendBusinessAccountInvitation(request: Request, response: Response): Promise<Response> {
  const adminId = getAuthenticatedUserId(request);
  if (!adminId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const account = await BusinessAccount.findOne({ accountId: request.params.accountId }).select("_id company.companyName").exec();
  if (!account) {
    return response.status(404).json({ success: false, message: "Business account not found." });
  }

  const member = await BusinessAccountMember.findById(request.params.memberId)
    .populate("user", "firstName lastName name email")
    .exec();

  if (!member || member.status === "removed") {
    return response.status(404).json({ success: false, message: "Account member not found." });
  }

  if (String(member.businessAccount) !== String(account._id)) {
    return response.status(404).json({ success: false, message: "Account member not found." });
  }

  if (member.status === "active") {
    return response.status(409).json({ success: false, message: "This member has already activated access." });
  }

  const { invitation, activationUrl } = await createInvitation(member, adminId);
  const invitedUser = member.user as unknown as Pick<IUser, "email" | "firstName" | "lastName" | "name">;
  let emailDelivery = { sent: false, skipped: false };
  let emailError = "";

  try {
    emailDelivery = await deliverInvitationEmail({
      user: invitedUser,
      companyName: account.company.companyName,
      activationUrl,
      expiresAt: invitation.expiresAt
    });
  } catch (error) {
    // A fresh invitation was already issued; report the delivery failure without
    // failing the request so the admin can fall back to the copy-link action.
    emailError = error instanceof Error ? error.message : "Invitation email could not be sent.";
  }

  return response.status(200).json({
    success: true,
    emailSent: emailDelivery.sent,
    emailSkipped: emailDelivery.skipped,
    emailError: emailError || undefined
  });
}

// Regenerate an invitation and return its activation URL for manual delivery.
// The raw token is only exposed here, in response to an explicit admin action,
// rather than being included in every create/resend response.
export async function createBusinessAccountInvitationLink(request: Request, response: Response): Promise<Response> {
  const adminId = getAuthenticatedUserId(request);
  if (!adminId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const account = await BusinessAccount.findOne({ accountId: request.params.accountId }).select("_id").exec();
  if (!account) {
    return response.status(404).json({ success: false, message: "Business account not found." });
  }

  const member = await BusinessAccountMember.findById(request.params.memberId).exec();
  if (!member || member.status === "removed" || String(member.businessAccount) !== String(account._id)) {
    return response.status(404).json({ success: false, message: "Account member not found." });
  }

  if (member.status !== "invited") {
    return response.status(409).json({ success: false, message: "An invitation link is only available for members awaiting activation." });
  }

  const { activationUrl } = await createInvitation(member, adminId);
  return response.status(200).json({ success: true, activationUrl });
}

// Suspend, reactivate, or remove a member. Removing or suspending also revokes
// any pending invitation so its token can no longer be used.
const memberStatusUpdateSchema = z.object({
  status: z.enum(["active", "suspended", "removed", "restore"])
});

const memberStatusTransitions: Record<string, string[]> = {
  invited: ["removed"],
  active: ["suspended", "removed"],
  suspended: ["active", "removed"],
  removed: ["active", "invited"]
};

export function resolveRestoredMemberStatus(
  user: Pick<IUser, "isVerified" | "passwordHash">
): "active" | "invited" {
  return user.isVerified && Boolean(user.passwordHash) ? "active" : "invited";
}

export async function updateBusinessAccountMemberStatus(request: Request, response: Response): Promise<Response> {
  const adminId = getAuthenticatedUserId(request);
  if (!adminId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = memberStatusUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ success: false, errors: parsed.error.format() });
  }

  const account = await BusinessAccount.findOne({ accountId: request.params.accountId }).select("_id").exec();
  if (!account) {
    return response.status(404).json({ success: false, message: "Business account not found." });
  }

  const member = await BusinessAccountMember.findById(request.params.memberId).exec();
  if (!member || String(member.businessAccount) !== String(account._id)) {
    return response.status(404).json({ success: false, message: "Account member not found." });
  }

  let targetStatus: "invited" | "active" | "suspended" | "removed";
  if (parsed.data.status === "restore") {
    if (member.status !== "removed") {
      return response.status(409).json({ success: false, message: "Only removed access can be restored." });
    }

    const user = await User.findById(member.user).select("isVerified passwordHash").lean().exec();
    if (!user) {
      return response.status(404).json({ success: false, message: "The existing user record could not be found." });
    }
    targetStatus = resolveRestoredMemberStatus(user);
  } else {
    targetStatus = parsed.data.status;
  }
  if (targetStatus !== member.status && !(memberStatusTransitions[member.status] ?? []).includes(targetStatus)) {
    return response.status(409).json({
      success: false,
      message: `Cannot change member access from ${member.status} to ${targetStatus}.`
    });
  }

  if (targetStatus === "removed" || targetStatus === "suspended") {
    await BusinessAccountInvitation.updateMany(
      { member: member._id, acceptedAt: null, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    ).exec();
  }

  member.status = targetStatus;
  try {
    await member.save();
  } catch (error) {
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
      return response.status(409).json({
        success: false,
        code: "USER_ALREADY_ASSIGNED",
        message: "This user already has current access. Resolve that membership before restoring this one."
      });
    }
    throw error;
  }

  // Access and login are two halves of one decision. Suspending or removing a
  // member leaves them able to sign in but able to reach nothing, so the login is
  // held with the access and released with it.
  await syncUserStatusWithMembership(member.user, member.status);

  const populatedMember = await BusinessAccountMember.findById(member._id)
    .populate("user", "firstName lastName name email phone userStatus lastLogin")
    .populate("assignedBranches", "name code")
    .exec();

  return response.status(200).json({
    success: true,
    member: populatedMember ? await serializeMember(populatedMember) : null
  });
}
