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

export function createAccessToken(user: { id: string; role: string; email: string }) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: env.ACCESS_TOKEN_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
  );
}

export function createRefreshToken(user: { id: string; role: string; email: string }) {
  // using same secret for simplicity; can be a separate secret
  return jwt.sign(
    { sub: user.id },
    JWT_SECRET,
    { expiresIn: env.REFRESH_TOKEN_EXPIRES_IN as jwt.SignOptions["expiresIn"] }
  );
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, JWT_SECRET) as { sub: string; role: string; email: string; iat: number; exp: number };
}
