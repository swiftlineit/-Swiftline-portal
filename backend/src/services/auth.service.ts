import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { IUser } from "../models/user.model.js";

const SALT_ROUNDS = 10;
const JWT_SECRET = env.JWT_SECRET as jwt.Secret;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// `sid` ties a token to a server-side session record, which is what makes
// "one device at a time" expressible at all- a stateless token stays valid
// until it expires no matter what happens elsewhere. It is optional so tokens
// issued before sessions existed keep working until they lapse.
export function createAccessToken(user: { id: string; role: string; email: string }, sessionId?: string) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, ...(sessionId ? { sid: sessionId } : {}) },
    JWT_SECRET,
    { expiresIn: env.ACCESS_TOKEN_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
  );
}

export function createRefreshToken(user: { id: string; role: string; email: string }, sessionId?: string) {
  // using same secret for simplicity; can be a separate secret
  return jwt.sign(
    { sub: user.id, ...(sessionId ? { sid: sessionId } : {}) },
    JWT_SECRET,
    { expiresIn: env.REFRESH_TOKEN_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
  );
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, JWT_SECRET) as {
    sub: string;
    role: string;
    email: string;
    sid?: string;
    iat: number;
    exp: number;
  };
}
