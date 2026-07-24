import mongoose from "mongoose";

export const operationsScanSessionStatusValues = ["PENDING", "ACTIVE", "ENDED"] as const;
export type OperationsScanSessionStatus = (typeof operationsScanSessionStatusValues)[number];

export interface IOperationsManifestScanSession extends mongoose.Document {
  manifestId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  activeBagId?: mongoose.Types.ObjectId | null;
  pairingTokenHash: string;
  pairingExpiresAt: Date;
  sessionExpiresAt: Date;
  purgeAt: Date;
  desktopUserId: mongoose.Types.ObjectId;
  phoneUserId?: mongoose.Types.ObjectId | null;
  status: OperationsScanSessionStatus;
  connectedAt?: Date | null;
  lastSeenAt?: Date | null;
  lastScanAt?: Date | null;
  endedAt?: Date | null;
  endedReason: string;
  createdAt: Date;
  updatedAt: Date;
}

const operationsManifestScanSessionSchema = new mongoose.Schema<IOperationsManifestScanSession>({
  manifestId: { type: mongoose.Schema.Types.ObjectId, ref: "OperationsManifest", required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  activeBagId: { type: mongoose.Schema.Types.ObjectId, ref: "OperationsManifestBag", default: null },
  pairingTokenHash: { type: String, required: true, unique: true, select: false },
  pairingExpiresAt: { type: Date, required: true },
  sessionExpiresAt: { type: Date, required: true, index: true },
  purgeAt: { type: Date, required: true },
  desktopUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  phoneUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  status: { type: String, enum: operationsScanSessionStatusValues, required: true, default: "PENDING", index: true },
  connectedAt: { type: Date, default: null },
  lastSeenAt: { type: Date, default: null },
  lastScanAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
  endedReason: { type: String, trim: true, maxlength: 200, default: "" }
}, { timestamps: true });

operationsManifestScanSessionSchema.index(
  { manifestId: 1 },
  { unique: true, partialFilterExpression: { status: "ACTIVE" }, name: "one_active_phone_scanner_per_manifest" }
);
operationsManifestScanSessionSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const OperationsManifestScanSession = mongoose.model<IOperationsManifestScanSession>(
  "OperationsManifestScanSession",
  operationsManifestScanSessionSchema
);
