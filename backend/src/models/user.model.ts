import mongoose from "mongoose";

export type Role = "admin" | "staff" | "client";

export interface IUser extends mongoose.Document {
  email: string;
  passwordHash: string;
  name?: string;
  role: Role;
  isVerified: boolean;
  hasSeenWelcome: boolean;
  failedLoginAttempts: number;
  lockedUntil?: Date | null;
  lastLogin?: Date | null;
}

const userSchema = new mongoose.Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String },
    role: { type: String, enum: ["admin", "staff", "client"], default: "client" },
    isVerified: { type: Boolean, default: false },
    hasSeenWelcome: { type: Boolean, default: false },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLogin: { type: Date, default: null }
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", userSchema);
