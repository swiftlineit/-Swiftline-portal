import mongoose from "mongoose";

interface IOperationsManifestCounter extends mongoose.Document<string> {
  _id: string;
  sequence: number;
  reusableSequences: number[];
  lastAllocatedSequence: number;
}

const operationsManifestCounterSchema = new mongoose.Schema<IOperationsManifestCounter>({
  _id: { type: String, required: true },
  sequence: { type: Number, required: true, min: 0, default: 0 },
  reusableSequences: [{ type: Number, min: 17 }],
  lastAllocatedSequence: { type: Number, min: 17, default: 17 }
}, { versionKey: false });

export const OperationsManifestCounter = mongoose.model<IOperationsManifestCounter>("OperationsManifestCounter", operationsManifestCounterSchema);
