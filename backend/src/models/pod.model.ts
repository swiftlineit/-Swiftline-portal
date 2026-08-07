import mongoose from "mongoose";

export const deliveryAssignmentStatusValues = ["ASSIGNED", "ACCEPTED", "OUT_FOR_DELIVERY", "PARTIALLY_DELIVERED", "DELIVERED", "DELIVERY_FAILED", "RETURN_IN_PROGRESS", "RETURNED", "CANCELLED"] as const;
export const podRevisionStatusValues = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "ACTION_REQUIRED", "VERIFIED", "REJECTED", "SUPERSEDED"] as const;
export const deliveryFailureReasonValues = ["RECIPIENT_UNAVAILABLE", "RECIPIENT_REFUSED", "INCORRECT_ADDRESS", "ADDRESS_NOT_FOUND", "BUSINESS_CLOSED", "CUSTOMS_HOLD", "PAYMENT_OR_DUTY_PENDING", "DAMAGED_SHIPMENT", "MISSING_PARCEL", "UNSAFE_LOCATION", "FORCE_MAJEURE", "OTHER"] as const;
export const podRecipientRelationshipValues = ["CONSIGNEE", "FAMILY_MEMBER", "RECEPTION", "SECURITY", "EMPLOYEE", "NEIGHBOUR", "OTHER"] as const;
export const podEvidenceTypeValues = ["PHOTO", "SIGNATURE", "PARTNER_DOCUMENT"] as const;

const assignmentHistorySchema = new mongoose.Schema({
  deliveryPersonProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "DriverProfile", required: true },
  assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  assignedAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
  reason: { type: String, trim: true, maxlength: 500, default: "" }
}, { _id: false });

export interface IDeliveryAssignment extends mongoose.Document {
  shipmentDraftId: mongoose.Types.ObjectId; dpdShipmentId: mongoose.Types.ObjectId;
  businessAccountId: mongoose.Types.ObjectId; branchId: mongoose.Types.ObjectId;
  deliveryPartnerId?: mongoose.Types.ObjectId | null; currentDeliveryPersonProfileId: mongoose.Types.ObjectId;
  parcelNumbers: string[]; deliveredParcelNumbers: string[]; partnerReference: string;
  status: (typeof deliveryAssignmentStatusValues)[number]; expectedDeliveryAt?: Date | null;
  acceptedAt?: Date | null; outForDeliveryAt?: Date | null; deliveredAt?: Date | null;
  assignmentHistory: Array<Record<string, unknown>>; createdBy: mongoose.Types.ObjectId;
  createdAt: Date; updatedAt: Date;
}

const deliveryAssignmentSchema = new mongoose.Schema<IDeliveryAssignment>({
  shipmentDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft", required: true, unique: true, index: true },
  dpdShipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "DpdShipment", required: true, index: true },
  businessAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessAccount", required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  deliveryPartnerId: { type: mongoose.Schema.Types.ObjectId, ref: "DeliveryPartner", default: null, index: true },
  currentDeliveryPersonProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "DriverProfile", required: true, index: true },
  parcelNumbers: [{ type: String, trim: true, maxlength: 80, required: true }],
  deliveredParcelNumbers: [{ type: String, trim: true, maxlength: 80 }],
  partnerReference: { type: String, required: true, trim: true, uppercase: true, maxlength: 120 },
  status: { type: String, enum: deliveryAssignmentStatusValues, default: "ASSIGNED", index: true },
  expectedDeliveryAt: { type: Date, default: null, index: true },
  acceptedAt: { type: Date, default: null }, outForDeliveryAt: { type: Date, default: null }, deliveredAt: { type: Date, default: null },
  assignmentHistory: { type: [assignmentHistorySchema], default: [] },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true }
}, { timestamps: true });
deliveryAssignmentSchema.index({ deliveryPartnerId: 1, partnerReference: 1 }, { unique: true, partialFilterExpression: { deliveryPartnerId: { $type: "objectId" } } });
deliveryAssignmentSchema.index({ currentDeliveryPersonProfileId: 1, status: 1, expectedDeliveryAt: 1 });

const locationSchema = new mongoose.Schema({ latitude: Number, longitude: Number, accuracy: Number, captureStatus: { type: String, enum: ["CAPTURED", "UNAVAILABLE", "DENIED"], default: "UNAVAILABLE" } }, { _id: false });
const evidenceSchema = new mongoose.Schema({
  type: { type: String, enum: podEvidenceTypeValues, required: true }, originalName: { type: String, required: true, trim: true, maxlength: 255 },
  storedName: { type: String, required: true }, mimeType: { type: String, required: true }, size: { type: Number, required: true, min: 1 },
  path: { type: String, required: true }, sha256: { type: String, required: true, maxlength: 64 }, capturedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, capturedAt: { type: Date, default: Date.now }
});

