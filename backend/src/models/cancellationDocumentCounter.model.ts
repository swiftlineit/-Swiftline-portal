import mongoose from "mongoose";

export interface ICancellationDocumentCounter extends mongoose.Document {
  financialYear: string;
  documentType: "CREDIT_NOTE" | "FEE_INVOICE";
  sequence: number;
}

const schema = new mongoose.Schema<ICancellationDocumentCounter>({
  financialYear: { type: String, required: true, trim: true },
  documentType: { type: String, enum: ["CREDIT_NOTE", "FEE_INVOICE"], required: true },
  sequence: { type: Number, required: true, default: 0, min: 0 }
}, { timestamps: true });

schema.index({ financialYear: 1, documentType: 1 }, { unique: true });

export const CancellationDocumentCounter = mongoose.model<ICancellationDocumentCounter>(
  "CancellationDocumentCounter",
  schema
);
