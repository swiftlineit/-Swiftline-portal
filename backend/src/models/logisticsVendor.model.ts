import mongoose from "mongoose";

export const logisticsVendorTypeValues = [
  "AIRLINE",
  "CARRIER",
  "FREIGHT_AGENT",
  "CUSTOMS_BROKER",
  "PICKUP_VENDOR",
  "DELIVERY_VENDOR",
  "OTHER"
] as const;
export type LogisticsVendorType = (typeof logisticsVendorTypeValues)[number];

export const logisticsVendorStatusValues = ["ACTIVE", "INACTIVE"] as const;
export type LogisticsVendorStatus = (typeof logisticsVendorStatusValues)[number];

export const logisticsVendorIntegrationValues = ["", "ALS_DPD"] as const;
export type LogisticsVendorIntegration = (typeof logisticsVendorIntegrationValues)[number];

export interface ILogisticsVendor extends mongoose.Document {
  name: string;
  code: string;
  type: LogisticsVendorType;
  integrationCode: LogisticsVendorIntegration;
  status: LogisticsVendorStatus;
  createdBy: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new mongoose.Schema<ILogisticsVendor>({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  code: { type: String, required: true, trim: true, uppercase: true, maxlength: 24, unique: true, index: true },
  type: { type: String, enum: logisticsVendorTypeValues, required: true, index: true },
  integrationCode: { type: String, enum: logisticsVendorIntegrationValues, default: "" },
  status: { type: String, enum: logisticsVendorStatusValues, default: "ACTIVE", required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
}, { timestamps: true });

schema.index(
  { integrationCode: 1 },
  { unique: true, partialFilterExpression: { integrationCode: { $type: "string", $gt: "" } } }
);
schema.index({ status: 1, name: 1 });

export const LogisticsVendor = mongoose.model<ILogisticsVendor>("LogisticsVendor", schema);
