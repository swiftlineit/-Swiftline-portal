import mongoose from "mongoose";

export const flightDocumentTypeValues = [
  "MAWB",
  "BOOKING_CONFIRMATION",
  "CARGO_MANIFEST",
  "BAG_MANIFEST",
  "SECURITY",
  "CUSTOMS",
  "HANDOVER",
  "PROOF",
  "OTHER"
] as const;
export type FlightDocumentType = (typeof flightDocumentTypeValues)[number];

export interface IFlightDocument extends mongoose.Document {
  flightLinehaulId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  documentType: FlightDocumentType;
  originalName: string;
  storageKey: string;
  mimeType: string;
  size: number;
  note: string;
  uploadedBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new mongoose.Schema<IFlightDocument>(
  {
    flightLinehaulId: { type: mongoose.Schema.Types.ObjectId, ref: "FlightLinehaul", required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    documentType: { type: String, enum: flightDocumentTypeValues, required: true, index: true },
    originalName: { type: String, required: true, trim: true, maxlength: 255 },
    storageKey: { type: String, required: true, trim: true, maxlength: 1024 },
    mimeType: { type: String, required: true, trim: true, maxlength: 120 },
    size: { type: Number, required: true, min: 1 },
    note: { type: String, trim: true, maxlength: 500, default: "" },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true }
  },
  { timestamps: true }
);

schema.index({ flightLinehaulId: 1, createdAt: -1 });
schema.index({ branchId: 1, documentType: 1 });

export const FlightDocument = mongoose.model<IFlightDocument>("FlightDocument", schema);
