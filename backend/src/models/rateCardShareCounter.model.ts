import mongoose from "mongoose";

export interface IRateCardShareCounter extends mongoose.Document {
  financialYear: string;
  sequence: number;
}

const rateCardShareCounterSchema = new mongoose.Schema<IRateCardShareCounter>({
  financialYear: { type: String, required: true, unique: true, trim: true },
  sequence: { type: Number, required: true, min: 0, default: 0 }
}, { timestamps: true });

export const RateCardShareCounter = mongoose.model<IRateCardShareCounter>(
  "RateCardShareCounter",
  rateCardShareCounterSchema
);
