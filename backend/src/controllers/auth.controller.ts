import { Request, Response } from "express";
import { z } from "zod";
import { OAuth2Client } from "google-auth-library";
import { User } from "../models/user.model.js";
import { comparePassword, createAccessToken, createRefreshToken, hashPassword } from "../services/auth.service.js";
import { verifyRecaptcha } from "../services/recaptcha.service.js";
import { env } from "../config/env.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { AuditLog } from "../models/auditLog.model.js";
import { BusinessAccountInvitation } from "../models/businessAccountInvitation.model.js";
import { BusinessAccountMember } from "../models/businessAccountMember.model.js";
import { sendPasswordResetEmail } from "../services/mail.service.js";
import { normalizePortalRole } from "../utils/portalRole.js";

const googleClient = env.GOOGLE_OAUTH_CLIENT_ID ? new OAuth2Client(env.GOOGLE_OAUTH_CLIENT_ID) : null;

// Same message for "no such user", "invited but not activated", and "suspended/disabled"
// so a failed Google sign-in can't be used to probe which emails exist in the system.
const GOOGLE_LOGIN_GENERIC_ERROR = "Unable to sign in with Google for this account. Use your password, or contact your administrator.";

// Cross-site delivery (frontend and API on different HTTPS origins, e.g. devtunnels)
// requires SameSite=None; Secure, or the browser drops the refresh cookie. Same-origin
// / localhost keeps the stricter Lax cookie.
const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.CROSS_SITE_COOKIES || env.NODE_ENV === "production",
  sameSite: (env.CROSS_SITE_COOKIES ? "none" : "lax") as "none" | "lax",
  maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  termsAccepted: z.boolean().refine((v) => v === true, { message: "Terms must be accepted" }),
  recaptchaToken: z.string().optional()
});
const googleLoginSchema = z.object({
  credential: z.string().trim().min(20)
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

  const { email, password, recaptchaToken } = parse.data;

  if (!await verifyRecaptcha(recaptchaToken, req.ip)) {
    return res.status(400).json({ success: false, message: "Captcha verification failed. Please try again." });
  }

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
  res.cookie("refreshToken", refreshToken, refreshCookieOptions());

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

/**
 * "Sign in with Google" for an EXISTING user only - it never creates a new account.
 * A verified Google email is auto-linked (googleId set) to a matching active user on
 * first use; invited/suspended/disabled/not-found accounts all get the same generic
 * error so the response can't be used to enumerate which emails have accounts.
 */
export async function loginWithGoogle(req: Request, res: Response): Promise<Response> {
  if (!googleClient || !env.GOOGLE_OAUTH_CLIENT_ID) {
    return res.status(503).json({ success: false, message: "Google sign-in is not configured." });
  }

  const parsed = googleLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, errors: parsed.error.format() });
  }

  let googleEmail: string;
  let googleSub: string;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: parsed.data.credential,
      audience: env.GOOGLE_OAUTH_CLIENT_ID
    });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.email_verified || !payload.sub) {
      return res.status(401).json({ success: false, message: GOOGLE_LOGIN_GENERIC_ERROR });
    }
    googleEmail = payload.email.toLowerCase();
    googleSub = payload.sub;
  } catch {
    return res.status(401).json({ success: false, message: GOOGLE_LOGIN_GENERIC_ERROR });
  }

  // A user already linked to this Google account can sign in directly; otherwise
  // fall back to matching by email so a first-time Google sign-in can be linked below.
  let user = await User.findOne({ googleId: googleSub }).exec();
  const alreadyLinked = Boolean(user);
  if (!user) user = await User.findOne({ email: googleEmail }).exec();

  // Reject (same generic message either way): no matching account, the account
  // isn't active yet (invited/suspended/disabled), or the email already belongs
  // to a DIFFERENT linked Google account than the one signing in right now.
  if (!user || user.userStatus !== "active" || (!alreadyLinked && user.googleId)) {
    return res.status(401).json({ success: false, message: GOOGLE_LOGIN_GENERIC_ERROR });
  }

  if (user.googleId !== googleSub) {
    const userId = user._id;
    // Atomic + still guarded by the unique index, so a concurrent link attempt
    // (from this same request racing itself, or a stale duplicate) can't corrupt state.
    try {
      const linked = await User.findOneAndUpdate(
        { _id: userId, googleId: null },
        { $set: { googleId: googleSub } },
        { new: true }
      ).exec();
      user = linked ?? await User.findById(userId).exec();
    } catch {
      // Duplicate-key on googleId means another user already claimed this Google
      // account - re-read rather than fail so a benign race doesn't 500.
      user = await User.findById(userId).exec();
    }
    if (!user || user.googleId !== googleSub) {
      return res.status(401).json({ success: false, message: GOOGLE_LOGIN_GENERIC_ERROR });
    }
    await AuditLog.create({
      action: "USER_GOOGLE_LOGIN_LINKED",
      entityType: "USER",
      entityId: user._id,
      performedBy: user._id,
      performedAt: new Date(),
      metadata: { email: user.email }
    });
  }

  const role = normalizePortalRole(user.role);
  if (user.role !== role) user.role = role;
  user.lastLogin = new Date();
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  const accessToken = createAccessToken({ id: String(user._id), role, email: user.email });
  const refreshToken = createRefreshToken({ id: String(user._id), role, email: user.email });
  res.cookie("refreshToken", refreshToken, refreshCookieOptions());

  return res.status(200).json({
    success: true,
    accessToken,
    user: {
      id: user._id,
      email: user.email,
      role,
      name: user.name,
      userStatus: user.userStatus,
      hasSeenWelcome: user.hasSeenWelcome
    }
  });
}

export async function logout(_req: Request, res: Response): Promise<Response> {
  // Clearing must use the same sameSite/secure flags the cookie was set with.
  const { maxAge: _maxAge, ...clearOptions } = refreshCookieOptions();
  res.clearCookie("refreshToken", clearOptions);
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

    res.cookie("refreshToken", refreshToken, refreshCookieOptions());

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
