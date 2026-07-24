import mongoose from "mongoose";

export const roleValues = ["admin", "operations", "accounts", "delivery", "hr", "client"] as const;
export const assignableRoleValues = ["operations", "accounts", "delivery", "hr", "client"] as const;
export type Role = (typeof roleValues)[number];
export type UserStatus = "invited" | "active" | "suspended" | "disabled";

export interface IUser extends mongoose.Document {
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  passwordHash?: string;
  name?: string;
  role: Role;
  assignedBranches: mongoose.Types.ObjectId[];
  userStatus: UserStatus;
  isVerified: boolean;
  emailVerifiedAt?: Date | null;
  invitedBy?: mongoose.Types.ObjectId | null;
  hasSeenWelcome: boolean;
  failedLoginAttempts: number;
  lockedUntil?: Date | null;
  lastLogin?: Date | null;
  passwordResetTokenHash?: string;
  passwordResetExpiresAt?: Date | null;
}

const userSchema = new mongoose.Schema<IUser>(
  {
    firstName: { type: String, trim: true, default: "" },
    lastName: { type: String, trim: true, default: "" },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, default: "" },
    passwordHash: { type: String, default: "" },
    name: { type: String, trim: true, default: "" },
    role: {
      type: String,
      enum: [...roleValues, "staff"],
      default: "client",
      set: (value: string) => value === "staff" ? "operations" : value
    },
    assignedBranches: [{ type: mongoose.Schema.Types.ObjectId, ref: "Branch" }],
    userStatus: { type: String, enum: ["invited", "active", "suspended", "disabled"], default: "active", index: true },
    isVerified: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date, default: null },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    hasSeenWelcome: { type: Boolean, default: false },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLogin: { type: Date, default: null },
    passwordResetTokenHash: { type: String, default: "", select: false },
    passwordResetExpiresAt: { type: Date, default: null, select: false }
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", userSchema);
