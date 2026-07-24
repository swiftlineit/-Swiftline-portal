import mongoose from "mongoose";

export const operationsConsignmentStatusValues = ["PARTIAL", "COMPLETE", "REMOVED"] as const;
export type OperationsConsignmentStatus = (typeof operationsConsignmentStatusValues)[number];

export interface IOperationsManifestConsignment extends mongoose.Document {
  manifestId: mongoose.Types.ObjectId;
  bagId: mongoose.Types.ObjectId;
  shipmentDraftId: mongoose.Types.ObjectId;
  dpdShipmentId: mongoose.Types.ObjectId;
  businessAccountId: mongoose.Types.ObjectId;
  consignmentNumber: string;
  expectedParcelNumbers: string[];
  scannedParcelNumbers: string[];
  // Per-parcel facts captured at scan time. Each one prints as its own manifest row.
  parcelWeightSnapshots: Array<{ parcelNumber: string; weightKg: number; contentsDescription?: string }>;
  manifestPieces: 1;
  weightKg: number;
  status: OperationsConsignmentStatus;
  consignorSnapshot: Record<string, unknown>;
  consigneeSnapshot: Record<string, unknown>;
  description: string;
  declaredValueMinor?: number | null;
  currency: "INR";
  serviceInfo: string;
  dpdLabelGenerated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const operationsManifestConsignmentSchema = new mongoose.Schema<IOperationsManifestConsignment>({
  manifestId: { type: mongoose.Schema.Types.ObjectId, ref: "OperationsManifest", required: true, index: true },
  bagId: { type: mongoose.Schema.Types.ObjectId, ref: "OperationsManifestBag", required: true, index: true },
  shipmentDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft", required: true, index: true },
  dpdShipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "DpdShipment", required: true, index: true },
  businessAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessAccount", required: true, index: true },
  consignmentNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 80, index: true },
  expectedParcelNumbers: [{ type: String, required: true, trim: true, uppercase: true, maxlength: 80 }],
  scannedParcelNumbers: [{ type: String, required: true, trim: true, uppercase: true, maxlength: 80 }],
  parcelWeightSnapshots: [{
    _id: false,
    parcelNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
    weightKg: { type: Number, required: true, min: 0.001 },
    contentsDescription: { type: String, trim: true, maxlength: 1000, default: "" }
  }],
  manifestPieces: { type: Number, required: true, enum: [1], default: 1 },
  weightKg: { type: Number, required: true, min: 0 },
  status: { type: String, enum: operationsConsignmentStatusValues, required: true, default: "PARTIAL", index: true },
  consignorSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  consigneeSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  description: { type: String, required: true, trim: true, maxlength: 1000 },
  declaredValueMinor: { type: Number, min: 1, default: null },
  currency: { type: String, enum: ["INR"], required: true, default: "INR" },
  serviceInfo: { type: String, required: true, trim: true, maxlength: 40 },
  dpdLabelGenerated: { type: Boolean, required: true, default: false }
}, { timestamps: true });

operationsManifestConsignmentSchema.index({ manifestId: 1, shipmentDraftId: 1 }, { unique: true });
operationsManifestConsignmentSchema.index({ manifestId: 1, bagId: 1, status: 1 });

export const OperationsManifestConsignment = mongoose.model<IOperationsManifestConsignment>("OperationsManifestConsignment", operationsManifestConsignmentSchema);
