import mongoose from "mongoose";

export const offloadReasonValues = [
  "AIRLINE_OFFLOAD",
  "CAPACITY",
  "WEATHER",
  "CUSTOMS",
  "MISSED_CONNECTION",
  "DAMAGE",
  "SECURITY",
  "OTHER"
] as const;
export type OffloadReason = (typeof offloadReasonValues)[number];

export type FlightOffloadedParcel = {
  shipmentDraftId: mongoose.Types.ObjectId;
  parcelNumber: string;
  actualWeightKg: number;
  volumetricWeightKg: number;
  chargeableWeightKg: number;
};

export interface IFlightOffload extends mongoose.Document {
  flightLinehaulId: mongoose.Types.ObjectId;
  replacementFlightId?: mongoose.Types.ObjectId | null;
  branchId: mongoose.Types.ObjectId;
  reason: OffloadReason;
  detail: string;
  airline: string;
  affectedShipmentIds: mongoose.Types.ObjectId[];
  affectedBagIds: mongoose.Types.ObjectId[];
  affectedParcels: FlightOffloadedParcel[];
  affectedWeightKg: number;
  affectedPieces: number;
  responsibleEmployeeId?: mongoose.Types.ObjectId | null;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new mongoose.Schema<IFlightOffload>(
  {
    flightLinehaulId: { type: mongoose.Schema.Types.ObjectId, ref: "FlightLinehaul", required: true, index: true },
    replacementFlightId: { type: mongoose.Schema.Types.ObjectId, ref: "FlightLinehaul", default: null, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    reason: { type: String, enum: offloadReasonValues, required: true, index: true },
    detail: { type: String, trim: true, maxlength: 1000, default: "" },
    airline: { type: String, trim: true, maxlength: 120, default: "" },
    affectedShipmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft" }],
    affectedBagIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "OperationsManifestBag" }],
    affectedParcels: [{
      _id: false,
      shipmentDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft", required: true },
      parcelNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 80 },
      actualWeightKg: { type: Number, required: true, min: 0 },
      volumetricWeightKg: { type: Number, required: true, min: 0 },
      chargeableWeightKg: { type: Number, required: true, min: 0 }
    }],
    affectedWeightKg: { type: Number, required: true, min: 0, default: 0 },
    affectedPieces: { type: Number, required: true, min: 0, default: 0 },
    responsibleEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

schema.index({ flightLinehaulId: 1, createdAt: -1 });
schema.index({ replacementFlightId: 1 });
schema.index({ "affectedParcels.shipmentDraftId": 1, createdAt: -1 });

export const FlightOffload = mongoose.model<IFlightOffload>("FlightOffload", schema);
