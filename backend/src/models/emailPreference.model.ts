import mongoose from "mongoose";

export interface IEmailPreference extends mongoose.Document {
  userId: mongoose.Types.ObjectId;
  optedOutTypes: string[];
  operationalEmailsEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const emailPreferenceSchema = new mongoose.Schema<IEmailPreference>(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    // Per-notification-type opt-outs. Only honoured for OPERATIONAL mail;
    // transactional mail ignores this list entirely.
    optedOutTypes: [{ type: String, trim: true, maxlength: 80 }],
    // The master switch behind the List-Unsubscribe header.
    operationalEmailsEnabled: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export const EmailPreference = mongoose.model<IEmailPreference>(
  "EmailPreference",
  emailPreferenceSchema
);