export interface IPodRevision extends mongoose.Document {
  assignmentId: mongoose.Types.ObjectId; shipmentDraftId: mongoose.Types.ObjectId; revisionNumber: number;
  status: (typeof podRevisionStatusValues)[number]; parcelNumbers: string[]; recipientName: string;
  recipientRelationship: (typeof podRecipientRelationshipValues)[number]; deliveredAt: Date; destinationTimeZone: string;
  partnerReference: string; location: Record<string, unknown>; notes: string; signatureExceptionReason: string;
  signatureExceptionStatus: "NONE" | "PENDING" | "APPROVED" | "REJECTED"; evidence: Array<Record<string, unknown>>;
  submissionSource: "DELIVERY_PERSON" | "OPERATIONS_UPLOAD"; submittedBy: mongoose.Types.ObjectId;
  manualSourceNote: string; originalReceivedAt?: Date | null;
  retentionUntil?: Date | null; legalHold: boolean; legalHoldReason: string;
  submittedAt?: Date | null; reviewedBy?: mongoose.Types.ObjectId | null; reviewedAt?: Date | null; reviewReason: string;
  createdAt: Date; updatedAt: Date;
}
const podRevisionSchema = new mongoose.Schema<IPodRevision>({
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: "DeliveryAssignment", required: true, index: true },
  shipmentDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft", required: true, index: true },
  revisionNumber: { type: Number, required: true, min: 1 }, status: { type: String, enum: podRevisionStatusValues, default: "DRAFT", index: true },
  parcelNumbers: [{ type: String, trim: true, maxlength: 80, required: true }], recipientName: { type: String, trim: true, maxlength: 120, default: "" },
  recipientRelationship: { type: String, enum: podRecipientRelationshipValues, default: "CONSIGNEE" }, deliveredAt: { type: Date, default: null },
  destinationTimeZone: { type: String, trim: true, maxlength: 80, default: "UTC" }, partnerReference: { type: String, trim: true, uppercase: true, maxlength: 120, default: "" },
  location: { type: locationSchema, default: () => ({ captureStatus: "UNAVAILABLE" }) }, notes: { type: String, trim: true, maxlength: 1000, default: "" },
  signatureExceptionReason: { type: String, trim: true, maxlength: 500, default: "" }, signatureExceptionStatus: { type: String, enum: ["NONE", "PENDING", "APPROVED", "REJECTED"], default: "NONE" },
  evidence: { type: [evidenceSchema], default: [] }, submissionSource: { type: String, enum: ["DELIVERY_PERSON", "OPERATIONS_UPLOAD"], required: true },
  manualSourceNote: { type: String, trim: true, maxlength: 500, default: "" }, originalReceivedAt: { type: Date, default: null },
  retentionUntil: { type: Date, default: null, index: true }, legalHold: { type: Boolean, default: false, index: true }, legalHoldReason: { type: String, trim: true, maxlength: 500, default: "" },
  submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, submittedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }, reviewedAt: { type: Date, default: null }, reviewReason: { type: String, trim: true, maxlength: 1000, default: "" }
}, { timestamps: true });
podRevisionSchema.index({ assignmentId: 1, revisionNumber: 1 }, { unique: true });

export interface IDeliveryAttempt extends mongoose.Document { assignmentId: mongoose.Types.ObjectId; outcome: string; reason?: string; notes: string; nextActionAt?: Date | null; photoEvidenceId?: mongoose.Types.ObjectId | null; recordedBy: mongoose.Types.ObjectId; attemptedAt: Date; }
const deliveryAttemptSchema = new mongoose.Schema<IDeliveryAttempt>({
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: "DeliveryAssignment", required: true, index: true }, outcome: { type: String, enum: ["FAILED"], required: true },
  reason: { type: String, enum: deliveryFailureReasonValues, required: true }, notes: { type: String, trim: true, maxlength: 1000, required: true },
  nextActionAt: { type: Date, required: true }, photoEvidenceId: { type: mongoose.Schema.Types.ObjectId, default: null }, recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, attemptedAt: { type: Date, default: Date.now }
}, { timestamps: true });

export interface IPodDispute extends mongoose.Document { assignmentId: mongoose.Types.ObjectId; podRevisionId: mongoose.Types.ObjectId; shipmentDraftId: mongoose.Types.ObjectId; businessAccountId: mongoose.Types.ObjectId; category: string; details: string; status: string; reportedBy: mongoose.Types.ObjectId; createdAt: Date; }
const podDisputeSchema = new mongoose.Schema<IPodDispute>({
  assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: "DeliveryAssignment", required: true, index: true }, podRevisionId: { type: mongoose.Schema.Types.ObjectId, ref: "PodRevision", required: true, index: true },
  shipmentDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft", required: true, index: true }, businessAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessAccount", required: true, index: true },
  category: { type: String, enum: ["WRONG_RECIPIENT", "MISSING_PARCEL", "DAMAGED_PARCEL", "INCORRECT_LOCATION", "SIGNATURE_CONCERN", "PHOTO_CONCERN", "NOT_RECEIVED", "OTHER"], required: true },
  details: { type: String, trim: true, minlength: 5, maxlength: 2000, required: true }, status: { type: String, enum: ["OPEN", "UNDER_REVIEW", "RESOLVED", "CLOSED"], default: "OPEN", index: true },
  reportedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true }
}, { timestamps: true });

export const DeliveryAssignment = mongoose.model<IDeliveryAssignment>("DeliveryAssignment", deliveryAssignmentSchema);
export const PodRevision = mongoose.model<IPodRevision>("PodRevision", podRevisionSchema);
export const DeliveryAttempt = mongoose.model<IDeliveryAttempt>("DeliveryAttempt", deliveryAttemptSchema);
export const PodDispute = mongoose.model<IPodDispute>("PodDispute", podDisputeSchema);
