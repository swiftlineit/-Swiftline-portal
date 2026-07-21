import mongoose from "mongoose";

export interface ICreditAgreementCounter extends mongoose.Document {
  businessAccountId: mongoose.Types.ObjectId;
  version: number;
}

const creditAgreementCounterSchema = new mongoose.Schema<ICreditAgreementCounter>({
  businessAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessAccount", required: true, unique: true, index: true },
  version: { type: Number, required: true, min: 0, default: 0 }
}, { timestamps: true });

export const CreditAgreementCounter = mongoose.model<ICreditAgreementCounter>(
  "CreditAgreementCounter",
  creditAgreementCounterSchema
);
