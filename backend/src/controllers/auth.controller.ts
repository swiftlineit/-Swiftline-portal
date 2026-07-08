import { Request, Response } from "express";
import { z } from "zod";
import { User } from "../models/user.model.js";
import { comparePassword, createAccessToken, createRefreshToken } from "../services/auth.service.js";
import { env } from "../config/env.js";
import jwt from "jsonwebtoken";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  termsAccepted: z.boolean().refine((v) => v === true, { message: "Terms must be accepted" })
});

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

  const accessToken = createAccessToken({ id: String(user._id), role: user.role, email: user.email });
  const refreshToken = createRefreshToken({ id: String(user._id), role: user.role, email: user.email });

  // set httpOnly secure cookie for refresh token
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  });

  return res.status(200).json({ success: true, accessToken, user: { id: user._id, email: user.email, role: user.role, name: user.name, hasSeenWelcome: user.hasSeenWelcome } });
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

    const accessToken = createAccessToken({ id: String(user._id), role: user.role, email: user.email });
    const refreshToken = createRefreshToken({ id: String(user._id), role: user.role, email: user.email });

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
