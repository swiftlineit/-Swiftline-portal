import mongoose from "mongoose";
import {
  paymentSourceValues,
  shippingEnvironmentValues,
  type PaymentSource,
  type ShippingEnvironment
} from "./financialTypes.js";

export const dpdShipmentStatusValues = [
  "DPD_CREATING",
  "DPD_CREATED",
  "LABEL_RECEIVED",
  "DPD_REJECTED",
  "DPD_STATUS_UNKNOWN"
] as const;

export type DpdShipmentStatus = (typeof dpdShipmentStatusValues)[number];
export const dpdProviderModeValues = ["SIMULATED", "LIVE"] as const;
export type DpdProviderMode = (typeof dpdProviderModeValues)[number];
export const shipmentBookingProviderValues = ["DPD", "SWIFTLINE"] as const;
export type ShipmentBookingProvider = (typeof shipmentBookingProviderValues)[number];

export interface IDpdShipment extends mongoose.Document {
  shipmentDraftId: mongoose.Types.ObjectId;
  idempotencyKey: string;
  dpdShipmentId?: string;
  dpdTransactionId?: string;
  swiftlineTrackingNumber?: string;
  bookingProvider: ShipmentBookingProvider;
  providerMode: DpdProviderMode;
  parcelNumbers: string[];
  serviceCode: string;
  bookingSnapshot: Record<string, unknown>;
  currentShipmentSnapshot: Record<string, unknown>;
  snapshotRevision: number;
  requestSnapshot: Record<string, unknown>;
  responseSnapshot: Record<string, unknown>;
  paymentSource: PaymentSource;
  shippingEnvironment: ShippingEnvironment;
  status: DpdShipmentStatus;
  createdAt: Date;
  updatedAt: Date;
}

const dpdShipmentSchema = new mongoose.Schema<IDpdShipment>(
  {
    shipmentDraftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ShipmentDraft",
      required: true,
      unique: true,
      index: true
    },
    idempotencyKey: { type: String, required: true, unique: true, trim: true, maxlength: 256 },
    dpdShipmentId: { type: String, trim: true, maxlength: 120, default: "" },
    dpdTransactionId: { type: String, trim: true, maxlength: 120, default: "" },
    swiftlineTrackingNumber: { type: String, trim: true, maxlength: 40, default: "" },
    bookingProvider: { type: String, enum: shipmentBookingProviderValues, default: "DPD", required: true, index: true },
    providerMode: { type: String, enum: dpdProviderModeValues, default: "SIMULATED", required: true, index: true },
    parcelNumbers: [{ type: String, trim: true, maxlength: 80 }],
    serviceCode: { type: String, required: true, trim: true, maxlength: 40 },
    bookingSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    currentShipmentSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    snapshotRevision: { type: Number, min: 1, default: 1 },
    requestSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    responseSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
    paymentSource: { type: String, enum: paymentSourceValues, default: "ADMIN_DIRECT", required: true },
    shippingEnvironment: { type: String, enum: shippingEnvironmentValues, default: "PRODUCTION", required: true, index: true },
    status: { type: String, enum: dpdShipmentStatusValues, default: "DPD_CREATING", index: true }
  },
  { timestamps: true }
);

dpdShipmentSchema.index({ status: 1, updatedAt: -1 });
dpdShipmentSchema.index(
  { swiftlineTrackingNumber: 1 },
  { unique: true, partialFilterExpression: { swiftlineTrackingNumber: { $type: "string", $gt: "" } } }
);

export const DpdShipment = mongoose.model<IDpdShipment>(
  "DpdShipment",
  dpdShipmentSchema
);
