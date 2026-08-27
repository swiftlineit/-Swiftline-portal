import mongoose from "mongoose";

export interface IExchangeRateCache extends mongoose.Document {
  baseCurrency: string;
  targetCurrency: string;
  gbpToInr: number;
  provider: string;
  providerUpdatedAt?: Date | null;
  fetchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new mongoose.Schema<IExchangeRateCache>({
  baseCurrency: { type: String, required: true, default: "GBP", uppercase: true, index: true },
  targetCurrency: { type: String, required: true, default: "INR", uppercase: true, index: true },
  gbpToInr: { type: Number, required: true, min: 0.000001 },
  provider: { type: String, required: true, default: "ExchangeRate-API" },
  providerUpdatedAt: { type: Date, default: null },
  fetchedAt: { type: Date, required: true, index: true }
}, { timestamps: true });

schema.index({ baseCurrency: 1, targetCurrency: 1, fetchedAt: -1 });

export const ExchangeRateCache = mongoose.model<IExchangeRateCache>("ExchangeRateCache", schema);
