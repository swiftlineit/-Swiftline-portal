import mongoose from "mongoose";

export interface ISupportTicketMessage extends mongoose.Document {
  ticketId: mongoose.Types.ObjectId;
  authorId: mongoose.Types.ObjectId;
  authorType: "CLIENT" | "ADMIN";
  message: string;
  internal: boolean;
  createdAt: Date;
}

const supportTicketMessageSchema = new mongoose.Schema<ISupportTicketMessage>({
  ticketId: { type: mongoose.Schema.Types.ObjectId, ref: "SupportTicket", required: true, immutable: true, index: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  authorType: { type: String, enum: ["CLIENT", "ADMIN"], required: true, immutable: true },
  message: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000, immutable: true },
  internal: { type: Boolean, required: true, default: false, immutable: true },
  createdAt: { type: Date, required: true, default: Date.now, immutable: true }
}, { timestamps: false });

supportTicketMessageSchema.index({ ticketId: 1, createdAt: 1 });

// Conversation history is audit data and cannot be edited or deleted.
const blockMutation = () => { throw new Error("Support ticket messages are append-only."); };
supportTicketMessageSchema.pre("updateOne", blockMutation);
supportTicketMessageSchema.pre("updateMany", blockMutation);
supportTicketMessageSchema.pre("findOneAndUpdate", blockMutation);
supportTicketMessageSchema.pre("deleteOne", blockMutation);
supportTicketMessageSchema.pre("deleteMany", blockMutation);
supportTicketMessageSchema.pre("findOneAndDelete", blockMutation);

export const SupportTicketMessage = mongoose.model<ISupportTicketMessage>(
  "SupportTicketMessage",
  supportTicketMessageSchema
);
