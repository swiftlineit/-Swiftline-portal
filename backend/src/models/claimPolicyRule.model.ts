import mongoose from "mongoose";
import { claimCategoryValues, defaultClaimDeadlines } from "./claimTypes.js";
import type { ClaimCategory } from "./claimTypes.js";
import { claimDocumentCategoryValues } from "./claimDocument.model.js";
import type { ClaimDocumentCategory } from "./claimDocument.model.js";

/**
 * Versioned filing deadlines and evidence requirements.
 *
 * Deadlines are not hard-coded because they are not one number: they vary by
 * mode, by route, by carrier contract, and by what went wrong. A rule is chosen
 * at submission, then frozen onto the claim — so revising policy next quarter
 * cannot retroactively expire a claim already in flight.
 *
 * Rules are matched most-specific-first. A rule with no route, carrier, or
 * category constraints is the fallback and should always exist.
 */

export const claimRouteScopeValues = ["ANY", "DOMESTIC", "INTERNATIONAL"] as const;
export type ClaimRouteScope = (typeof claimRouteScopeValues)[number];

export interface IClaimPolicyRule extends mongoose.Document {
  name: string;
  version: number;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo?: Date | null;

  routeScope: ClaimRouteScope;
  originCountryCodes: string[];
  destinationCountryCodes: string[];
  carrierCodes: string[];
  categories: ClaimCategory[];
  businessAccountIds: mongoose.Types.ObjectId[];

  bookingToClaimDays: number;
  deliveryToClaimDays: number;
  evidenceDays: number;
  appealDays: number;
  internalReviewDays: number;

  /**
   * Swiftline's own window to claim against the carrier, in days from booking.
   *
   * Shorter than the client window, so a claim filed late by a client can be
   * valid for them and already unrecoverable from the carrier. Recorded here so
   * a reviewer sees the exposure before approving rather than after.
   */
  carrierRecoveryDays?: number | null;

  requiredDocuments: ClaimDocumentCategory[];
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const claimPolicyRuleSchema = new mongoose.Schema<IClaimPolicyRule>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    version: { type: Number, required: true, min: 1, default: 1 },
    isActive: { type: Boolean, default: true, index: true },
    effectiveFrom: { type: Date, required: true, default: Date.now, index: true },
    effectiveTo: { type: Date, default: null },

    routeScope: { type: String, enum: claimRouteScopeValues, default: "ANY", required: true },
    // Empty arrays mean "no constraint" rather than "matches nothing", which is
    // what makes an all-empty rule the fallback.
    originCountryCodes: [{ type: String, trim: true, uppercase: true, maxlength: 2 }],
    destinationCountryCodes: [{ type: String, trim: true, uppercase: true, maxlength: 2 }],
    carrierCodes: [{ type: String, trim: true, uppercase: true, maxlength: 40 }],
    categories: [{ type: String, enum: claimCategoryValues }],
    businessAccountIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "BusinessAccount" }],

    bookingToClaimDays: { type: Number, required: true, min: 1, max: 365, default: defaultClaimDeadlines.bookingToClaimDays },
    deliveryToClaimDays: { type: Number, required: true, min: 1, max: 365, default: defaultClaimDeadlines.deliveryToClaimDays },
    evidenceDays: { type: Number, required: true, min: 1, max: 365, default: defaultClaimDeadlines.documentResponseDays },
    appealDays: { type: Number, required: true, min: 1, max: 365, default: defaultClaimDeadlines.appealDays },
    internalReviewDays: { type: Number, required: true, min: 1, max: 365, default: 15 },
    carrierRecoveryDays: { type: Number, default: null, min: 1, max: 365 },

    requiredDocuments: [{ type: String, enum: claimDocumentCategoryValues }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

claimPolicyRuleSchema.index({ name: 1, version: 1 }, { unique: true });
claimPolicyRuleSchema.index({ isActive: 1, effectiveFrom: -1 });

export const ClaimPolicyRule = mongoose.model<IClaimPolicyRule>(
  "ClaimPolicyRule",
  claimPolicyRuleSchema
);
