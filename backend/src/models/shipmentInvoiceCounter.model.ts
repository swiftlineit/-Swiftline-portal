import mongoose from "mongoose";

export interface IShipmentInvoiceCounter extends mongoose.Document {
  financialYear: string;
  sequence: number;
}

const shipmentInvoiceCounterSchema = new mongoose.Schema<IShipmentInvoiceCounter>(
  {
    financialYear: { type: String, required: true, unique: true, trim: true },
    sequence: { type: Number, required: true, default: 0, min: 0 }
  },
  { timestamps: true }
);

export const ShipmentInvoiceCounter = mongoose.model<IShipmentInvoiceCounter>(
  "ShipmentInvoiceCounter",
  shipmentInvoiceCounterSchema
);
