import mongoose from "mongoose";

export type ShipmentManifestActorRole = "admin" | "client";

export interface ShipmentManifestLineSnapshot {
  shipmentDraftId: mongoose.Types.ObjectId;
  dpdShipmentId: mongoose.Types.ObjectId;
  consignmentNumber: string;
  pieces: number;
  weightKg: number;
  consignor: Record<string, unknown>;
  consignee: Record<string, unknown>;
  description: string;
  declaredValueMinor: number;
  currency: "INR";
  bagNumber: string;
  serviceInfo: string;
}

export interface IShipmentManifest extends mongoose.Document {
  manifestNumber: string;
  businessAccountId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  shipmentDraftIds: mongoose.Types.ObjectId[];
  headerSnapshot: Record<string, unknown>;
  lineSnapshots: ShipmentManifestLineSnapshot[];
  totalPieces: number;
  totalWeightKg: number;
  totalBags: number;
  createdBy: mongoose.Types.ObjectId;
  actorRole: ShipmentManifestActorRole;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const manifestLineSchema = new mongoose.Schema<ShipmentManifestLineSnapshot>({
  shipmentDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft", required: true },
  dpdShipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "DpdShipment", required: true },
  consignmentNumber: { type: String, required: true, trim: true, maxlength: 80 },
  pieces: { type: Number, required: true, min: 1 },
  weightKg: { type: Number, required: true, min: 0 },
  consignor: { type: mongoose.Schema.Types.Mixed, required: true },
  consignee: { type: mongoose.Schema.Types.Mixed, required: true },
  description: { type: String, required: true, trim: true, maxlength: 1000 },
  declaredValueMinor: { type: Number, required: true, min: 0 },
  currency: { type: String, enum: ["INR"], default: "INR", required: true },
  bagNumber: { type: String, required: true, trim: true, maxlength: 40 },
  serviceInfo: { type: String, required: true, trim: true, maxlength: 40 }
}, { _id: false });

const shipmentManifestSchema = new mongoose.Schema<IShipmentManifest>({
  manifestNumber: { type: String, required: true, unique: true, index: true, trim: true, maxlength: 40 },
  businessAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessAccount", required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  shipmentDraftIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft", required: true }],
  headerSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  lineSnapshots: { type: [manifestLineSchema], required: true },
  totalPieces: { type: Number, required: true, min: 1 },
  totalWeightKg: { type: Number, required: true, min: 0 },
  totalBags: { type: Number, required: true, min: 1 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  actorRole: { type: String, enum: ["admin", "client"], required: true },
  generatedAt: { type: Date, required: true, default: Date.now }
}, { timestamps: true });

shipmentManifestSchema.index({ businessAccountId: 1, branchId: 1, generatedAt: -1 });
shipmentManifestSchema.index({ "lineSnapshots.shipmentDraftId": 1, generatedAt: -1 });
shipmentManifestSchema.index({ shipmentDraftIds: 1 }, { unique: true });

export const ShipmentManifest = mongoose.model<IShipmentManifest>(
  "ShipmentManifest",
  shipmentManifestSchema
);
