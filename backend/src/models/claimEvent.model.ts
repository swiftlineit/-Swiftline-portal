import mongoose from "mongoose";
import { claimStatusValues } from "./claimTypes.js";
import type { ClaimStatus } from "./claimTypes.js";

/**
 * Append-only timeline for one claim.
 *
 * Separate from `AuditLog` on purpose: this is a record the *client* can be
 * shown, so each entry carries a visibility flag and a customer-safe wording.
 * The audit log stays internal and unfiltered.
 *
 * Nothing here is ever updated or deleted. A correction is a new event.
 */

export const claimEventTypeValues = [
  "CREATED",
  "SUBMITTED",
  "NUMBER_ALLOCATED",
  "STATUS_CHANGED",
  "ASSIGNED",
  "DOCUMENT_UPLOADED",
  "DOCUMENT_ACCEPTED",
  "DOCUMENT_REJECTED",
  "DOCUMENT_WAIVED",
  "INFORMATION_REQUESTED",
  "MESSAGE_POSTED",
  "DECISION_ISSUED",
  "SETTLEMENT_ACCEPTED",
  "SETTLEMENT_DISPUTED",
  "BENEFICIARY_SUBMITTED",
  "BENEFICIARY_VERIFIED",
  "PAYMENT_RECORDED",
  "PAYMENT_REVERSED",
  "APPEAL_SUBMITTED",
  "APPEAL_RESOLVED",
  "RECOVERY_UPDATED",
  "LEGAL_HOLD_ADDED",
  "LEGAL_HOLD_REMOVED",
  "REOPENED",
  "CLOSED",
  "WITHDRAWN"
] as const;

export type ClaimEventType = (typeof claimEventTypeValues)[number];

/** PUBLIC entries are shown to the client; INTERNAL ones never leave staff views. */
export const claimEventVisibilityValues = ["PUBLIC", "INTERNAL"] as const;
export type ClaimEventVisibility = (typeof claimEventVisibilityValues)[number];

export interface IClaimEvent extends mongoose.Document {
  claimId: mongoose.Types.ObjectId;
  type: ClaimEventType;
  fromStatus?: ClaimStatus | null;
  toStatus?: ClaimStatus | null;
  actorUserId?: mongoose.Types.ObjectId | null;
  /** Distinguishes a client action from a staff one in a mixed timeline. */
  actorKind: "CLIENT" | "STAFF" | "SYSTEM";
  reason: string;
  visibility: ClaimEventVisibility;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const claimEventSchema = new mongoose.Schema<IClaimEvent>({
  claimId: { type: mongoose.Schema.Types.ObjectId, ref: "Claim", required: true, immutable: true, index: true },
  type: { type: String, enum: claimEventTypeValues, required: true, immutable: true, index: true },
  fromStatus: { type: String, enum: [...claimStatusValues, null], default: null, immutable: true },
  toStatus: { type: String, enum: [...claimStatusValues, null], default: null, immutable: true },
  actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, immutable: true },
  actorKind: { type: String, enum: ["CLIENT", "STAFF", "SYSTEM"], required: true, immutable: true },
  reason: { type: String, trim: true, maxlength: 2000, default: "", immutable: true },
  visibility: { type: String, enum: claimEventVisibilityValues, default: "INTERNAL", required: true, immutable: true },
  // Never carries bank details. Account numbers appear nowhere in the timeline,
  // in logs, in URLs, or in notifications — only masked values reach a reader.
  metadata: { type: mongoose.Schema.Types.Mixed, default: {}, immutable: true },
  createdAt: { type: Date, default: Date.now, immutable: true, index: true }
});

claimEventSchema.index({ claimId: 1, createdAt: -1 });
claimEventSchema.index({ claimId: 1, visibility: 1, createdAt: -1 });

export const ClaimEvent = mongoose.model<IClaimEvent>("ClaimEvent", claimEventSchema);
