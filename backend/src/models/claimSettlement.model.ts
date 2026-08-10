import mongoose from "mongoose";
import { isMinorUnitInteger } from "./financialTypes.js";

/**
 * Where an approved claim gets paid, and the record that it was.
 *
 * Bank details are collected after approval rather than at filing: most claims
 * never reach payment, and collecting account numbers from every claimant up
 * front would mean storing sensitive data for claims that are withdrawn or
 * rejected.
 */

export const claimBeneficiaryStateValues = [
  "SUBMITTED",
  "VERIFIED",
  "REJECTED",
  "SUPERSEDED"
] as const;
export type ClaimBeneficiaryState = (typeof claimBeneficiaryStateValues)[number];

export const claimAccountTypeValues = ["SAVINGS", "CURRENT"] as const;

export interface IClaimBeneficiary extends mongoose.Document {
  claimId: mongoose.Types.ObjectId;
  businessAccountId: mongoose.Types.ObjectId;
  version: number;
  accountHolderName: string;
  /**
   * AES-256-GCM via the shared credential encryption service, and `select: false`
   * so a routine query cannot pull it into a response by accident. Reading it
   * requires asking for it explicitly.
   */
  accountNumberEncrypted: string;
  /** What every screen, log, and notification shows instead: `XXXXXX1234`. */
  accountNumberMasked: string;
  /** SHA-256 of the account number, so a repeat submission can be recognised
   *  without decrypting anything. */
  accountNumberHash: string;
  ifsc: string;
  bankName: string;
  accountType: (typeof claimAccountTypeValues)[number];
  /** Cancelled cheque or bank statement header. A storage key, never a path. */
  proofDocumentId?: mongoose.Types.ObjectId | null;
  /** Needed when the account holder is not the registered business. */
  authorityDocumentId?: mongoose.Types.ObjectId | null;
  state: ClaimBeneficiaryState;
  submittedBy: mongoose.Types.ObjectId;
  verifiedBy?: mongoose.Types.ObjectId | null;
  verifiedAt?: Date | null;
  rejectionReason: string;
  createdAt: Date;
  updatedAt: Date;
}

const claimBeneficiarySchema = new mongoose.Schema<IClaimBeneficiary>(
  {
    claimId: { type: mongoose.Schema.Types.ObjectId, ref: "Claim", required: true, immutable: true, index: true },
    businessAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessAccount", required: true, immutable: true },
    version: { type: Number, required: true, min: 1, immutable: true },
    accountHolderName: { type: String, required: true, trim: true, maxlength: 140, immutable: true },
    accountNumberEncrypted: { type: String, required: true, select: false, immutable: true },
    accountNumberMasked: { type: String, required: true, trim: true, maxlength: 32, immutable: true },
    accountNumberHash: { type: String, required: true, trim: true, lowercase: true, minlength: 64, maxlength: 64, immutable: true },
    ifsc: { type: String, required: true, trim: true, uppercase: true, minlength: 11, maxlength: 11, immutable: true },
    bankName: { type: String, required: true, trim: true, maxlength: 140, immutable: true },
    accountType: { type: String, enum: claimAccountTypeValues, required: true, immutable: true },
    proofDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "ClaimDocument", default: null },
    authorityDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "ClaimDocument", default: null },
    state: { type: String, enum: claimBeneficiaryStateValues, default: "SUBMITTED", required: true, index: true },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    verifiedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, maxlength: 1000, default: "" }
  },
  { timestamps: true }
);

// Versioned rather than edited in place: a correction creates a new row and
// supersedes the old one, so which details a given payment actually went to
// stays answerable years later.
claimBeneficiarySchema.index({ claimId: 1, version: -1 }, { unique: true });

export const ClaimBeneficiary = mongoose.model<IClaimBeneficiary>(
  "ClaimBeneficiary",
  claimBeneficiarySchema
);

/**
 * A recorded bank payment against an accepted, approved claim.
 *
 * V1 assumes the transfer happens through Swiftline's existing banking process
 * and is then recorded here with its reference and proof. Nothing in the portal
 * moves money, so this is a record of fact rather than an instruction.
 */
export const claimSettlementStateValues = ["RECORDED", "FAILED", "REVERSED"] as const;
export type ClaimSettlementState = (typeof claimSettlementStateValues)[number];

export interface IClaimSettlement extends mongoose.Document {
  claimId: mongoose.Types.ObjectId;
  beneficiaryId: mongoose.Types.ObjectId;
  /** Pinned so a later beneficiary edit cannot rewrite where this money went. */
  beneficiaryVersion: number;
  approvedAmountMinor: number;
  paidAmountMinor: number;
  currency: "INR";
  method: "BANK_TRANSFER";
  /** UTR or equivalent. Required — a payment without one cannot be traced. */
  transactionReference: string;
  paymentDate: Date;
  proofDocumentId: mongoose.Types.ObjectId;
  recordedBy: mongoose.Types.ObjectId;
  state: ClaimSettlementState;
  failureReason: string;
  reversedAt?: Date | null;
  reversalReason: string;
  /**
   * Permanent, unlike the shared 24-hour `IdempotencyKey` TTL. A replayed
   * request a day later must not be able to record a second payment.
   */
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const claimSettlementSchema = new mongoose.Schema<IClaimSettlement>(
  {
    claimId: { type: mongoose.Schema.Types.ObjectId, ref: "Claim", required: true, immutable: true, index: true },
    beneficiaryId: { type: mongoose.Schema.Types.ObjectId, ref: "ClaimBeneficiary", required: true, immutable: true },
    beneficiaryVersion: { type: Number, required: true, min: 1, immutable: true },
    approvedAmountMinor: {
      type: Number, required: true, min: 1, immutable: true,
      validate: { validator: isMinorUnitInteger, message: "Amount must be an integer minor-unit value." }
    },
    paidAmountMinor: {
      type: Number, required: true, min: 1, immutable: true,
      validate: { validator: isMinorUnitInteger, message: "Amount must be an integer minor-unit value." }
    },
    currency: { type: String, enum: ["INR"], default: "INR", required: true, immutable: true },
    method: { type: String, enum: ["BANK_TRANSFER"], default: "BANK_TRANSFER", required: true, immutable: true },
    transactionReference: { type: String, required: true, trim: true, minlength: 4, maxlength: 60, immutable: true },
    paymentDate: { type: Date, required: true, immutable: true },
    proofDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "ClaimDocument", required: true, immutable: true },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    state: { type: String, enum: claimSettlementStateValues, default: "RECORDED", required: true, index: true },
    failureReason: { type: String, trim: true, maxlength: 1000, default: "" },
    reversedAt: { type: Date, default: null },
    reversalReason: { type: String, trim: true, maxlength: 1000, default: "" },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 200, immutable: true }
  },
  { timestamps: true }
);

claimSettlementSchema.pre("validate", function validatePaidAmount() {
  if (this.paidAmountMinor > this.approvedAmountMinor) {
    this.invalidate("paidAmountMinor", "Paid amount cannot exceed the approved amount.");
  }
});

claimSettlementSchema.index({ idempotencyKey: 1 }, { unique: true });
claimSettlementSchema.index({ claimId: 1, createdAt: -1 });

export const ClaimSettlement = mongoose.model<IClaimSettlement>(
  "ClaimSettlement",
  claimSettlementSchema
);
