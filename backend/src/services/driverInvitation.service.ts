import crypto from "crypto";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { DriverInvitation } from "../models/driverInvitation.model.js";

const invitationLifetimeMs = 24 * 60 * 60 * 1000;

export function hashDriverInvitationToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createDriverInvitation(input: {
  userId: mongoose.Types.ObjectId;
  driverProfileId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
}) {
  await DriverInvitation.updateMany(
    { userId: input.userId, acceptedAt: null, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  ).exec();

  const token = crypto.randomBytes(32).toString("base64url");
  const invitation = await DriverInvitation.create({
    userId: input.userId,
    driverProfileId: input.driverProfileId,
    tokenHash: hashDriverInvitationToken(token),
    expiresAt: new Date(Date.now() + invitationLifetimeMs),
    createdBy: input.createdBy
  });
  const url = new URL("/auth/activate", env.CLIENT_URL);
  url.searchParams.set("token", token);
  return { invitation, activationUrl: url.toString() };
}
