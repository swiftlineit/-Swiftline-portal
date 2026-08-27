import mongoose from "mongoose";

export const flightAllocationComponentValues = [
  "AIR_FREIGHT", "AIR_FREIGHT_GST", "EICF", "CUSTOMS", "TRANSPORTATION", "CFL", "DPD_LABEL"
] as const;
export type FlightAllocationComponent = (typeof flightAllocationComponentValues)[number];

export interface IFlightCostAllocation extends mongoose.Document {
  flightCostSheetId: mongoose.Types.ObjectId;
  operationsManifestId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  shipmentDraftId: mongoose.Types.ObjectId;
  shipmentProfitabilityId?: mongoose.Types.ObjectId | null;
  awb: string;
  chargeableWeightKg: number;
  parcelCount: number;
  components: Array<{ component: FlightAllocationComponent; amountMinor: number }>;
  totalCostMinor: number;
  totalRevenueMinor: number;
  grossProfitMinor: number;
  marginBasisPoints?: number | null;
  costState: "ESTIMATED" | "ACTUAL";
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const componentSchema = new mongoose.Schema({
  component: { type: String, enum: flightAllocationComponentValues, required: true },
  amountMinor: { type: Number, required: true, min: 0, validate: Number.isSafeInteger }
}, { _id: false });

const schema = new mongoose.Schema<IFlightCostAllocation>({
  flightCostSheetId: { type: mongoose.Schema.Types.ObjectId, ref: "FlightCostSheet", required: true, index: true },
  operationsManifestId: { type: mongoose.Schema.Types.ObjectId, ref: "OperationsManifest", required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  shipmentDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft", required: true, index: true },
  shipmentProfitabilityId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentProfitability", default: null, index: true },
  awb: { type: String, required: true, trim: true, maxlength: 40, index: true },
  chargeableWeightKg: { type: Number, required: true, min: 0 },
  parcelCount: { type: Number, required: true, min: 0 },
  components: { type: [componentSchema], required: true, default: [] },
  totalCostMinor: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
  totalRevenueMinor: { type: Number, required: true, validate: Number.isSafeInteger },
  grossProfitMinor: { type: Number, required: true, validate: Number.isSafeInteger },
  marginBasisPoints: { type: Number, default: null },
  costState: { type: String, enum: ["ESTIMATED", "ACTUAL"], required: true, index: true },
  revision: { type: Number, required: true, min: 1 }
}, { timestamps: true });

schema.index({ flightCostSheetId: 1, shipmentDraftId: 1 }, { unique: true });
schema.index({ branchId: 1, updatedAt: -1 });

export const FlightCostAllocation = mongoose.model<IFlightCostAllocation>("FlightCostAllocation", schema);
