import mongoose from "mongoose";
import { isMinorUnitInteger } from "./financialTypes.js";
import {
  activeClaimStatusValues,
  claimAcceptanceStateValues,
  claimAppealStateValues,
  claimCategoryValues,
  claimCurrencyValues,
  claimDecisionOutcomeValues,
  claimRecoveryStateValues,
  claimStatusValues,
  claimSubmissionStageValues
} from "./claimTypes.js";
import type {
  ClaimAcceptanceState,
  ClaimAppealState,
  ClaimCategory,
  ClaimCurrency,
  ClaimDecisionOutcome,
  ClaimRecoveryState,
  ClaimStatus,
  ClaimSubmissionStage
} from "./claimTypes.js";

/**
 * One affected item within the claim.
 *
 * Parcel items on a shipment are stored with `_id: false`, so they have no
 * stable identity — only a position. An amendment can reorder or replace them
 * after booking, which means a live lookup would silently repoint what the
 * client claimed for.
 *
 * So the reference here is a coordinate into the *frozen snapshot* on the claim,
 * never into the live shipment, and every value the reviewer needs is copied
 * alongside it. The coordinate is for tracing; the snapshot is the truth.
 */
export interface ClaimAffectedItem {
  parcelSequence: number;
  /** Position within that parcel's item list, as captured in the snapshot. */
  itemIndex: number;
  pieceCode: string;
  descriptionSnapshot: string;
  quantityShipped: number;
  quantityAffected: number;
  /** Per-unit declared value at booking, in paise. */
  declaredUnitValueMinor: number;
  clientNarrative: string;
}

/**
 * What the shipment looked like when the claim was filed.
 *
 * Copied rather than referenced because a claim is a legal record: an amendment,
 * a re-rate, or a corrected address six months later must not change what was
 * claimed or what a reviewer saw when deciding.
 */
export interface ClaimShipmentSnapshot {
  shipmentDraftId: mongoose.Types.ObjectId;
  trackingNumber: string;
  carrierTrackingNumber: string;
  bookedAt: Date;
  deliveredAt?: Date | null;
  serviceName: string;
  originCountryCode: string;
  destinationCountryCode: string;
  consignorName: string;
  consigneeName: string;
  parcelCount: number;
  /** Total declared goods value at booking, in paise. */
  totalDeclaredValueMinor: number;
  /** Verbatim parcel and item structure, for the read-only detail panel. */
  parcels: unknown[];
  capturedAt: Date;
}

/**
 * A required document a reviewer has dropped, or an extra one they have asked
 * for.
 *
 * Both live on the claim rather than in a separate collection because the
 * checklist is rebuilt on every read and a join per render would buy nothing.
 * A waiver is never silent — it carries who granted it and why, and that reason
 * reaches the timeline, because "we stopped requiring proof of value" is
 * precisely the decision an auditor will ask about later.
 */
export interface ClaimDocumentRequirementChange {
  category: string;
  reason: string;
  actorUserId: mongoose.Types.ObjectId;
  createdAt: Date;
}

/** The deadline set that applied when this claim was filed. */
export interface ClaimDeadlines {
  policyRuleId?: mongoose.Types.ObjectId | null;
  /** Which clock the filing deadline was measured from. */
  filingBasis: "BOOKING" | "DELIVERY";
  filingDeadlineAt: Date;
  /** When the formal evidence pack is due. */
  evidenceDeadlineAt?: Date | null;
  /** Set once a decision is issued. */
  appealDeadlineAt?: Date | null;
  /** Swiftline's own internal review target, for the SLA queue. */
  internalReviewDueAt?: Date | null;
  /** True when the claim arrived past its filing deadline. Never auto-rejected. */
  filedLate: boolean;
}

export interface IClaim extends mongoose.Document {
  claimNumber?: string | null;
  businessAccountId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  shipmentDraftId: mongoose.Types.ObjectId;
  claimantUserId: mongoose.Types.ObjectId;
  category: ClaimCategory;
  status: ClaimStatus;
  submissionStage: ClaimSubmissionStage;

