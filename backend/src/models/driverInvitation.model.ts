import mongoose from "mongoose";

export interface IDriverInvitation extends mongoose.Document {
  userId: mongoose.Types.ObjectId;
  driverProfileId: mongoose.Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  acceptedAt?: Date | null;
  revokedAt?: Date | null;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const driverInvitationSchema = new mongoose.Schema<IDriverInvitation>(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    driverProfileId: { type: mongoose.Schema.Types.ObjectId, ref: "DriverProfile", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

driverInvitationSchema.index({ userId: 1, acceptedAt: 1, revokedAt: 1 });

export const DriverInvitation = mongoose.model<IDriverInvitation>("DriverInvitation", driverInvitationSchema);
