import mongoose from "mongoose";
import { isMinorUnitInteger } from "./financialTypes.js";
import { claimDecisionOutcomeValues } from "./claimTypes.js";
import type { ClaimDecisionOutcome } from "./claimTypes.js";

/**
 * One decision revision on a claim.
 *
 * Immutable and versioned rather than a field on the claim, because an appeal
 * produces a *second* decision and both must remain readable- a client
 * disputing an outcome is entitled to see what the original said, and so is
 * anyone reviewing the file later.
 */
export interface IClaimDecision extends mongoose.Document {
  claimId: mongoose.Types.ObjectId;
  revision: number;
  outcome: ClaimDecisionOutcome;
  requestedAmountMinor: number;
  approvedAmountMinor: number;
  /** Declared goods value at booking, recorded so the comparison is reproducible. */
  declaredValueMinor: number;
  /** Structured reason code, for reporting on why claims are refused. */
  reasonCode: string;
  /** Wording the client sees. Always required, including on full approval. */
  customerExplanation: string;
  internalNote: string;
  decidedBy: mongoose.Types.ObjectId;
  /** Set when this revision came from an appeal rather than the first review. */
  supersedesDecisionId?: mongoose.Types.ObjectId | null;
  appealId?: mongoose.Types.ObjectId | null;
  createdAt: Date;
}

const minor = { type: Number, required: true, min: 0, validate: { validator: isMinorUnitInteger, message: "Amount must be an integer minor-unit value." } };

const claimDecisionSchema = new mongoose.Schema<IClaimDecision>({
  claimId: { type: mongoose.Schema.Types.ObjectId, ref: "Claim", required: true, immutable: true, index: true },
  revision: { type: Number, required: true, min: 1, immutable: true },
  outcome: { type: String, enum: claimDecisionOutcomeValues, required: true, immutable: true },
  requestedAmountMinor: { ...minor, immutable: true },
  approvedAmountMinor: { ...minor, immutable: true },
  declaredValueMinor: { ...minor, immutable: true },
  reasonCode: { type: String, required: true, trim: true, maxlength: 60, immutable: true },
  customerExplanation: { type: String, required: true, trim: true, minlength: 10, maxlength: 4000, immutable: true },
  internalNote: { type: String, trim: true, maxlength: 4000, default: "", immutable: true },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  supersedesDecisionId: { type: mongoose.Schema.Types.ObjectId, ref: "ClaimDecision", default: null, immutable: true },
  appealId: { type: mongoose.Schema.Types.ObjectId, ref: "ClaimAppeal", default: null, immutable: true },
  createdAt: { type: Date, default: Date.now, immutable: true }
});

claimDecisionSchema.pre("validate", function validateAmounts() {
  // The model refuses what the UI should already prevent: approving more than
  // was asked for. A reviewer who thinks more is owed sends the claim back for
  // the client to revise, so the figure on record is always one they requested.
  if (this.approvedAmountMinor > this.requestedAmountMinor) {
    this.invalidate("approvedAmountMinor", "Approved amount cannot exceed the requested amount.");
  }
  if (this.outcome === "REJECTED" && this.approvedAmountMinor !== 0) {
    this.invalidate("approvedAmountMinor", "A rejected claim must approve zero.");
  }
  if (this.outcome === "FULLY_APPROVED" && this.approvedAmountMinor !== this.requestedAmountMinor) {
    this.invalidate("approvedAmountMinor", "A full approval must match the requested amount.");
  }
  if (this.outcome === "PARTIALLY_APPROVED") {
    if (this.approvedAmountMinor <= 0) {
      this.invalidate("approvedAmountMinor", "A partial approval must approve more than zero.");
    }
    if (this.approvedAmountMinor >= this.requestedAmountMinor) {
      this.invalidate("approvedAmountMinor", "A partial approval must be less than the requested amount.");
    }
  }
});

claimDecisionSchema.index({ claimId: 1, revision: -1 }, { unique: true });

export const ClaimDecision = mongoose.model<IClaimDecision>("ClaimDecision", claimDecisionSchema);

/**
 * A client's single appeal against a decision.
 *
 * One per claim, enforced by a unique index rather than only by the state
 * machine: two tabs submitting at once must not both succeed.
 */
export interface IClaimAppeal extends mongoose.Document {
  claimId: mongoose.Types.ObjectId;
  againstDecisionId: mongoose.Types.ObjectId;
  reason: string;
  submittedBy: mongoose.Types.ObjectId;
  submittedAt: Date;
  newEvidenceDocumentIds: mongoose.Types.ObjectId[];
  reviewedBy?: mongoose.Types.ObjectId | null;
  reviewedAt?: Date | null;
  resultingDecisionId?: mongoose.Types.ObjectId | null;
  outcomeSummary: string;
  createdAt: Date;
  updatedAt: Date;
}

const claimAppealSchema = new mongoose.Schema<IClaimAppeal>(
  {
    claimId: { type: mongoose.Schema.Types.ObjectId, ref: "Claim", required: true, immutable: true },
    againstDecisionId: { type: mongoose.Schema.Types.ObjectId, ref: "ClaimDecision", required: true, immutable: true },
    reason: { type: String, required: true, trim: true, minlength: 10, maxlength: 4000, immutable: true },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    submittedAt: { type: Date, required: true, default: Date.now, immutable: true },
    newEvidenceDocumentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "ClaimDocument" }],
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    resultingDecisionId: { type: mongoose.Schema.Types.ObjectId, ref: "ClaimDecision", default: null },
    outcomeSummary: { type: String, trim: true, maxlength: 4000, default: "" }
  },
  { timestamps: true }
);

claimAppealSchema.index({ claimId: 1 }, { unique: true });

export const ClaimAppeal = mongoose.model<IClaimAppeal>("ClaimAppeal", claimAppealSchema);
