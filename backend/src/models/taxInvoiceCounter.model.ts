import mongoose from "mongoose";

export interface ITaxInvoiceCounter extends mongoose.Document {
  counterType: "TAX_INVOICE";
  seq: number;
}

const taxInvoiceCounterSchema = new mongoose.Schema<ITaxInvoiceCounter>(
  {
    counterType: { type: String, enum: ["TAX_INVOICE"], required: true, unique: true },
    seq: { type: Number, required: true, default: 0 }
  },
  { timestamps: true }
);

export const TaxInvoiceCounter = mongoose.model<ITaxInvoiceCounter>("TaxInvoiceCounter", taxInvoiceCounterSchema);
