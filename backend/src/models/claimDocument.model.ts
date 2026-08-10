import mongoose from "mongoose";

/**
 * One piece of evidence attached to a claim.
 *
 * Rows hold a storage key, never a path or URL, so the same record works on
 * local disk and on S3 and survives a server move. A key like
 * `claims/{claimId}/evidence/{uuid}.jpg` is resolved by the storage service.
 */

/**
 * What the document is meant to prove. Drives the dynamic checklist, so the list
 * is the union of everything any claim category can require.
 */
export const claimDocumentCategoryValues = [
  "VALUE_PROOF",
  "PACKING_LIST",
  "GOODS_PHOTO",
  "OUTER_PACKAGING_PHOTO",
  "INNER_PACKAGING_PHOTO",
  "LABEL_PHOTO",
  "TAMPERING_PHOTO",
  "MISSING_ITEM_LIST",
  "NON_RECEIPT_DECLARATION",
  "CONSIGNEE_STATEMENT",
  "DELIVERY_EXCEPTION",
  "REPAIR_QUOTATION",
  "REPLACEMENT_QUOTATION",
  "SURVEY_REPORT",
  "INSPECTION_REPORT",
  "SALVAGE_VALUATION",
  "DISPOSAL_CERTIFICATE",
  "POLICE_REPORT",
  "CCTV_EVIDENCE",
  "TEMPERATURE_LOG",
  "EXPIRY_INFORMATION",
  "CARRIER_EXCEPTION_REPORT",
  "CLAIMANT_AUTHORITY",
  "PAYMENT_PROOF",
  "BENEFICIARY_PROOF",
  "OTHER"
] as const;

export const claimDocumentReviewStateValues = [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "REPLACED"
] as const;

/**
 * Scanning is deferred, so uploads sit at NOT_SCANNED and the extension
 * allowlist plus file-signature check carry the weight. The field exists now so
 * turning scanning on later is a worker plus a state change, not a migration.
 */
export const claimDocumentScanStateValues = [
  "NOT_SCANNED",
  "PENDING",
  "CLEAN",
  "QUARANTINED"
] as const;

export type ClaimDocumentCategory = (typeof claimDocumentCategoryValues)[number];
export type ClaimDocumentReviewState = (typeof claimDocumentReviewStateValues)[number];
export type ClaimDocumentScanState = (typeof claimDocumentScanStateValues)[number];

export interface IClaimDocument extends mongoose.Document {
  claimId: mongoose.Types.ObjectId;
  category: ClaimDocumentCategory;
  storageKey: string;
  /** Kept as metadata only. It never contributes to the storage key. */
  originalName: string;
  mimeType: string;
  size: number;
  sha256: string;
  scanState: ClaimDocumentScanState;
  reviewState: ClaimDocumentReviewState;
  reviewedBy?: mongoose.Types.ObjectId | null;
  reviewedAt?: Date | null;
  rejectionReason: string;
  uploadedBy: mongoose.Types.ObjectId;
  uploadedByKind: "CLIENT" | "STAFF";
  visibility: "PUBLIC" | "INTERNAL";
  version: number;
  /** Set on the old row when a replacement arrives. History is never overwritten. */
  replacedByDocumentId?: mongoose.Types.ObjectId | null;
  /** Automatically attached from an existing portal record rather than uploaded. */
  sourcedFromPortal: boolean;
  legalHold: boolean;
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const claimDocumentSchema = new mongoose.Schema<IClaimDocument>(
  {
    claimId: { type: mongoose.Schema.Types.ObjectId, ref: "Claim", required: true, immutable: true, index: true },
    category: { type: String, enum: claimDocumentCategoryValues, required: true, index: true },
    storageKey: { type: String, required: true, immutable: true, trim: true, maxlength: 1024 },
    originalName: { type: String, required: true, trim: true, maxlength: 260 },
    mimeType: { type: String, required: true, trim: true, maxlength: 120 },
    size: { type: Number, required: true, min: 1 },
    // Detects a corrupted or truncated upload, and identifies the same file
    // submitted twice under different names.
    sha256: { type: String, required: true, trim: true, lowercase: true, minlength: 64, maxlength: 64, index: true },
    scanState: { type: String, enum: claimDocumentScanStateValues, default: "NOT_SCANNED", required: true },
    reviewState: { type: String, enum: claimDocumentReviewStateValues, default: "PENDING", required: true, index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, maxlength: 1000, default: "" },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
    uploadedByKind: { type: String, enum: ["CLIENT", "STAFF"], required: true, immutable: true },
    visibility: { type: String, enum: ["PUBLIC", "INTERNAL"], default: "PUBLIC", required: true },
    version: { type: Number, default: 1, min: 1 },
    replacedByDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "ClaimDocument", default: null },
    sourcedFromPortal: { type: Boolean, default: false },
    legalHold: { type: Boolean, default: false, index: true },
    // Soft delete: the row survives so the timeline and any legal hold still
    // reference something real. Purging the object is a retention job's work.
    deletedAt: { type: Date, default: null, index: true }
  },
  { timestamps: true }
);

claimDocumentSchema.index({ claimId: 1, category: 1, createdAt: -1 });
claimDocumentSchema.index({ claimId: 1, deletedAt: 1 });

export const ClaimDocument = mongoose.model<IClaimDocument>("ClaimDocument", claimDocumentSchema);

/**
 * Records who opened which document and when.
 *
 * Kept separate from the document so a read never writes to the row it is
 * reading, and so the access trail survives a soft delete of the document.
 */
export interface IClaimDocumentAccess extends mongoose.Document {
  claimId: mongoose.Types.ObjectId;
  documentId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  action: "VIEWED" | "DOWNLOADED";
  ipAddress: string;
  createdAt: Date;
}

const claimDocumentAccessSchema = new mongoose.Schema<IClaimDocumentAccess>({
  claimId: { type: mongoose.Schema.Types.ObjectId, ref: "Claim", required: true, immutable: true, index: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: "ClaimDocument", required: true, immutable: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  action: { type: String, enum: ["VIEWED", "DOWNLOADED"], required: true, immutable: true },
  ipAddress: { type: String, trim: true, maxlength: 64, default: "", immutable: true },
  createdAt: { type: Date, default: Date.now, immutable: true, index: true }
});

export const ClaimDocumentAccess = mongoose.model<IClaimDocumentAccess>(
  "ClaimDocumentAccess",
  claimDocumentAccessSchema
);
