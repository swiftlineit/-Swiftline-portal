import mongoose from "mongoose";
import { countryRateServiceValues, type CountryRateService } from "./countryRateCard.model.js";

export const profitabilityCostComponentValues = [
  "FREIGHT_BUYING",
  "AIRLINE_VENDOR",
  "FUEL_SURCHARGE",
  "HANDLING",
  "CUSTOMS_CLEARANCE",
  "PICKUP",
  "DELIVERY",
  "OTHER"
] as const;
export type ProfitabilityCostComponent = (typeof profitabilityCostComponentValues)[number];

export const vendorCostCalculationValues = ["PER_KG", "FLAT", "PERCENT_OF_FREIGHT"] as const;
export type VendorCostCalculation = (typeof vendorCostCalculationValues)[number];

export const vendorCostRateStatusValues = ["ACTIVE", "RETIRED"] as const;
export type VendorCostRateStatus = (typeof vendorCostRateStatusValues)[number];

export interface IVendorCostRate extends mongoose.Document {
  vendorId: mongoose.Types.ObjectId;
  component: ProfitabilityCostComponent;
  originCountryCode: string;
  destinationCountryCode: string;
  destinationCountryName: string;
  service: CountryRateService;
  fromKg: number;
  toKg: number;
  calculation: VendorCostCalculation;
  amountMinor: number;
  percentageBasisPoints: number;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  status: VendorCostRateStatus;
  createdBy: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const integerMinor = {
  validator: (value: number) => Number.isSafeInteger(value),
  message: "amountMinor must be an integer minor-unit amount"
};

const schema = new mongoose.Schema<IVendorCostRate>({
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "LogisticsVendor", required: true, index: true },
  component: { type: String, enum: profitabilityCostComponentValues, required: true, index: true },
  originCountryCode: { type: String, trim: true, uppercase: true, minlength: 2, maxlength: 2, default: "IN", required: true },
  destinationCountryCode: { type: String, trim: true, uppercase: true, minlength: 2, maxlength: 2, required: true, index: true },
  destinationCountryName: { type: String, trim: true, maxlength: 80, required: true },
  service: { type: String, enum: countryRateServiceValues, required: true, index: true },
  fromKg: { type: Number, required: true, min: 0 },
  toKg: { type: Number, required: true, min: 0 },
  calculation: { type: String, enum: vendorCostCalculationValues, required: true },
  amountMinor: { type: Number, required: true, min: 0, validate: integerMinor },
  percentageBasisPoints: { type: Number, required: true, min: 0, max: 10000, default: 0 },
  effectiveFrom: { type: Date, required: true, index: true },
  effectiveTo: { type: Date, default: null, index: true },
  status: { type: String, enum: vendorCostRateStatusValues, default: "ACTIVE", required: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
}, { timestamps: true });

schema.path("toKg").validate(function validateRange(value: number) {
  return value >= this.fromKg;
}, "toKg must be greater than or equal to fromKg");

schema.index({ vendorId: 1, destinationCountryCode: 1, service: 1, component: 1, effectiveFrom: -1 });

export const VendorCostRate = mongoose.model<IVendorCostRate>("VendorCostRate", schema);
