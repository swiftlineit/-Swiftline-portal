import mongoose from "mongoose";

export const roleValues = ["admin", "operations", "finance", "delivery", "hr", "client"] as const;
export const assignableRoleValues = ["operations", "finance", "delivery", "hr", "client"] as const;
// Internal roles below admin. Clients are onboarded through the business-account
// flow instead, so `client` is not a staff role.
export const staffRoleValues = ["operations", "finance", "delivery", "hr"] as const;
// Every internal role a staff record may hold, admin included. The list stays
// permissive on purpose: who may *grant* admin is enforced in the staff
// controller, which only lets an existing admin do it.
export const internalRoleValues = ["admin", ...staffRoleValues] as const;
export type Role = (typeof roleValues)[number];
export type StaffRole = (typeof staffRoleValues)[number];
export type InternalRole = (typeof internalRoleValues)[number];
export type UserStatus = "invited" | "active" | "suspended" | "disabled";

// Role names the product has retired. Documents written before a rename still
// carry the old value, so each stays a valid enum member and is translated on
// write (the schema setter below) and on read (`normalizePortalRole`).
export const legacyRoleReplacements: Record<string, Role> = {
  staff: "operations",
  accounts: "finance"
};

export const staffDocumentTypes = ["aadhaar", "pan", "other"] as const;
export type StaffDocumentType = (typeof staffDocumentTypes)[number];

export interface IStaffDocument {
  type: StaffDocumentType;
  originalName: string;
  storedName: string;
  mimeType: string;
  size: number;
  path: string;
  uploadedAt: Date;
}

export interface IStaffProfile {
  employeeCode?: string;
  designation?: string;
  dateOfJoining: Date;
  dateOfBirth?: Date | null;
  aadhaarNumber: string;
  panNumber?: string;
  address?: {
    line1?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
  emergencyContact?: {
    name?: string;
    phone?: string;
  };
  documents: Partial<Record<StaffDocumentType, IStaffDocument>>;
  createdBy?: mongoose.Types.ObjectId | null;
}

export interface IUser extends mongoose.Document {
  firstName?: string;
  lastName?: string;
  email: string;
  phone?: string;
  passwordHash?: string;
  googleId?: string | null;
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
  loginOtpHash?: string;
  loginOtpExpiresAt?: Date | null;
  loginOtpAttempts?: number;
  loginOtpSentAt?: Date | null;
  staffProfile?: IStaffProfile | null;
}

const staffDocumentSchema = new mongoose.Schema<IStaffDocument>(
  {
    type: { type: String, enum: staffDocumentTypes, required: true },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    path: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

// Employment details captured when an admin adds an internal staff member. It is
// absent on clients and on the accounts that predate the Add Staff form, so every
// reader must treat it as optional.
const staffProfileSchema = new mongoose.Schema<IStaffProfile>(
  {
    employeeCode: { type: String, trim: true, default: "" },
    designation: { type: String, trim: true, default: "" },
    dateOfJoining: { type: Date, required: true },
    dateOfBirth: { type: Date, default: null },
    aadhaarNumber: { type: String, required: true, trim: true },
    panNumber: { type: String, trim: true, uppercase: true, default: "" },
    address: {
      line1: { type: String, trim: true, default: "" },
      city: { type: String, trim: true, default: "" },
      state: { type: String, trim: true, default: "" },
      postalCode: { type: String, trim: true, default: "" }
    },
    emergencyContact: {
      name: { type: String, trim: true, default: "" },
      phone: { type: String, trim: true, default: "" }
    },
    documents: {
      aadhaar: { type: staffDocumentSchema },
      pan: { type: staffDocumentSchema },
      other: { type: staffDocumentSchema }
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { _id: false }
);

const userSchema = new mongoose.Schema<IUser>(
  {
    firstName: { type: String, trim: true, default: "" },
    lastName: { type: String, trim: true, default: "" },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, default: "" },
    passwordHash: { type: String, default: "" },
    // Set the first time this user successfully links a Google sign-in; null until then.
    // Uniqueness is declared below as a partial index rather than `unique: true`
    // here: a sparse index only skips documents missing the field, but the
    // `default: null` means password users store an explicit null, which a sparse
    // unique index treats as a real value and rejects after the first one.
    googleId: { type: String, default: null },
    name: { type: String, trim: true, default: "" },
    role: {
      type: String,
      enum: [...roleValues, ...Object.keys(legacyRoleReplacements)],
      default: "client",
      set: (value: string) => legacyRoleReplacements[value] ?? value
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
    passwordResetExpiresAt: { type: Date, default: null, select: false },
    // Email sign-in code. Stored as a hash for the same reason the reset token is:
    // a leaked database read must not hand out live credentials. `select: false`
    // keeps it off every incidental read of a user document.
    loginOtpHash: { type: String, default: "", select: false },
    loginOtpExpiresAt: { type: Date, default: null, select: false },
    // Guesses spent against the current code. Caps a brute force at far fewer
    // than the million tries a 6-digit code would otherwise allow.
    loginOtpAttempts: { type: Number, default: 0, select: false },
    // Per-account send throttle, so an IP-level limiter is not the only thing
    // standing between one email address and a flood of codes.
    loginOtpSentAt: { type: Date, default: null, select: false },
    staffProfile: { type: staffProfileSchema, default: null }
  },
  { timestamps: true }
);

// Only real Google subject ids have to be unique. Restricting the index to string
// values leaves every unlinked account (googleId null or absent) out of it, so any
// number of password-based users can coexist and be saved.
userSchema.index(
  { googleId: 1 },
  { unique: true, partialFilterExpression: { googleId: { $type: "string" } } }
);

export const User = mongoose.model<IUser>("User", userSchema);
