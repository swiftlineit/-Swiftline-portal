import mongoose from "mongoose";
import { supportTicketCategoryValues, type SupportTicketCategory } from "./supportTicket.model.js";

export interface ISupportTicketDraft extends mongoose.Document {
  businessAccountId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId | null;
  createdBy: mongoose.Types.ObjectId;
  category: SupportTicketCategory;
  subject: string;
  description: string;
  relatedShipmentDraftId: mongoose.Types.ObjectId | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const supportTicketDraftSchema = new mongoose.Schema<ISupportTicketDraft>(
  {
    businessAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessAccount", required: true, index: true },
    branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    category: { type: String, enum: supportTicketCategoryValues, required: true },
    subject: { type: String, trim: true, maxlength: 120, default: "" },
    description: { type: String, trim: true, maxlength: 2000, default: "" },
    relatedShipmentDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft", default: null },
    version: { type: Number, default: 1 },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  }
);

// Account-scoped: one user sees only their own drafts across that account, but
// listing is filtered by membership in service layer rather than a unique index.
supportTicketDraftSchema.index({ businessAccountId: 1, createdBy: 1, updatedAt: -1 });
supportTicketDraftSchema.index({ businessAccountId: 1, createdBy: 1 });

export const SupportTicketDraft = mongoose.model<ISupportTicketDraft>("SupportTicketDraft", supportTicketDraftSchema);
