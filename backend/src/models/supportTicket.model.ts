import mongoose from "mongoose";

export const supportTicketCategoryValues = [
  "SHIPMENT_BOOKING", "TRACKING", "LABEL_MANIFEST", "AMENDMENT_CANCELLATION",
  "INVOICE_PAYMENT", "CREDIT_ACCOUNT", "ACCOUNT_ACCESS", "TECHNICAL", "OTHER"
] as const;
export const supportTicketPriorityValues = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export const supportTicketStatusValues = ["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "RESOLVED", "CLOSED"] as const;

export type SupportTicketCategory = (typeof supportTicketCategoryValues)[number];
export type SupportTicketPriority = (typeof supportTicketPriorityValues)[number];
export type SupportTicketStatus = (typeof supportTicketStatusValues)[number];

export interface SupportTicketStatusHistoryItem {
  fromStatus?: SupportTicketStatus | null;
  toStatus: SupportTicketStatus;
  changedBy: mongoose.Types.ObjectId;
  note: string;
  changedAt: Date;
}

export interface ISupportTicket extends mongoose.Document {
  ticketNumber: string;
  businessAccountId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  assignedTo?: mongoose.Types.ObjectId | null;
  relatedShipmentDraftId?: mongoose.Types.ObjectId | null;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  subject: string;
  statusHistory: SupportTicketStatusHistoryItem[];
  lastMessageAt: Date;
  resolvedAt?: Date | null;
  closedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const statusHistorySchema = new mongoose.Schema<SupportTicketStatusHistoryItem>({
  fromStatus: { type: String, enum: [...supportTicketStatusValues, null], default: null },
  toStatus: { type: String, enum: supportTicketStatusValues, required: true },
  changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  note: { type: String, trim: true, maxlength: 500, default: "" },
  changedAt: { type: Date, required: true, default: Date.now }
}, { _id: false });

const supportTicketSchema = new mongoose.Schema<ISupportTicket>({
  ticketNumber: { type: String, required: true, unique: true, immutable: true, trim: true, index: true },
  businessAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessAccount", required: true, immutable: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, immutable: true, index: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, immutable: true, index: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
  relatedShipmentDraftId: { type: mongoose.Schema.Types.ObjectId, ref: "ShipmentDraft", default: null, index: true },
  category: { type: String, enum: supportTicketCategoryValues, required: true, index: true },
  priority: { type: String, enum: supportTicketPriorityValues, default: "NORMAL", required: true, index: true },
  status: { type: String, enum: supportTicketStatusValues, default: "OPEN", required: true, index: true },
  subject: { type: String, required: true, trim: true, minlength: 5, maxlength: 120 },
  statusHistory: { type: [statusHistorySchema], default: [] },
  lastMessageAt: { type: Date, required: true, default: Date.now, index: true },
  resolvedAt: { type: Date, default: null },
  closedAt: { type: Date, default: null }
}, { timestamps: true });

supportTicketSchema.index({ businessAccountId: 1, lastMessageAt: -1 });
supportTicketSchema.index({ status: 1, priority: 1, lastMessageAt: -1 });
supportTicketSchema.index({ subject: "text", ticketNumber: "text" });

export const SupportTicket = mongoose.model<ISupportTicket>("SupportTicket", supportTicketSchema);
