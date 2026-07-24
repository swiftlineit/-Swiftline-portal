import mongoose from "mongoose";

export interface ISwiftlineStationCounter extends mongoose.Document {
  stationCode: string;
  dateKey: string;
  sequence: number;
}

const swiftlineStationCounterSchema = new mongoose.Schema<ISwiftlineStationCounter>(
  {
    stationCode: { type: String, required: true, uppercase: true, trim: true, match: /^[A-Z]{3}$/ },
    dateKey: { type: String, required: true, trim: true, match: /^\d{8}$/ },
    sequence: { type: Number, required: true, min: 1 }
  },
  { timestamps: true }
);

swiftlineStationCounterSchema.index({ stationCode: 1, dateKey: 1 }, { unique: true });

export const SwiftlineStationCounter = mongoose.model<ISwiftlineStationCounter>(
  "SwiftlineStationCounter",
  swiftlineStationCounterSchema
);
