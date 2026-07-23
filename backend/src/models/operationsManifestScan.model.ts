import mongoose from "mongoose";

export const operationsScanStatusValues = ["ACCEPTED", "REJECTED", "REMOVED"] as const;
export type OperationsScanStatus = (typeof operationsScanStatusValues)[number];

export interface IOperationsManifestScan extends mongoose.Document {
  manifestId: mongoose.Types.ObjectId;
  bagId?: mongoose.Types.ObjectId | null;
  consignmentId?: mongoose.Types.ObjectId | null;
  parcelNumber: string;
  scanRequestId: string;
  status: OperationsScanStatus;
  message: string;
  scannedBy: mongoose.Types.ObjectId;
  scannedAt: Date;
  removedBy?: mongoose.Types.ObjectId | null;
  removedAt?: Date | null;
  removalReason: string;
  createdAt: Date;
  updatedAt: Date;
}

const operationsManifestScanSchema = new mongoose.Schema<IOperationsManifestScan>({
  manifestId: { type: mongoose.Schema.Types.ObjectId, ref: "OperationsManifest", required: true, index: true },
  bagId: { type: mongoose.Schema.Types.ObjectId, ref: "OperationsManifestBag", default: null, index: true },
  consignmentId: { type: mongoose.Schema.Types.ObjectId, ref: "OperationsManifestConsignment", default: null, index: true },
  parcelNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
  scanRequestId: { type: String, required: true, unique: true, trim: true, maxlength: 120 },
  status: { type: String, enum: operationsScanStatusValues, required: true, index: true },
  message: { type: String, required: true, trim: true, maxlength: 500 },
  scannedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  scannedAt: { type: Date, required: true, default: Date.now, index: true },
  removedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  removedAt: { type: Date, default: null },
  removalReason: { type: String, trim: true, maxlength: 500, default: "" }
}, { timestamps: true });

operationsManifestScanSchema.index(
  { parcelNumber: 1 },
  { unique: true, partialFilterExpression: { status: "ACCEPTED" }, name: "active_operations_parcel_scan" }
);
operationsManifestScanSchema.index({ manifestId: 1, scannedAt: -1 });

export const OperationsManifestScan = mongoose.model<IOperationsManifestScan>("OperationsManifestScan", operationsManifestScanSchema);
