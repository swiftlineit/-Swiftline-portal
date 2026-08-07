import mongoose from "mongoose";

export const pickupAttemptStatusValues = [
  "SCHEDULED", "ASSIGNED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "COLLECTING",
  "PROOF_REVIEW_REQUIRED", "COMPLETED", "FAILED", "CANCELLED"
] as const;

export interface IPickupAttempt extends mongoose.Document {
  pickupRequestId: mongoose.Types.ObjectId;
  sequence: number;
  status: (typeof pickupAttemptStatusValues)[number];
  scheduledWindow: { startAt: Date; endAt: Date; timezone: string };
  assignedDriverProfileId?: mongoose.Types.ObjectId | null;
  assignedDriverUserId?: mongoose.Types.ObjectId | null;
  vehicle: { source?: string; type?: string; registrationNumber?: string };
  assignedBy?: mongoose.Types.ObjectId | null;
  acceptedAt?: Date | null;
  enRouteAt?: Date | null;
  arrivedAt?: Date | null;
  collectionStartedAt?: Date | null;
  completedAt?: Date | null;
  failedAt?: Date | null;
  failureReason?: string;
  otpVerifiedAt?: Date | null;
  otpHash?: string;
  otpExpiresAt?: Date | null;
  otpAttempts: number;
  otpSentAt?: Date | null;
  otpExceptionReason?: string;
  otpExceptionRequestedAt?: Date | null;
  otpExceptionApprovedBy?: mongoose.Types.ObjectId | null;
  otpExceptionApprovedAt?: Date | null;
  otpExceptionRejectedBy?: mongoose.Types.ObjectId | null;
  otpExceptionRejectedAt?: Date | null;
  otpExceptionReviewNote?: string;
  arrivalLocation?: { latitude: number; longitude: number; accuracy?: number | null; capturedAt: Date } | null;
  completionLocation?: { latitude: number; longitude: number; accuracy?: number | null; capturedAt: Date } | null;
  createdAt: Date;
  updatedAt: Date;
}

const pickupAttemptSchema = new mongoose.Schema<IPickupAttempt>(
  {
    pickupRequestId: { type: mongoose.Schema.Types.ObjectId, ref: "PickupRequest", required: true, index: true },
    sequence: { type: Number, min: 1, required: true },
    status: { type: String, enum: pickupAttemptStatusValues, default: "SCHEDULED", required: true, index: true },
    scheduledWindow: {
      startAt: { type: Date, required: true },
      endAt: { type: Date, required: true },
      timezone: { type: String, trim: true, maxlength: 80, required: true }
    },
    assignedDriverProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "DriverProfile", default: null, index: true },
    assignedDriverUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    vehicle: {
      source: { type: String, enum: ["COMPANY_OWNED", "DRIVER_OWNED", "HIRED", "VENDOR_OWNED", ""], default: "" },
      type: { type: String, trim: true, maxlength: 60, default: "" },
      registrationNumber: { type: String, trim: true, uppercase: true, maxlength: 30, default: "" }
    },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    acceptedAt: { type: Date, default: null },
    enRouteAt: { type: Date, default: null },
    arrivedAt: { type: Date, default: null },
    collectionStartedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    failureReason: { type: String, trim: true, maxlength: 500, default: "" },
    otpVerifiedAt: { type: Date, default: null },
    otpHash: { type: String, default: "", select: false },
    otpExpiresAt: { type: Date, default: null, select: false },
    otpAttempts: { type: Number, min: 0, default: 0, select: false },
    otpSentAt: { type: Date, default: null, select: false },
    otpExceptionReason: { type: String, trim: true, maxlength: 500, default: "" },
    otpExceptionRequestedAt: { type: Date, default: null },
    otpExceptionApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    otpExceptionApprovedAt: { type: Date, default: null },
    otpExceptionRejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    otpExceptionRejectedAt: { type: Date, default: null },
    otpExceptionReviewNote: { type: String, trim: true, maxlength: 500, default: "" },
    arrivalLocation: {
      latitude: { type: Number, min: -90, max: 90 },
      longitude: { type: Number, min: -180, max: 180 },
      accuracy: { type: Number, min: 0, default: null },
      capturedAt: { type: Date }
    },
    completionLocation: {
      latitude: { type: Number, min: -90, max: 90 },
      longitude: { type: Number, min: -180, max: 180 },
      accuracy: { type: Number, min: 0, default: null },
      capturedAt: { type: Date }
    }
  },
  { timestamps: true }
);

pickupAttemptSchema.index({ pickupRequestId: 1, sequence: 1 }, { unique: true });
pickupAttemptSchema.index({ assignedDriverUserId: 1, status: 1, "scheduledWindow.startAt": 1 });

export const PickupAttempt = mongoose.model<IPickupAttempt>("PickupAttempt", pickupAttemptSchema);
