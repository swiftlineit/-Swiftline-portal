import mongoose from "mongoose";

export const portalNotificationTypeValues = [
  "STATEMENT_ISSUED",
  "PAYMENT_DUE_SOON",
  "PAYMENT_OVERDUE",
  "PAYMENT_CONFIRMED",
  "LOW_BOOKING_CAPACITY",
  "OFFLINE_PAYMENT_SUBMITTED",
  "SHIPMENT_CANCELLATION_REQUESTED",
  "SHIPMENT_CANCELLATION_COMPLETED",
  "SHIPMENT_CANCELLATION_REJECTED",
  "SHIPMENT_QUOTE_REQUESTED",
  "SHIPMENT_QUOTE_PUBLISHED",
  "SHIPMENT_QUOTE_DECLINED",
  "SHIPMENT_QUOTE_CONVERTED",
  "SUPPORT_TICKET_CREATED",
  "SUPPORT_TICKET_REPLY",
  "SUPPORT_TICKET_STATUS_UPDATED"
] as const;
export type PortalNotificationType = (typeof portalNotificationTypeValues)[number];

export interface IPortalNotification extends mongoose.Document {
  recipientUserId: mongoose.Types.ObjectId;
  businessAccountId?: mongoose.Types.ObjectId | null;
  type: PortalNotificationType;
  title: string;
  message: string;
  href: string;
  idempotencyKey: string;
  readAt?: Date | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const portalNotificationSchema = new mongoose.Schema<IPortalNotification>({
  recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  businessAccountId: { type: mongoose.Schema.Types.ObjectId, ref: "BusinessAccount", default: null, index: true },
  type: { type: String, enum: portalNotificationTypeValues, required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  message: { type: String, required: true, trim: true, maxlength: 500 },
  href: { type: String, required: true, trim: true, maxlength: 300 },
  idempotencyKey: { type: String, required: true, unique: true, trim: true, maxlength: 300 },
  readAt: { type: Date, default: null, index: true },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, index: true }
}, { timestamps: false });

portalNotificationSchema.index({ recipientUserId: 1, readAt: 1, createdAt: -1 });

export const PortalNotification = mongoose.model<IPortalNotification>(
  "PortalNotification",
  portalNotificationSchema
);
