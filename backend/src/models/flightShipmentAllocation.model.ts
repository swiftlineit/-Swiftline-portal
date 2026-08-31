import mongoose from "mongoose";

export const allocationStatusValues = ["ALLOCATED", "REMOVED", "OFFLOADED"] as const;
export type AllocationStatus = (typeof allocationStatusValues)[number];

export interface IFlightShipmentAllocation extends mongoose.Document {
  flightLinehaulId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  shipmentDraftId: mongoose.Types.ObjectId;
  dpdShipmentId: mongoose.Types.ObjectId;
  awb: string;
  destinationCountryCode: string;
  destinationCountryName: string;
  weightKg: number;
  pieces: number;
  snapshot: Record<string, unknown>;
  status: AllocationStatus;
  allocatedBy: mongoose.Types.ObjectId;
  allocatedAt: Date;
  removedBy?: mongoose.Types.ObjectId | null;
  removedAt?: Date | null;
  removalReason: string;
  offloadId?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new mongoose.Schema<IFlightShipmentAllocation>(
  {
    flightLinehaulId: { type: mongoose.Schema.Types.ObjectId, ref: "FlightLinehaul", required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    shipmentDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft", required: true, index: true },
    dpdShipmentId: { type: mongoose.Schema.Types.ObjectId, ref: "DpdShipment", required: true, index: true },
    awb: { type: String, trim: true, uppercase: true, maxlength: 80, default: "" },
    destinationCountryCode: { type: String, trim: true, uppercase: true, maxlength: 2, default: "" },
    destinationCountryName: { type: String, trim: true, maxlength: 100, default: "" },
    weightKg: { type: Number, required: true, min: 0 },
    pieces: { type: Number, required: true, min: 0 },
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: allocationStatusValues, required: true, default: "ALLOCATED", index: true },
    allocatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    allocatedAt: { type: Date, default: Date.now },
    removedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    removedAt: { type: Date, default: null },
    removalReason: { type: String, trim: true, maxlength: 500, default: "" },
    offloadId: { type: mongoose.Schema.Types.ObjectId, ref: "FlightOffload", default: null }
  },
  { timestamps: true }
);

// Enforce one active allocation per shipment (terminal statuses allow multiple historical rows)
schema.index(
  { shipmentDraftId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "ALLOCATED" },
    name: "uniq_active_allocation_per_shipment"
  }
);
schema.index({ flightLinehaulId: 1, status: 1 });
schema.index({ flightLinehaulId: 1, shipmentDraftId: 1 }, { unique: true, name: "uniq_flight_shipment" });
schema.index({ branchId: 1, status: 1, allocatedAt: -1 });

export const FlightShipmentAllocation = mongoose.model<IFlightShipmentAllocation>(
  "FlightShipmentAllocation",
  schema
);
