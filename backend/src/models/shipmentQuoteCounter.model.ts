import mongoose from "mongoose";

export interface IShipmentQuoteCounter extends mongoose.Document {
  financialYear: string;
  sequence: number;
}

const shipmentQuoteCounterSchema = new mongoose.Schema<IShipmentQuoteCounter>({
  financialYear: { type: String, required: true, unique: true, trim: true },
  sequence: { type: Number, required: true, min: 0, default: 0 }
}, { timestamps: true });

export const ShipmentQuoteCounter = mongoose.model<IShipmentQuoteCounter>(
  "ShipmentQuoteCounter",
  shipmentQuoteCounterSchema
);
