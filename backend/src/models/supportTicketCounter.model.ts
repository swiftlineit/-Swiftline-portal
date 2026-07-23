import mongoose from "mongoose";

export interface ISupportTicketCounter extends mongoose.Document {
  financialYear: string;
  sequence: number;
}

const supportTicketCounterSchema = new mongoose.Schema<ISupportTicketCounter>({
  financialYear: { type: String, required: true, unique: true, trim: true },
  sequence: { type: Number, required: true, min: 0, default: 0 }
}, { timestamps: true });

export const SupportTicketCounter = mongoose.model<ISupportTicketCounter>(
  "SupportTicketCounter",
  supportTicketCounterSchema
);
