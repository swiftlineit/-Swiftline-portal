import mongoose from "mongoose";
import { isMinorUnitInteger } from "./financialTypes.js";
import { claimRecoveryStateValues } from "./claimTypes.js";
import type { ClaimRecoveryState } from "./claimTypes.js";

/**
 * Swiftline recovering its outlay from a carrier, partner, or its own insurer.
 *
 * Entirely separate from the customer's claim, and deliberately so: the client
 * is paid on the merits of what happened to their shipment, and whether
 * Swiftline recovers anything is Swiftline's problem. Nothing here can reopen,
 * delay, or reduce a settled customer claim.
 */

export const claimRecoveryPartyValues = ["CARRIER", "PARTNER", "INSURER"] as const;
export type ClaimRecoveryParty = (typeof claimRecoveryPartyValues)[number];

export interface IClaimRecovery extends mongoose.Document {
  claimId: mongoose.Types.ObjectId;
  partyType: ClaimRecoveryParty;
  partyName: string;
  /** The carrier's or insurer's own reference for this case. */
  externalReference: string;
  submittedAmountMinor: number;
  admittedAmountMinor: number;
  receivedAmountMinor: number;
  submittedAt?: Date | null;
  followUpAt?: Date | null;
  paymentReceivedAt?: Date | null;
  paymentReference: string;
  documentIds: mongoose.Types.ObjectId[];
  state: ClaimRecoveryState;
  handledBy?: mongoose.Types.ObjectId | null;
  reconciledBy?: mongoose.Types.ObjectId | null;
  reconciledAt?: Date | null;
  /**
   * True when the claim reached Swiftline too late to notify the carrier inside
   * its own, much shorter window. Recorded so the unrecoverable exposure is
   * visible at decision time rather than discovered by finance afterwards.
   */
  filedOutsideCarrierWindow: boolean;
  closureReason: string;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const recoveryAmount = {
  type: Number,
  required: true,
  min: 0,
  default: 0,
  validate: { validator: isMinorUnitInteger, message: "Amount must be an integer minor-unit value." }
};

const claimRecoverySchema = new mongoose.Schema<IClaimRecovery>(
  {
    claimId: { type: mongoose.Schema.Types.ObjectId, ref: "Claim", required: true, immutable: true, index: true },
    partyType: { type: String, enum: claimRecoveryPartyValues, required: true },
    partyName: { type: String, required: true, trim: true, maxlength: 140 },
    externalReference: { type: String, trim: true, maxlength: 120, default: "", index: true },

    submittedAmountMinor: recoveryAmount,
    admittedAmountMinor: recoveryAmount,
    receivedAmountMinor: recoveryAmount,

    submittedAt: { type: Date, default: null },
    followUpAt: { type: Date, default: null, index: true },
    paymentReceivedAt: { type: Date, default: null },
    paymentReference: { type: String, trim: true, maxlength: 120, default: "" },
    documentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "ClaimDocument" }],

    state: { type: String, enum: claimRecoveryStateValues, default: "NOT_STARTED", required: true, index: true },
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    reconciledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reconciledAt: { type: Date, default: null },
    filedOutsideCarrierWindow: { type: Boolean, default: false, index: true },
    closureReason: { type: String, trim: true, maxlength: 1000, default: "" },
    notes: { type: String, trim: true, maxlength: 4000, default: "" }
  },
  { timestamps: true }
);

claimRecoverySchema.pre("validate", function validateRecoveryAmounts() {
  // A carrier can admit less than was claimed and pay less than it admitted, but
  // neither figure can exceed the one above it — those would be data entry
  // errors that quietly overstate what has been recovered.
  if (this.admittedAmountMinor > this.submittedAmountMinor) {
    this.invalidate("admittedAmountMinor", "Admitted amount cannot exceed the amount claimed.");
  }
  if (this.receivedAmountMinor > this.admittedAmountMinor) {
    this.invalidate("receivedAmountMinor", "Received amount cannot exceed the amount admitted.");
  }
});

claimRecoverySchema.index({ claimId: 1, partyType: 1 });
claimRecoverySchema.index({ state: 1, followUpAt: 1 });

export const ClaimRecovery = mongoose.model<IClaimRecovery>("ClaimRecovery", claimRecoverySchema);

/** What Swiftline is out of pocket on this claim, after recovery. */
export function swiftlineExposureMinor(input: { paidToCustomerMinor: number; recoveredMinor: number }) {
  return Math.max(0, input.paidToCustomerMinor - input.recoveredMinor);
}
