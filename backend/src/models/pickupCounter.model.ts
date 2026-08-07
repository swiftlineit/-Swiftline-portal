import mongoose from "mongoose";

const pickupCounterSchema = new mongoose.Schema({
  stationCode: { type: String, required: true, uppercase: true, trim: true },
  dateKey: { type: String, required: true, trim: true },
  sequence: { type: Number, min: 0, default: 0 }
}, { timestamps: true });

pickupCounterSchema.index({ stationCode: 1, dateKey: 1 }, { unique: true });

export const PickupCounter = mongoose.model("PickupCounter", pickupCounterSchema);
