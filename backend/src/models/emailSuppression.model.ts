import mongoose from "mongoose";

export const emailSuppressionReasonValues = [
  "HARD_BOUNCE",
  "COMPLAINT",
  "SOFT_BOUNCE_LIMIT",
  "MANUAL"
] as const;
export type EmailSuppressionReason = (typeof emailSuppressionReasonValues)[number];

export interface IEmailSuppression extends mongoose.Document {
  email: string;
  reason: EmailSuppressionReason;
  detail: string;
  softBounceCount: number;
  sesMessageId: string;
  suppressedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const emailSuppressionSchema = new mongoose.Schema<IEmailSuppression>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 320 },
    reason: { type: String, enum: emailSuppressionReasonValues, required: true, index: true },
    detail: { type: String, trim: true, maxlength: 1000, default: "" },
    // Soft bounces are transient on their own; three of them are not. Counted
    // here so the third one can promote the address to a permanent suppression.
    softBounceCount: { type: Number, default: 0, min: 0 },
    sesMessageId: { type: String, trim: true, maxlength: 200, default: "" },
    suppressedAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: true }
);

export const EmailSuppression = mongoose.model<IEmailSuppression>(
  "EmailSuppression",
  emailSuppressionSchema
);
