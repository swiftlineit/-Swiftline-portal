import mongoose from "mongoose";

export const supportTicketCategoryValues = [
  "SHIPMENT_BOOKING", "TRACKING", "LABEL_MANIFEST", "AMENDMENT_CANCELLATION",
  "SHIPMENT_DELAYED", "SHIPMENT_NOT_RECEIVED", "SHIPMENT_LOST", "SHIPMENT_THEFT", "SHIPMENT_DAMAGED",
  "INVOICE_PAYMENT", "CREDIT_ACCOUNT", "ACCOUNT_ACCESS", "TECHNICAL", "OTHER"
] as const;

/** Categories that describe a problem with one shipment, so one must be named. */
export const shipmentIssueCategoryValues = [
  "SHIPMENT_DELAYED", "SHIPMENT_NOT_RECEIVED", "SHIPMENT_LOST", "SHIPMENT_THEFT", "SHIPMENT_DAMAGED"
] as const;

/** A ticket in one of these states is still being worked, so it blocks a duplicate. */
export const openSupportTicketStatusValues = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "AWAITING_CARRIER",
  "WAITING_FOR_CUSTOMER",
  "ACTION_REQUIRED"
] as const;

/** How many replies a customer may still send once a ticket has been resolved. */
export const resolvedClientReplyLimit = 2;

/**
 * Three levels, not four.
 *
 * "Low" was dropped: nobody raises a support ticket about something that does
 * not matter to them, and a queue where the default sorts below something is a
 * queue where the default gets ignored.
 */
export const supportTicketPriorityValues = ["NORMAL", "URGENT", "CRITICAL"] as const;

/**
 * Where a ticket sits. `IN_PROGRESS` is the stored value behind the "Under
 * Investigation" label — see `supportTicketStatusLabels`.
 *
 * The three waiting states are kept apart because they need different chasing:
 * a carrier gets chased by Swiftline, a customer gets a reminder, and an
 * action-required ticket is one the customer has to resolve before anyone can
 * move it. Folding them into one "waiting" would lose who is being waited on.
 */
export const supportTicketStatusValues = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "AWAITING_CARRIER",
  "WAITING_FOR_CUSTOMER",
  "ACTION_REQUIRED",
  "RESOLVED",
  "CLOSED"
] as const;

export type SupportTicketCategory = (typeof supportTicketCategoryValues)[number];
export type SupportTicketPriority = (typeof supportTicketPriorityValues)[number];
export type SupportTicketStatus = (typeof supportTicketStatusValues)[number];

/** What each status is called wherever a person reads it. */
export const supportTicketStatusLabels: Record<SupportTicketStatus, string> = {
  OPEN: "Open",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "Under Investigation",
  AWAITING_CARRIER: "Awaiting Carrier",
  WAITING_FOR_CUSTOMER: "Awaiting Customer",
  ACTION_REQUIRED: "Action Required",
  RESOLVED: "Resolved",
  CLOSED: "Closed"
};

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
  /** When Swiftline owes this customer a first reply. Set once, at creation. */
  firstResponseDueAt: Date;
  /** When the first Swiftline reply actually landed. Null until it does. */
  firstRespondedAt?: Date | null;
  resolvedAt?: Date | null;
  closedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Hours to first response, by priority.
 *
 * Whether an SLA is breached is worked out on read from these and
 * `firstRespondedAt`, not written by a sweeper: a stored "breached" flag is
 * wrong for every minute between the deadline passing and the job noticing,
 * and the queue is read far more often than it is swept.
 */
export const firstResponseHoursByPriority: Record<SupportTicketPriority, number> = {
  NORMAL: 24,
  URGENT: 8,
  CRITICAL: 2
};

export function firstResponseDueFrom(priority: SupportTicketPriority, from: Date) {
  return new Date(from.getTime() + firstResponseHoursByPriority[priority] * 60 * 60 * 1000);
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
  // Defaulted so tickets created before SLAs existed still carry a deadline
  // rather than reading as overdue since 1970.
  firstResponseDueAt: { type: Date, required: true, default: Date.now, index: true },
  firstRespondedAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
  closedAt: { type: Date, default: null }
}, { timestamps: true });

supportTicketSchema.index({ businessAccountId: 1, lastMessageAt: -1 });
supportTicketSchema.index({ status: 1, priority: 1, lastMessageAt: -1 });
supportTicketSchema.index({ subject: "text", ticketNumber: "text" });

export const SupportTicket = mongoose.model<ISupportTicket>("SupportTicket", supportTicketSchema);
