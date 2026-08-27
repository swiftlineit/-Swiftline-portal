import mongoose from "mongoose";
import { flightRateRegionValues, type FlightRateRegion } from "./flightBuyingRate.model.js";

export const flightCostSheetStatusValues = ["DRAFT", "FINALIZED", "REVIEW_REQUIRED", "CANCELLED"] as const;
export type FlightCostSheetStatus = (typeof flightCostSheetStatusValues)[number];

export type FlightCostTotals = {
  airFreightBaseMinor: number;
  airFreightGstMinor: number;
  airFreightTotalMinor: number;
  eicfMinor: number;
  customsMinor: number;
  transportationMinor: number;
  cflGbpMinor: number;
  cflInrMinor: number;
  dpdLabelsGbpMinor: number;
  dpdLabelsInrMinor: number;
  totalCostMinor: number;
  totalRevenueMinor: number;
  grossProfitMinor: number;
  marginBasisPoints?: number | null;
};

export interface IFlightCostSheet extends mongoose.Document {
  operationsManifestId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  buyingRateId: mongoose.Types.ObjectId;
  vendorId: mongoose.Types.ObjectId;
  manifestNumber: string;
  region: FlightRateRegion;
  airlineName: string;
  mawbNumber: string;
  flightNumber: string;
  flightDate: string;
  destinationCountryCode: string;
  destinationCountryName: string;
  manifestWeightKg: number;
  billedWeightKg: number;
  billedWeightOverrideReason: string;
  totalBags: number;
  totalParcels: number;
  portalDpdLabels: number;
  externalPaidLabels: number;
  externalLabelReference: string;
  externalLabelReason: string;
  missingDpdLabels: number;
  billableLabels: number;
  rateSnapshot: {
    airFreightRateMinorPerKg: number;
    gstBasisPoints: number;
    eicfRateMinorPerKg: number;
    customsMinor: number;
    transportationMinor: number;
    cflMinorPerBagGbp: number;
    dpdLabelMinorGbp: number;
  };
  fxSnapshot: {
    gbpToInr: number;
    provider: string;
    providerUpdatedAt?: Date | null;
    fetchedAt: Date;
    isManual: boolean;
    manualReason: string;
  };
  totals: FlightCostTotals;
  status: FlightCostSheetStatus;
  version: number;
  revision: number;
  notes: string;
  lastChangeReason: string;
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId;
  finalizedBy?: mongoose.Types.ObjectId | null;
  finalizedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const integerMinor = { validator: (value: number) => Number.isSafeInteger(value), message: "Money values must use integer minor units." };
const moneyField = { type: Number, required: true, default: 0, validate: integerMinor } as const;

const rateSnapshotSchema = new mongoose.Schema({
  airFreightRateMinorPerKg: { type: Number, required: true, min: 0, validate: integerMinor },
  gstBasisPoints: { type: Number, required: true, min: 0, max: 10_000 },
  eicfRateMinorPerKg: { type: Number, required: true, min: 0, validate: integerMinor },
  customsMinor: { type: Number, required: true, min: 0, validate: integerMinor },
  transportationMinor: { type: Number, required: true, min: 0, validate: integerMinor },
  cflMinorPerBagGbp: { type: Number, required: true, min: 0, validate: integerMinor },
  dpdLabelMinorGbp: { type: Number, required: true, min: 0, validate: integerMinor }
}, { _id: false });

const totalsSchema = new mongoose.Schema({
  airFreightBaseMinor: moneyField,
  airFreightGstMinor: moneyField,
  airFreightTotalMinor: moneyField,
  eicfMinor: moneyField,
  customsMinor: moneyField,
  transportationMinor: moneyField,
  cflGbpMinor: moneyField,
  cflInrMinor: moneyField,
  dpdLabelsGbpMinor: moneyField,
  dpdLabelsInrMinor: moneyField,
  totalCostMinor: moneyField,
  totalRevenueMinor: moneyField,
  grossProfitMinor: { type: Number, required: true, default: 0, validate: integerMinor },
  marginBasisPoints: { type: Number, default: null }
}, { _id: false });

const schema = new mongoose.Schema<IFlightCostSheet>({
  operationsManifestId: { type: mongoose.Schema.Types.ObjectId, ref: "OperationsManifest", required: true, unique: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  buyingRateId: { type: mongoose.Schema.Types.ObjectId, ref: "FlightBuyingRate", required: true, index: true },
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "LogisticsVendor", required: true, index: true },
  manifestNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 40, index: true },
  region: { type: String, enum: flightRateRegionValues, required: true, index: true },
  airlineName: { type: String, required: true, trim: true, maxlength: 120 },
  mawbNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
  flightNumber: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
  flightDate: { type: String, required: true, trim: true, maxlength: 10, index: true },
  destinationCountryCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 2 },
  destinationCountryName: { type: String, required: true, trim: true, maxlength: 100 },
  manifestWeightKg: { type: Number, required: true, min: 0 },
  billedWeightKg: { type: Number, required: true, min: 0.001 },
  billedWeightOverrideReason: { type: String, trim: true, maxlength: 500, default: "" },
  totalBags: { type: Number, required: true, min: 0 },
  totalParcels: { type: Number, required: true, min: 0 },
  portalDpdLabels: { type: Number, required: true, min: 0 },
  externalPaidLabels: { type: Number, required: true, min: 0, default: 0 },
  externalLabelReference: { type: String, trim: true, maxlength: 120, default: "" },
  externalLabelReason: { type: String, trim: true, maxlength: 500, default: "" },
  missingDpdLabels: { type: Number, required: true, min: 0 },
  billableLabels: { type: Number, required: true, min: 0 },
  rateSnapshot: { type: rateSnapshotSchema, required: true },
  fxSnapshot: {
    gbpToInr: { type: Number, required: true, min: 0.000001 },
    provider: { type: String, required: true, trim: true, maxlength: 80 },
    providerUpdatedAt: { type: Date, default: null },
    fetchedAt: { type: Date, required: true },
    isManual: { type: Boolean, required: true, default: false },
    manualReason: { type: String, trim: true, maxlength: 500, default: "" }
  },
  totals: { type: totalsSchema, required: true },
  status: { type: String, enum: flightCostSheetStatusValues, required: true, default: "DRAFT", index: true },
  version: { type: Number, required: true, min: 1, default: 1 },
  revision: { type: Number, required: true, min: 1, default: 1 },
  notes: { type: String, trim: true, maxlength: 1000, default: "" },
  lastChangeReason: { type: String, required: true, trim: true, maxlength: 500 },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  finalizedAt: { type: Date, default: null }
}, { timestamps: true });

schema.index({ branchId: 1, flightDate: -1, status: 1 });
schema.index({ vendorId: 1, flightDate: -1 });

export const FlightCostSheet = mongoose.model<IFlightCostSheet>("FlightCostSheet", schema);
