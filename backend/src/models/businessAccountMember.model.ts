import mongoose from "mongoose";

export const businessAccountMemberRoleValues = [
  "account_owner",
  "account_admin",
  "operations",
  "finance",
  "tracking_only"
] as const;

export const businessAccountMemberStatusValues = ["invited", "active", "suspended", "removed"] as const;

export type BusinessAccountMemberRole = (typeof businessAccountMemberRoleValues)[number];
export type BusinessAccountMemberStatus = (typeof businessAccountMemberStatusValues)[number];

export const creditPermissionValues = [
  "requestCredit", "useCreditPayment", "viewCreditBalance", "viewCreditDetails", "makeCreditPayment"
] as const;
export type CreditPermission = (typeof creditPermissionValues)[number];

export interface IBusinessAccountMember extends mongoose.Document {
  businessAccount: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  role: BusinessAccountMemberRole;
  assignedBranches: mongoose.Types.ObjectId[];
  status: BusinessAccountMemberStatus;
  creditPermissions: CreditPermission[];
  invitedBy: mongoose.Types.ObjectId;
  joinedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const businessAccountMemberSchema = new mongoose.Schema<IBusinessAccountMember>(
  {
    businessAccount: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessAccount", required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, enum: businessAccountMemberRoleValues, required: true },
    assignedBranches: [{ type: mongoose.Schema.Types.ObjectId, ref: "Branch" }],
    status: { type: String, enum: businessAccountMemberStatusValues, default: "invited", index: true },
    creditPermissions: [{ type: String, enum: creditPermissionValues }],
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    joinedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

// A user must not have two simultaneous memberships for the same business account.
businessAccountMemberSchema.index(
  { businessAccount: 1, user: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["invited", "active", "suspended"] } }
  }
);

export const BusinessAccountMember = mongoose.model<IBusinessAccountMember>("BusinessAccountMember", businessAccountMemberSchema);
