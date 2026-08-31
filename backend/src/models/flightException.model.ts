import mongoose from "mongoose";

export const flightExceptionTypeValues = [
  "FLIGHT_DELAY",
  "NOT_MANIFESTED",
  "OFFLOAD",
  "MISSED_CONNECTION",
  "RISKY_CONNECTION",
  "ARRIVAL_WITHOUT_CUSTOMS",
  "CUSTOMS_CLEARED_WITHOUT_HANDOVER",
  "CAPACITY_WARNING",
  "CAPACITY_EXCEEDED",
  "MISSING_DOCUMENT",
  "HANDOVER_OVERDUE",
  "OTHER"
] as const;
export type FlightExceptionType = (typeof flightExceptionTypeValues)[number];

export const flightExceptionSeverityValues = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type FlightExceptionSeverity = (typeof flightExceptionSeverityValues)[number];

export const flightExceptionStatusValues = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;
export type FlightExceptionStatus = (typeof flightExceptionStatusValues)[number];

export interface IFlightException extends mongoose.Document {
  flightLinehaulId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  type: FlightExceptionType;
  severity: FlightExceptionSeverity;
  status: FlightExceptionStatus;
  title: string;
  description: string;
  shipmentDraftId?: mongoose.Types.ObjectId | null;
  bagId?: mongoose.Types.ObjectId | null;
  manifestId?: mongoose.Types.ObjectId | null;
  assignedTo?: mongoose.Types.ObjectId | null;
  dedupeKey: string;
  dueAt?: Date | null;
  acknowledgedAt?: Date | null;
  acknowledgedBy?: mongoose.Types.ObjectId | null;
  resolvedAt?: Date | null;
  resolvedBy?: mongoose.Types.ObjectId | null;
  resolutionNotes: string;
  createdBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new mongoose.Schema<IFlightException>(
  {
    flightLinehaulId: { type: mongoose.Schema.Types.ObjectId, ref: "FlightLinehaul", required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    type: { type: String, enum: flightExceptionTypeValues, required: true, index: true },
    severity: { type: String, enum: flightExceptionSeverityValues, required: true, default: "MEDIUM", index: true },
    status: { type: String, enum: flightExceptionStatusValues, required: true, default: "OPEN", index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000, default: "" },
    shipmentDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft", default: null, index: true },
    bagId: { type: mongoose.Schema.Types.ObjectId, ref: "OperationsManifestBag", default: null },
    manifestId: { type: mongoose.Schema.Types.ObjectId, ref: "OperationsManifest", default: null },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    dedupeKey: { type: String, required: true, trim: true, maxlength: 300, index: true },
    dueAt: { type: Date, default: null, index: true },
    acknowledgedAt: { type: Date, default: null },
    acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolutionNotes: { type: String, trim: true, maxlength: 1000, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { timestamps: true }
);

schema.index({ dedupeKey: 1 }, { unique: true, name: "uniq_exception_dedupe" });
schema.index({ branchId: 1, status: 1, severity: -1, createdAt: -1 });
schema.index({ flightLinehaulId: 1, status: 1 });
schema.index({ assignedTo: 1, status: 1 });

export const FlightException = mongoose.model<IFlightException>("FlightException", schema);
