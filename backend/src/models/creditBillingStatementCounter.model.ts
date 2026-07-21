import mongoose from "mongoose";

export interface ICreditBillingStatementCounter extends mongoose.Document {
  financialYear: string;
  sequence: number;
}

const creditBillingStatementCounterSchema = new mongoose.Schema<ICreditBillingStatementCounter>({
  financialYear: { type: String, required: true, unique: true, trim: true },
  sequence: { type: Number, required: true, min: 0, default: 0 }
}, { timestamps: true });

export const CreditBillingStatementCounter = mongoose.model<ICreditBillingStatementCounter>(
  "CreditBillingStatementCounter",
  creditBillingStatementCounterSchema
);
