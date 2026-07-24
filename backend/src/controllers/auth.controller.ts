import { Request, Response } from "express";
import { z } from "zod";
import { User } from "../models/user.model.js";
import { comparePassword, createAccessToken, createRefreshToken, hashPassword } from "../services/auth.service.js";
import { env } from "../config/env.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { BusinessAccountInvitation } from "../models/businessAccountInvitation.model.js";
import { BusinessAccountMember } from "../models/businessAccountMember.model.js";
import { sendPasswordResetEmail } from "../services/mail.service.js";
import { normalizePortalRole } from "../utils/portalRole.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  termsAccepted: z.boolean().refine((v) => v === true, { message: "Terms must be accepted" })
});
const activationSchema = z.object({
  token: z.string().trim().min(20),
  password: z.string().min(8).max(128),
  confirmPassword: z.string().min(8).max(128),
  termsAccepted: z.boolean().refine((value) => value === true, { message: "Terms must be accepted" })
}).superRefine((data, context) => {
  if (data.password !== data.confirmPassword) {
    context.addIssue({
      code: "custom",
      path: ["confirmPassword"],
      message: "Passwords do not match"
    });
  }
});
const forgotPasswordSchema = z.object({
  email: z.string().trim().email().toLowerCase()
});
const resetPasswordSchema = z.object({
  token: z.string().trim().min(20),
  password: z.string().min(8).max(128),
  confirmPassword: z.string().min(8).max(128)
}).superRefine((data, context) => {
  if (data.password !== data.confirmPassword) {
    context.addIssue({
      code: "custom",
      path: ["confirmPassword"],
      message: "Passwords do not match"
    });
  }
});

const passwordResetResponse = {
  success: true,
  message: "If an active account exists for this email, a reset link has been sent."
};

function hashInvitationToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashPasswordResetToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function buildPasswordResetUrl(token: string) {
  const url = new URL("/auth/reset-password", env.CLIENT_URL);
  url.searchParams.set("token", token);
  return url.toString();
}

async function findUsableInvitation(token: string) {
  const invitation = await BusinessAccountInvitation.findOne({ tokenHash: hashInvitationToken(token) })
    .populate("user", "email firstName lastName name userStatus")
    .populate("businessAccount", "accountId company.companyName")
    .exec();

  if (!invitation) return { invitation: null, message: "Invalid invitation link." };
  if (invitation.revokedAt) return { invitation: null, message: "This invitation has been revoked." };
  if (invitation.acceptedAt) return { invitation: null, message: "This invitation has already been accepted." };
  if (invitation.expiresAt <= new Date()) return { invitation: null, message: "This invitation has expired." };

  return { invitation, message: "" };
}

export async function login(req: Request, res: Response): Promise<Response> {
  const parse = loginSchema.safeParse(req.body);

  if (!parse.success) {
    return res.status(400).json({ success: false, errors: parse.error.format() });
  }

  const { email, password } = parse.data;

  const user = await User.findOne({ email }).exec();

  if (!user) {
    return res.status(401).json({ success: false, message: "Invalid credentials" });
  }

  const userStatus = user.userStatus ?? "active";
  if (userStatus === "invited" || !user.passwordHash) {
    return res.status(403).json({ success: false, message: "Please activate your account before logging in." });
  }

  if (userStatus === "suspended" || userStatus === "disabled") {
    return res.status(403).json({ success: false, message: "This user login is not active." });
  }

  // check lockout
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return res.status(423).json({ success: false, message: "Account locked. Try later." });
  }

  const match = await comparePassword(password, user.passwordHash);

  if (!match) {
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;

    // lock after 5 attempts
    if (user.failedLoginAttempts >= 5) {
      user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      user.failedLoginAttempts = 0;
    }

    await user.save();

    return res.status(401).json({ success: false, message: "Invalid credentials" });
  }

  // reset failed attempts
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLogin = new Date();
  await user.save();

  const role = normalizePortalRole(user.role);
  if (user.role !== role) {
    user.role = role;
    await user.save();
  }
  const accessToken = createAccessToken({ id: String(user._id), role, email: user.email });
  const refreshToken = createRefreshToken({ id: String(user._id), role, email: user.email });

  // set httpOnly secure cookie for refresh token
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  });

  return res.status(200).json({
    success: true,
    accessToken,
    user: {
      id: user._id,
      email: user.email,
      role,
      name: user.name,
      userStatus,
      hasSeenWelcome: user.hasSeenWelcome
    }
  });
}

export async function logout(_req: Request, res: Response): Promise<Response> {
  res.clearCookie("refreshToken");
  return res.status(200).json({ success: true });
}

export async function me(req: Request, res: Response): Promise<Response> {
  // `attachUser` middleware should have populated req.user
  // but keep a safe fallback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (req as any).user;

  if (!user) return res.status(401).json({ success: false });

  return res.status(200).json({ success: true, user });
}

