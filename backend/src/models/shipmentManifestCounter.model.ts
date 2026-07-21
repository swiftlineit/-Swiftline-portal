import mongoose from "mongoose";

export interface IShipmentManifestCounter {
  _id: string;
  sequence: number;
}

const shipmentManifestCounterSchema = new mongoose.Schema<IShipmentManifestCounter>({
  _id: { type: String, required: true },
  sequence: { type: Number, required: true, min: 0, default: 0 }
}, { versionKey: false });

export const ShipmentManifestCounter = mongoose.model<IShipmentManifestCounter>(
  "ShipmentManifestCounter",
  shipmentManifestCounterSchema
);
