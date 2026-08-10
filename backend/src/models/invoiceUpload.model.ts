import mongoose from "mongoose";

export const invoiceUploadStatusValues = [
  "UPLOADED",
  "PROCESSING",
  "PARSED",
  "PARSING_FAILED"
] as const;

export type InvoiceUploadStatus = (typeof invoiceUploadStatusValues)[number];

export interface IInvoiceUpload extends mongoose.Document {
  businessAccountId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  templateVersion: string;
  invoiceNumber: string;
  shipmentReference: string;
  originalFilename: string;
  /**
   * Storage service key, resolved through storage.service.ts. Never a path.
   *
   * Empty for an individual (walk-in) shipment, which is keyed in at the counter
   * and has no uploaded workbook behind it. That record exists only because the
   * shipment chain requires an invoice to point at, so every reader must treat a
   * missing key as "there is nothing to read" rather than as a broken reference.
   */
  storageKey: string;
  fileChecksum: string;
  extractedData: Record<string, unknown>;
  status: InvoiceUploadStatus;
  processingErrors: string[];
  uploadedBy: mongoose.Types.ObjectId;
  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceUploadSchema = new mongoose.Schema<IInvoiceUpload>(
  {
    businessAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BusinessAccount",
      required: true,
      index: true
    },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    templateVersion: { type: String, trim: true, maxlength: 40, default: "" },
    invoiceNumber: { type: String, trim: true, maxlength: 80, default: "", index: true },
    shipmentReference: { type: String, trim: true, maxlength: 120, default: "", index: true },
    originalFilename: { type: String, required: true, trim: true, maxlength: 255 },
    storageKey: { type: String, trim: true, maxlength: 1024, default: "" },
    fileChecksum: { type: String, required: true, trim: true, maxlength: 128, index: true },
    extractedData: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: invoiceUploadStatusValues, default: "UPLOADED", index: true },
    processingErrors: [{ type: String, trim: true, maxlength: 500 }],
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    uploadedAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: true }
);

invoiceUploadSchema.index(
  { businessAccountId: 1, branchId: 1, invoiceNumber: 1, shipmentReference: 1 },
  {
    unique: true,
    partialFilterExpression: {
      invoiceNumber: { $type: "string", $gt: "" },
      shipmentReference: { $type: "string", $gt: "" }
    }
  }
);

export const InvoiceUpload = mongoose.model<IInvoiceUpload>(
  "InvoiceUpload",
  invoiceUploadSchema
);
