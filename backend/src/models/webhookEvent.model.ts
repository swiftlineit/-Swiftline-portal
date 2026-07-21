import mongoose from "mongoose";

export const webhookProviderValues = ["RAZORPAY"] as const;
export type WebhookProvider = (typeof webhookProviderValues)[number];

export const webhookEventStatusValues = ["RECEIVED", "PROCESSED", "IGNORED", "FAILED"] as const;
export type WebhookEventStatus = (typeof webhookEventStatusValues)[number];

export interface IWebhookEvent extends mongoose.Document {
  provider: WebhookProvider;
  providerEventId: string;
  eventType: string;
  payloadHash: string;
  status: WebhookEventStatus;
  receivedAt: Date;
  processedAt?: Date | null;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const webhookEventSchema = new mongoose.Schema<IWebhookEvent>(
  {
    provider: { type: String, enum: webhookProviderValues, required: true, index: true },
    providerEventId: { type: String, required: true, unique: true, trim: true, maxlength: 160 },
    eventType: { type: String, required: true, trim: true, maxlength: 120, index: true },
    payloadHash: { type: String, required: true, trim: true, maxlength: 128 },
    status: { type: String, enum: webhookEventStatusValues, default: "RECEIVED", index: true },
    receivedAt: { type: Date, default: Date.now, index: true },
    processedAt: { type: Date, default: null },
    failureReason: { type: String, trim: true, maxlength: 1000, default: "" }
  },
  { timestamps: true }
);

export const WebhookEvent = mongoose.model<IWebhookEvent>(
  "WebhookEvent",
  webhookEventSchema
);
