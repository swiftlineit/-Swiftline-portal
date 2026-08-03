import mongoose from "mongoose";

/**
 * A signed-in session.
 *
 * Authentication is otherwise stateless JWT, which cannot express "only one
 * device at a time" — a token stays valid until it expires no matter what
 * happens elsewhere. This record is the server-side half: every token carries
 * its session id, and `attachUser` refuses a token whose session has been
 * terminated or has gone idle.
 */
export const sessionEndReasons = [
  "logout",
  "superseded_by_new_login",
  "terminated_by_admin",
  "idle_timeout"
] as const;
export type SessionEndReason = (typeof sessionEndReasons)[number];

export interface IUserSession extends mongoose.Document {
  userId: mongoose.Types.ObjectId;
  sessionId: string;
  status: "active" | "ended";
  ipAddress: string;
  userAgent: string;
  device: string;
  createdAt: Date;
  lastSeenAt: Date;
  endedAt?: Date | null;
  endReason?: SessionEndReason | null;
  endedBy?: mongoose.Types.ObjectId | null;
  expiresAt: Date;
}

const userSessionSchema = new mongoose.Schema<IUserSession>({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  // The `sid` claim carried by both the access and the refresh token.
  sessionId: { type: String, required: true, unique: true, index: true },
  status: { type: String, enum: ["active", "ended"], default: "active", index: true },
  // Recorded for the audit trail, which must be able to answer "from where".
  ipAddress: { type: String, default: "" },
  userAgent: { type: String, default: "" },
  device: { type: String, default: "" },
  createdAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  endedAt: { type: Date, default: null },
  endReason: { type: String, enum: [...sessionEndReasons, null], default: null },
  endedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  // Swept once the refresh token behind it could no longer be valid anyway.
  expiresAt: { type: Date, required: true }
});

// Finding a user's live session is the hot path: it runs on login and on every
// authenticated request that refreshes `lastSeenAt`.
userSessionSchema.index({ userId: 1, status: 1 });

// Ended sessions are kept for a while so the audit trail can still be read, then
// removed; the AuditLog entries outlive them.
userSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export const UserSession = mongoose.model<IUserSession>("UserSession", userSessionSchema);
