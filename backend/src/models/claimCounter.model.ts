import mongoose from "mongoose";

/**
 * Financial-year sequence behind `CLM/26-27/00001`.
 *
 * Matches the counters already used for invoices, rate-card shares, credit
 * statements, and cancellation documents — same shape, same atomic `$inc`
 * upsert, so the numbering behaves the way the rest of the portal's documents
 * already do.
 */
export interface IClaimCounter extends mongoose.Document {
  financialYear: string;
  sequence: number;
}

const claimCounterSchema = new mongoose.Schema<IClaimCounter>(
  {
    financialYear: { type: String, required: true, unique: true, trim: true },
    sequence: { type: Number, required: true, min: 0, default: 0 }
  },
  { timestamps: true }
);

export const ClaimCounter = mongoose.model<IClaimCounter>("ClaimCounter", claimCounterSchema);
