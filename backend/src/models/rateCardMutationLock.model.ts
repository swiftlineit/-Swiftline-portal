import mongoose from "mongoose";

interface IRateCardMutationLock {
  _id: string;
  owner: string;
  lockedUntil: Date;
}

const rateCardMutationLockSchema = new mongoose.Schema<IRateCardMutationLock>({
  _id: { type: String, required: true },
  owner: { type: String, required: true },
  lockedUntil: { type: Date, required: true }
}, { versionKey: false });

rateCardMutationLockSchema.index({ lockedUntil: 1 }, { expireAfterSeconds: 0 });

export const RateCardMutationLock = mongoose.model<IRateCardMutationLock>(
  "RateCardMutationLock",
  rateCardMutationLockSchema
);