export async function markWelcomeSeen(req: Request, res: Response): Promise<Response> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (req as any).user;

  if (!user) return res.status(401).json({ success: false });

  await User.findByIdAndUpdate(user._id, { hasSeenWelcome: true }).exec();

  return res.status(200).json({ success: true });
}

export async function refresh(req: Request, res: Response): Promise<Response> {
  try {
    const token = req.cookies?.refreshToken;

    if (!token) return res.status(401).json({ success: false });

    // verify
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = jwt.verify(token, env.JWT_SECRET);

    const user = await User.findById(payload.sub).exec();

    if (!user) return res.status(401).json({ success: false });

    const role = normalizePortalRole(user.role);
    if (user.role !== role) {
      user.role = role;
      await user.save();
    }
    const accessToken = createAccessToken({ id: String(user._id), role, email: user.email });
    const refreshToken = createRefreshToken({ id: String(user._id), role, email: user.email });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7
    });

    return res.status(200).json({ success: true, accessToken });
  } catch (error) {
    return res.status(401).json({ success: false });
  }
}

export async function requestPasswordReset(req: Request, res: Response): Promise<Response> {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, errors: parsed.error.format() });
  }

  const user = await User.findOne({ email: parsed.data.email })
    .select("+passwordResetTokenHash +passwordResetExpiresAt")
    .exec();

  const userStatus = user?.userStatus ?? "active";
  if (!user || !user.passwordHash || userStatus === "invited" || userStatus === "suspended" || userStatus === "disabled") {
    return res.status(200).json(passwordResetResponse);
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  user.passwordResetTokenHash = hashPasswordResetToken(token);
  user.passwordResetExpiresAt = expiresAt;
  await user.save();

  try {
    await sendPasswordResetEmail({
      to: user.email,
      name: user.name || `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
      resetUrl: buildPasswordResetUrl(token),
      expiresAt
    });
  } catch (error) {
    console.error("Password reset email could not be sent.", {
      email: user.email,
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }

  return res.status(200).json(passwordResetResponse);
}

export async function resetPassword(req: Request, res: Response): Promise<Response> {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, errors: parsed.error.format() });
  }

  const tokenHash = hashPasswordResetToken(parsed.data.token);
  const user = await User.findOne({
    passwordResetTokenHash: tokenHash,
    passwordResetExpiresAt: { $gt: new Date() }
  })
    .select("+passwordResetTokenHash +passwordResetExpiresAt")
    .exec();

  if (!user) {
    return res.status(400).json({ success: false, message: "This reset link is invalid or has expired." });
  }

  const userStatus = user.userStatus ?? "active";
  if (userStatus === "suspended" || userStatus === "disabled") {
    return res.status(403).json({ success: false, message: "This user login is not active." });
  }

  user.passwordHash = await hashPassword(parsed.data.password);
  user.passwordResetTokenHash = "";
  user.passwordResetExpiresAt = null;
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.userStatus = "active";
  user.isVerified = true;
  user.emailVerifiedAt = user.emailVerifiedAt ?? new Date();
  await user.save();

  return res.status(200).json({ success: true, message: "Password reset successfully. You can now sign in." });
}

export async function getInvitation(req: Request, res: Response): Promise<Response> {
  const token = typeof req.params.token === "string" ? req.params.token : "";
  if (!token) return res.status(400).json({ success: false, message: "Invitation token is required." });

  const { invitation, message } = await findUsableInvitation(token);
  if (!invitation) return res.status(400).json({ success: false, message });

  const user = invitation.user as unknown as { email?: string; firstName?: string; lastName?: string; name?: string };
  const account = invitation.businessAccount as unknown as { accountId?: string; company?: { companyName?: string } };

  return res.status(200).json({
    success: true,
    invitation: {
      email: user.email ?? "",
      name: user.name || `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
      businessAccountId: account.accountId ?? "",
      companyName: account.company?.companyName ?? "",
      expiresAt: invitation.expiresAt
    }
  });
}

export async function activateInvitation(req: Request, res: Response): Promise<Response> {
  const parsed = activationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, errors: parsed.error.format() });
  }

  const { invitation, message } = await findUsableInvitation(parsed.data.token);
  if (!invitation) return res.status(400).json({ success: false, message });

  const user = await User.findById(invitation.user).exec();
  const member = await BusinessAccountMember.findById(invitation.member).exec();

  if (!user || !member || member.status === "removed") {
    return res.status(400).json({ success: false, message: "Invitation access record is no longer valid." });
  }

  const now = new Date();
  user.passwordHash = await hashPassword(parsed.data.password);
  user.userStatus = "active";
  user.isVerified = true;
  user.emailVerifiedAt = now;
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  member.status = "active";
  member.joinedAt = now;
  invitation.acceptedAt = now;

  await Promise.all([
    user.save(),
    member.save(),
    invitation.save()
  ]);

  return res.status(200).json({ success: true, message: "Account activated successfully." });
}
