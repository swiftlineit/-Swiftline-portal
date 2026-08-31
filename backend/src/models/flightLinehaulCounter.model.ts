import mongoose from "mongoose";

export interface IFlightLinehaulCounter extends mongoose.Document<string> {
  _id: string;
  sequence: number;
  lastAllocatedSequence: number;
  reusableSequences: number[];
}

const schema = new mongoose.Schema<IFlightLinehaulCounter>({
  _id: { type: String, required: true },
  sequence: { type: Number, required: true, default: 0, min: 0 },
  lastAllocatedSequence: { type: Number, required: true, default: 0, min: 0 },
  reusableSequences: [{ type: Number, min: 1 }]
}, { versionKey: false });

export const FlightLinehaulCounter = mongoose.model<IFlightLinehaulCounter>("FlightLinehaulCounter", schema);
