import mongoose from "mongoose";

export interface ISwiftlineTrackingCounter extends mongoose.Document {
  branchId: mongoose.Types.ObjectId;
  dateKey: string;
  sequence: number;
}

const swiftlineTrackingCounterSchema = new mongoose.Schema<ISwiftlineTrackingCounter>(
  {
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    dateKey: { type: String, required: true, trim: true, match: /^\d{8}$/, index: true },
    sequence: { type: Number, required: true, min: 1 }
  },
  { timestamps: true }
);

swiftlineTrackingCounterSchema.index({ branchId: 1, dateKey: 1 }, { unique: true });

export const SwiftlineTrackingCounter = mongoose.model<ISwiftlineTrackingCounter>(
  "SwiftlineTrackingCounter",
  swiftlineTrackingCounterSchema
);
