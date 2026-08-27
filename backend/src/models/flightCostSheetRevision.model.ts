import mongoose from "mongoose";
import type { FlightCostTotals } from "./flightCostSheet.model.js";

export interface IFlightCostSheetRevision extends mongoose.Document {
  flightCostSheetId: mongoose.Types.ObjectId;
  operationsManifestId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  revision: number;
  version: number;
  status: string;
  manifestNumber: string;
  totals: FlightCostTotals;
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
  facts: {
    manifestWeightKg: number;
    billedWeightKg: number;
    totalBags: number;
    totalParcels: number;
    portalDpdLabels: number;
    externalPaidLabels: number;
    billableLabels: number;
    missingDpdLabels: number;
  };
  changeReason: string;
  changedBy: mongoose.Types.ObjectId;
  createdAt: Date;
}

const revisionSchema = new mongoose.Schema<IFlightCostSheetRevision>({
  flightCostSheetId: { type: mongoose.Schema.Types.ObjectId, ref: "FlightCostSheet", required: true, index: true },
  operationsManifestId: { type: mongoose.Schema.Types.ObjectId, ref: "OperationsManifest", required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  revision: { type: Number, required: true, min: 1 },
  version: { type: Number, required: true, min: 1 },
  status: { type: String, required: true },
  manifestNumber: { type: String, required: true },
  totals: { type: mongoose.Schema.Types.Mixed, required: true },
  rateSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  fxSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  facts: { type: mongoose.Schema.Types.Mixed, required: true },
  changeReason: { type: String, required: true, maxlength: 500 },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
}, { timestamps: { createdAt: true, updatedAt: false } });

revisionSchema.index({ flightCostSheetId: 1, revision: 1 }, { unique: true });
revisionSchema.index({ operationsManifestId: 1, createdAt: -1 });

export const FlightCostSheetRevision = mongoose.model<IFlightCostSheetRevision>("FlightCostSheetRevision", revisionSchema);
