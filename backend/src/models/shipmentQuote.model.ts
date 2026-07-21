import mongoose from "mongoose";

export const shipmentQuoteStatusValues = [
  "REQUESTED", "UNDER_REVIEW", "QUOTED", "DECLINED", "EXPIRED", "CONVERTED"
] as const;
export type ShipmentQuoteStatus = (typeof shipmentQuoteStatusValues)[number];
export const shipmentQuoteSourceValues = ["CLIENT", "ADMIN"] as const;
export type ShipmentQuoteSource = (typeof shipmentQuoteSourceValues)[number];

export interface IShipmentQuote extends mongoose.Document {
  quoteNumber: string;
  businessAccountId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  source: ShipmentQuoteSource;
  status: ShipmentQuoteStatus;
  requestSnapshot: Record<string, unknown>;
  estimateSnapshot: Record<string, unknown>;
  finalPricingSnapshot?: Record<string, unknown> | null;
  customerNote: string;
  internalNote: string;
  requestedBy: mongoose.Types.ObjectId;
  reviewedBy?: mongoose.Types.ObjectId | null;
  reviewedAt?: Date | null;
  validUntil?: Date | null;
  convertedDraftId?: mongoose.Types.ObjectId | null;
  convertedAt?: Date | null;
  statusHistory: Array<{ status: ShipmentQuoteStatus; changedAt: Date; changedBy: mongoose.Types.ObjectId; note?: string }>;
  createdAt: Date;
  updatedAt: Date;
}

const statusHistorySchema = new mongoose.Schema({
  status: { type: String, enum: shipmentQuoteStatusValues, required: true },
  changedAt: { type: Date, required: true, default: Date.now },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  note: { type: String, trim: true, maxlength: 500, default: "" }
}, { _id: false });

const shipmentQuoteSchema = new mongoose.Schema<IShipmentQuote>({
  quoteNumber: { type: String, required: true, unique: true, trim: true, index: true },
  businessAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessAccount", required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  source: { type: String, enum: shipmentQuoteSourceValues, required: true },
  status: { type: String, enum: shipmentQuoteStatusValues, required: true, default: "REQUESTED", index: true },
  // Snapshots preserve exactly what the customer entered and Swiftline calculated.
  requestSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  estimateSnapshot: { type: mongoose.Schema.Types.Mixed, required: true },
  finalPricingSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  customerNote: { type: String, trim: true, maxlength: 1000, default: "" },
  internalNote: { type: String, trim: true, maxlength: 1000, default: "" },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
  validUntil: { type: Date, default: null, index: true },
  convertedDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft", default: null },
  convertedAt: { type: Date, default: null },
  statusHistory: { type: [statusHistorySchema], default: [] }
}, { timestamps: true });

shipmentQuoteSchema.index({ businessAccountId: 1, createdAt: -1 });
shipmentQuoteSchema.index({ status: 1, validUntil: 1 });

export const ShipmentQuote = mongoose.model<IShipmentQuote>("ShipmentQuote", shipmentQuoteSchema);