  requestedAmountMinor: number;
  approvedAmountMinor?: number | null;
  paidAmountMinor?: number | null;
  currency: ClaimCurrency;

  incidentDate?: Date | null;
  description: string;
  packagingCondition: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;

  affectedItems: ClaimAffectedItem[];
  affectedParcelSequences: number[];
  shipmentSnapshot?: ClaimShipmentSnapshot | null;
  deadlines?: ClaimDeadlines | null;
  waivedDocuments: ClaimDocumentRequirementChange[];
  requestedDocuments: ClaimDocumentRequirementChange[];

  assignedTo?: mongoose.Types.ObjectId | null;
  decisionOutcome?: ClaimDecisionOutcome | null;
  acceptanceState: ClaimAcceptanceState;
  appealState: ClaimAppealState;
  recoveryState: ClaimRecoveryState;

  /**
   * Mirrors `status` but is only set while the claim is active, then unset.
   * A partial unique index on it is what allows exactly one live claim per
   * shipment while permitting any number of closed ones.
   */
  activeShipmentDraftId?: mongoose.Types.ObjectId | null;

  linkedSupportTicketId?: mongoose.Types.ObjectId | null;
  linkedPodDisputeId?: mongoose.Types.ObjectId | null;

  submittedAt?: Date | null;
  formalCompletedAt?: Date | null;
  decidedAt?: Date | null;
  acceptedAt?: Date | null;
  settledAt?: Date | null;
  closedAt?: Date | null;
  withdrawnAt?: Date | null;

  /** Nothing may be deleted while this is set, retention period notwithstanding. */
  legalHold: boolean;
  legalHoldReason: string;
  /** Eight years past the last final event. Computed when the claim closes. */
  retainUntil?: Date | null;

