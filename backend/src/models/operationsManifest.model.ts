import mongoose from "mongoose";

export const operationsManifestStatusValues = [
  "DRAFT",
  "PACKING",
  "READY_TO_SEAL",
  "SEALED",
  "DISPATCHED",
  "CANCELLED"
] as const;

export type OperationsManifestStatus = (typeof operationsManifestStatusValues)[number];

export interface IOperationsManifest extends mongoose.Document {
  manifestNumber: string;
  branchId: mongoose.Types.ObjectId;
  header: {
    destinationAgent: string;
    destinationCountryCode: string;
    destinationCountryName: string;
    flightNumber: string;
    departureDate: string;
    mawbNumber: string;
    originIataCode: string;
    destinationIataCode: string;
    valueType: string;
  };
  status: OperationsManifestStatus;
  totalBags: number;
  totalConsignments: number;
  totalPhysicalParcels: number;
  totalWeightKg: number;
  sealedSnapshot: Record<string, unknown>;
  createdBy: mongoose.Types.ObjectId;
  sealedBy?: mongoose.Types.ObjectId | null;
  sealedAt?: Date | null;
  dispatchedBy?: mongoose.Types.ObjectId | null;
  dispatchedAt?: Date | null;
  cancelledBy?: mongoose.Types.ObjectId | null;
  cancelledAt?: Date | null;
  cancellationReason: string;
  createdAt: Date;
  updatedAt: Date;
}

const operationsManifestSchema = new mongoose.Schema<IOperationsManifest>({
  manifestNumber: { type: String, required: true, unique: true, index: true, trim: true, uppercase: true, maxlength: 40 },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  header: {
    destinationAgent: { type: String, trim: true, maxlength: 1000, default: "" },
    destinationCountryCode: { type: String, trim: true, uppercase: true, maxlength: 2, default: "" },
    destinationCountryName: { type: String, trim: true, maxlength: 100, default: "" },
    flightNumber: { type: String, trim: true, uppercase: true, maxlength: 40, default: "" },
    departureDate: { type: String, trim: true, maxlength: 10, default: "" },
    mawbNumber: { type: String, trim: true, uppercase: true, maxlength: 40, default: "" },
    originIataCode: { type: String, trim: true, uppercase: true, maxlength: 3, default: "" },
    destinationIataCode: { type: String, trim: true, uppercase: true, maxlength: 3, default: "" },
    valueType: { type: String, trim: true, uppercase: true, maxlength: 20, default: "LV" }
  },
  status: { type: String, enum: operationsManifestStatusValues, required: true, default: "DRAFT", index: true },
  totalBags: { type: Number, required: true, min: 0, default: 0 },
  totalConsignments: { type: Number, required: true, min: 0, default: 0 },
  totalPhysicalParcels: { type: Number, required: true, min: 0, default: 0 },
  totalWeightKg: { type: Number, required: true, min: 0, default: 0 },
  sealedSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  sealedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  sealedAt: { type: Date, default: null },
  dispatchedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  dispatchedAt: { type: Date, default: null },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  cancelledAt: { type: Date, default: null },
  cancellationReason: { type: String, trim: true, maxlength: 500, default: "" }
}, { timestamps: true });

operationsManifestSchema.index({ branchId: 1, status: 1, updatedAt: -1 });

export const OperationsManifest = mongoose.model<IOperationsManifest>("OperationsManifest", operationsManifestSchema);
