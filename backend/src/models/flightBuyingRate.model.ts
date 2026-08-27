import mongoose from "mongoose";

export const flightRateRegionValues = ["UK", "US", "EUROPE", "CANADA"] as const;
export type FlightRateRegion = (typeof flightRateRegionValues)[number];

export const flightBuyingRateStatusValues = ["ACTIVE", "DELETED"] as const;
export type FlightBuyingRateStatus = (typeof flightBuyingRateStatusValues)[number];

export interface IFlightBuyingRate extends mongoose.Document {
  vendorId: mongoose.Types.ObjectId;
  region: FlightRateRegion;
  airFreightRateMinorPerKg: number;
  gstBasisPoints: number;
  eicfRateMinorPerKg: number;
  customsMinor: number;
  transportationMinor: number;
  cflMinorPerBagGbp: number;
  dpdLabelMinorGbp: number;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  status: FlightBuyingRateStatus;
  createdBy: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId | null;
  deletedBy?: mongoose.Types.ObjectId | null;
  deletedAt?: Date | null;
  deletionReason: string;
  createdAt: Date;
  updatedAt: Date;
}

const safeMinor = {
  validator: (value: number) => Number.isSafeInteger(value),
  message: "Money values must use integer minor units."
};

const schema = new mongoose.Schema<IFlightBuyingRate>({
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "LogisticsVendor", required: true, index: true },
  region: { type: String, enum: flightRateRegionValues, required: true, index: true },
  airFreightRateMinorPerKg: { type: Number, required: true, min: 0, validate: safeMinor },
  gstBasisPoints: { type: Number, required: true, min: 0, max: 10_000, default: 1_800 },
  eicfRateMinorPerKg: { type: Number, required: true, min: 0, validate: safeMinor },
  customsMinor: { type: Number, required: true, min: 0, validate: safeMinor },
  transportationMinor: { type: Number, required: true, min: 0, validate: safeMinor },
  cflMinorPerBagGbp: { type: Number, required: true, min: 0, validate: safeMinor },
  dpdLabelMinorGbp: { type: Number, required: true, min: 0, validate: safeMinor },
  effectiveFrom: { type: Date, required: true, index: true },
  effectiveTo: { type: Date, default: null, index: true },
  status: { type: String, enum: flightBuyingRateStatusValues, required: true, default: "ACTIVE", index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  deletedAt: { type: Date, default: null },
  deletionReason: { type: String, trim: true, maxlength: 500, default: "" }
}, { timestamps: true });

schema.path("effectiveTo").validate(function validateEffectiveRange(value: Date | null | undefined) {
  return !value || value >= this.effectiveFrom;
}, "The end date must not be before the start date.");

schema.index({ vendorId: 1, region: 1, status: 1, effectiveFrom: -1 });

export const FlightBuyingRate = mongoose.model<IFlightBuyingRate>("FlightBuyingRate", schema);