  declarationVersion: string;
  declarationAcceptedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const minorAmount = (required: boolean) => ({
  type: Number,
  ...(required ? { required: true } : { default: null }),
  min: 0,
  validate: {
    validator: (value: number | null) => value === null || isMinorUnitInteger(value),
    message: "Claim amounts must be integer minor-unit values."
  }
});

const affectedItemSchema = new mongoose.Schema<ClaimAffectedItem>(
  {
    parcelSequence: { type: Number, required: true, min: 1 },
    itemIndex: { type: Number, required: true, min: 0 },
    pieceCode: { type: String, trim: true, maxlength: 60, default: "" },
    descriptionSnapshot: { type: String, trim: true, maxlength: 200, default: "" },
    quantityShipped: { type: Number, required: true, min: 0 },
    quantityAffected: { type: Number, required: true, min: 1 },
    declaredUnitValueMinor: minorAmount(true),
    clientNarrative: { type: String, trim: true, maxlength: 1000, default: "" }
  },
  { _id: false }
);

affectedItemSchema.pre("validate", function validateQuantity() {
  if (this.quantityAffected > this.quantityShipped) {
    this.invalidate("quantityAffected", "Cannot claim for more units than were shipped.");
  }
});

const shipmentSnapshotSchema = new mongoose.Schema<ClaimShipmentSnapshot>(
  {
    shipmentDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft", required: true },
    trackingNumber: { type: String, trim: true, default: "" },
    carrierTrackingNumber: { type: String, trim: true, default: "" },
    bookedAt: { type: Date, required: true },
    deliveredAt: { type: Date, default: null },
    serviceName: { type: String, trim: true, default: "" },
    originCountryCode: { type: String, trim: true, uppercase: true, maxlength: 2, default: "" },
    destinationCountryCode: { type: String, trim: true, uppercase: true, maxlength: 2, default: "" },
    consignorName: { type: String, trim: true, default: "" },
    consigneeName: { type: String, trim: true, default: "" },
    parcelCount: { type: Number, min: 0, default: 0 },
    totalDeclaredValueMinor: minorAmount(true),
    parcels: { type: [mongoose.Schema.Types.Mixed], default: [] },
    capturedAt: { type: Date, required: true, default: Date.now }
  },
  { _id: false }
);

const requirementChangeSchema = new mongoose.Schema<ClaimDocumentRequirementChange>(
  {
    category: { type: String, required: true, trim: true, maxlength: 60 },
    // Required on both: a waiver without a reason is indistinguishable from a
    // mistake, and a request without one gives the client nothing to act on.
    reason: { type: String, required: true, trim: true, minlength: 5, maxlength: 1000 },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const deadlinesSchema = new mongoose.Schema<ClaimDeadlines>(
  {
    policyRuleId: { type: mongoose.Schema.Types.ObjectId, ref: "ClaimPolicyRule", default: null },
    filingBasis: { type: String, enum: ["BOOKING", "DELIVERY"], required: true },
    filingDeadlineAt: { type: Date, required: true },
    evidenceDeadlineAt: { type: Date, default: null },
    appealDeadlineAt: { type: Date, default: null },
    internalReviewDueAt: { type: Date, default: null },
    filedLate: { type: Boolean, default: false }
  },
  { _id: false }
);

const claimSchema = new mongoose.Schema<IClaim>(
  {
    // Absent until preliminary submission: a draft is identified by its database
    // id, so an abandoned draft never burns a number in the financial-year run.
    // Uniqueness is enforced by a partial index below, not by `unique: true`
    // here. `sparse` would only skip documents where the field is *absent*, and
    // this one defaults to null — so every draft would collide with every other
    // draft on the null value, and a second draft could never be created.
    // Not `immutable`: the field defaults to null at draft creation, so mongoose
    // would consider it already set and silently discard the number assigned at
    // submission. Immutability is enforced by the guard below instead, which is
    // what was actually wanted — settable once, never changed after.
    claimNumber: {
      type: String,
      default: null,
      trim: true
    },
    businessAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessAccount", required: true, immutable: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, immutable: true, index: true },
    shipmentDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft", required: true, immutable: true, index: true },
    claimantUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },

    category: { type: String, enum: claimCategoryValues, required: true, index: true },
    status: { type: String, enum: claimStatusValues, default: "DRAFT", required: true, index: true },
    submissionStage: { type: String, enum: claimSubmissionStageValues, default: "PRELIMINARY", required: true },

    // Entered by the client and never recalculated by the portal. No insurance,
    // liability, or salvage formula adjusts it — a reviewer weighs the evidence
    // and enters an approved figure by hand.
    requestedAmountMinor: minorAmount(true),
    approvedAmountMinor: minorAmount(false),
    paidAmountMinor: minorAmount(false),
    currency: { type: String, enum: claimCurrencyValues, default: "INR", required: true },

    incidentDate: { type: Date, default: null },
    description: { type: String, trim: true, maxlength: 4000, default: "" },
    packagingCondition: { type: String, trim: true, maxlength: 1000, default: "" },
    contactName: { type: String, trim: true, maxlength: 120, default: "" },
    contactPhone: { type: String, trim: true, maxlength: 32, default: "" },
    contactEmail: { type: String, trim: true, lowercase: true, maxlength: 200, default: "" },

    affectedItems: { type: [affectedItemSchema], default: [] },
    affectedParcelSequences: { type: [Number], default: [] },
    shipmentSnapshot: { type: shipmentSnapshotSchema, default: null },
    deadlines: { type: deadlinesSchema, default: null },
    waivedDocuments: { type: [requirementChangeSchema], default: [] },
    requestedDocuments: { type: [requirementChangeSchema], default: [] },

    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    decisionOutcome: { type: String, enum: [...claimDecisionOutcomeValues, null], default: null, index: true },
    acceptanceState: { type: String, enum: claimAcceptanceStateValues, default: "NOT_REQUIRED", required: true },
    appealState: { type: String, enum: claimAppealStateValues, default: "NONE", required: true },
    recoveryState: { type: String, enum: claimRecoveryStateValues, default: "NOT_STARTED", required: true, index: true },

    activeShipmentDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft", default: null },

    linkedSupportTicketId: { type: mongoose.Schema.Types.ObjectId, ref: "SupportTicket", default: null, index: true },
    linkedPodDisputeId: { type: mongoose.Schema.Types.ObjectId, ref: "PodDispute", default: null },

    submittedAt: { type: Date, default: null, index: true },
    formalCompletedAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    settledAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    withdrawnAt: { type: Date, default: null },

    legalHold: { type: Boolean, default: false, index: true },
    legalHoldReason: { type: String, trim: true, maxlength: 500, default: "" },
    retainUntil: { type: Date, default: null, index: true },

    declarationVersion: { type: String, trim: true, maxlength: 20, default: "" },
    declarationAcceptedAt: { type: Date, default: null }
  },
  {
    timestamps: true,
    // Mongoose bumps __v on array writes; `optimisticConcurrency` makes a stale
    // save fail rather than silently overwrite a concurrent decision or payment.
    optimisticConcurrency: true
  }
);

/**
 * Keeps the active marker in step with status.
 *
 * Doing it here rather than at each call site means no transition can forget,
 * and forgetting would either block a legitimate re-file forever or allow two
 * live claims on one shipment.
 */
claimSchema.pre("validate", function syncActiveMarker() {
  const active = (activeClaimStatusValues as readonly string[]).includes(this.status);
  this.activeShipmentDraftId = active ? this.shipmentDraftId : null;
});

/**
 * A claim number, once allocated, is permanent.
 *
 * Enforced here rather than with `immutable` because the field starts as null:
 * mongoose treats that as already-set and would refuse the one assignment that
 * matters. This allows null → number and refuses every other change, including
 * clearing it back to null.
 */
claimSchema.pre("validate", function protectClaimNumber() {
  if (this.isNew || !this.isModified("claimNumber")) return;

  // Refuses clearing an allocated number. Reassigning one number to another is
  // prevented upstream: submission is the only writer, and the state machine
  // only permits SUBMIT from DRAFT, where the number is still null.
  if (!this.claimNumber) {
    this.invalidate("claimNumber", "A claim number cannot be removed once allocated.");
  }
});

claimSchema.pre("validate", function validateApprovedAmount() {
  // A reviewer who believes more is owed must send the claim back for the client
  // to revise upward, so that the figure on record is always one the client
  // actually asked for.
  if (
    typeof this.approvedAmountMinor === "number" &&
    this.approvedAmountMinor > this.requestedAmountMinor
  ) {
    this.invalidate("approvedAmountMinor", "Approved amount cannot exceed the requested amount.");
  }
  if (
    typeof this.paidAmountMinor === "number" &&
    typeof this.approvedAmountMinor === "number" &&
    this.paidAmountMinor > this.approvedAmountMinor
  ) {
    this.invalidate("paidAmountMinor", "Paid amount cannot exceed the approved amount.");
  }
});

/**
 * One active claim per shipment.
 *
 * Partial rather than plain unique so that closed and withdrawn claims — which
 * null the marker — do not collide with each other or block a legitimate second
 * claim after the first is fully resolved.
 */
claimSchema.index(
  { activeShipmentDraftId: 1 },
  { unique: true, partialFilterExpression: { activeShipmentDraftId: { $type: "objectId" } } }
);

/**
 * Claim numbers are unique among claims that have one.
 *
 * Partial rather than sparse: a draft carries `claimNumber: null` until it is
 * submitted, and a sparse unique index treats every one of those nulls as the
 * same value.
 */
claimSchema.index(
  { claimNumber: 1 },
  { unique: true, partialFilterExpression: { claimNumber: { $type: "string" } } }
);

claimSchema.index({ businessAccountId: 1, createdAt: -1 });
claimSchema.index({ branchId: 1, status: 1, "deadlines.internalReviewDueAt": 1 });
claimSchema.index({ assignedTo: 1, updatedAt: -1 });
claimSchema.index({ status: 1, "deadlines.filingDeadlineAt": 1 });

export const Claim = mongoose.model<IClaim>("Claim", claimSchema);
