import mongoose from "mongoose";

export const pickupRequestStatusValues = [
  "REQUESTED", "CONFIRMED", "IN_PROGRESS", "ACTION_REQUIRED",
  "PARTIALLY_COLLECTED", "COLLECTED", "CANCELLED", "CLOSED_UNSUCCESSFUL"
] as const;
export type PickupRequestStatus = (typeof pickupRequestStatusValues)[number];

export interface IPickupRequest extends mongoose.Document {
  requestNumber: string;
  businessAccountId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  requestedBy: mongoose.Types.ObjectId;
  source: "CLIENT_PORTAL" | "ADMIN" | "API";
  status: PickupRequestStatus;
  addressFingerprint: string;
  pickupAddress: Record<string, unknown>;
  pickupContact: { name: string; email?: string; phone: string };
  requestedWindow: { startAt: Date; endAt: Date; timezone: string };
  confirmedWindow?: { startAt: Date; endAt: Date; timezone: string } | null;
  instructions?: string;
  shipmentCount: number;
  parcelCount: number;
  totalWeightKg: number;
  currentAttemptId?: mongoose.Types.ObjectId | null;
  version: number;
  cancelledBy?: mongoose.Types.ObjectId | null;
  cancelledAt?: Date | null;
  cancellationReason?: string;
  cancellationSource?: "CLIENT" | "ADMIN" | null;
  createdAt: Date;
  updatedAt: Date;
}

const windowSchema = new mongoose.Schema(
  {
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    timezone: { type: String, trim: true, maxlength: 80, required: true }
  },
  { _id: false }
);

const pickupRequestSchema = new mongoose.Schema<IPickupRequest>(
  {
    requestNumber: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    businessAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessAccount", required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    source: { type: String, enum: ["CLIENT_PORTAL", "ADMIN", "API"], required: true },
    status: { type: String, enum: pickupRequestStatusValues, default: "REQUESTED", required: true, index: true },
    addressFingerprint: { type: String, required: true, trim: true, maxlength: 500, index: true },
    pickupAddress: { type: mongoose.Schema.Types.Mixed, required: true },
    pickupContact: {
      name: { type: String, trim: true, maxlength: 120, required: true },
      email: { type: String, trim: true, lowercase: true, maxlength: 160, default: "" },
      phone: { type: String, trim: true, maxlength: 30, required: true }
    },
    requestedWindow: { type: windowSchema, required: true },
    confirmedWindow: { type: windowSchema, default: null },
    instructions: { type: String, trim: true, maxlength: 500, default: "" },
    shipmentCount: { type: Number, min: 1, required: true },
    parcelCount: { type: Number, min: 1, required: true },
    totalWeightKg: { type: Number, min: 0, required: true },
    currentAttemptId: { type: mongoose.Schema.Types.ObjectId, ref: "PickupAttempt", default: null },
    version: { type: Number, min: 1, default: 1, required: true },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, trim: true, maxlength: 500, default: "" },
    cancellationSource: { type: String, enum: ["CLIENT", "ADMIN", null], default: null }
  },
  { timestamps: true }
);

pickupRequestSchema.index({ branchId: 1, status: 1, "requestedWindow.startAt": 1 });
pickupRequestSchema.index({ businessAccountId: 1, createdAt: -1 });

export const PickupRequest = mongoose.model<IPickupRequest>("PickupRequest", pickupRequestSchema);
