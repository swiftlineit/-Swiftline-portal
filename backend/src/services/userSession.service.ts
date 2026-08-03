/**
 * Single-active-session enforcement.
 *
 * Enforcement is behind `SINGLE_SESSION_ENFORCED`. With it off, sessions are
 * still created, tracked and audited — so the audit log can be watched for a
 * day before the rule starts refusing anyone — but no request is ever rejected
 * because of them. Turning it off again is a config change, not a redeploy.
 */
import crypto from "node:crypto";
import type { Request } from "express";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { AuditLog } from "../models/auditLog.model.js";
import { UserSession, type SessionEndReason } from "../models/userSession.model.js";

export const sessionSupersededMessage = "Your account is already active on another browser or device.";
export const sessionEndedMessage = "Your session has ended. Please sign in again.";

export function isSingleSessionEnforced() {
  return env.SINGLE_SESSION_ENFORCED;
}

function getIdleCutoff() {
  return new Date(Date.now() - env.SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000);
}

// Enough to tell two devices apart in the audit log without parsing user agents
// into something that pretends to be more precise than it is.
function describeDevice(userAgent: string) {
  const platform = /windows/i.test(userAgent) ? "Windows"
    : /macintosh|mac os/i.test(userAgent) ? "macOS"
      : /android/i.test(userAgent) ? "Android"
        : /iphone|ipad|ios/i.test(userAgent) ? "iOS"
          : /linux/i.test(userAgent) ? "Linux"
            : "Unknown device";
  const browser = /edg\//i.test(userAgent) ? "Edge"
    : /chrome\//i.test(userAgent) ? "Chrome"
      : /safari\//i.test(userAgent) ? "Safari"
        : /firefox\//i.test(userAgent) ? "Firefox"
          : "Unknown browser";

  return `${browser} on ${platform}`;
}

export function readRequestContext(request: Request) {
  const forwarded = request.headers["x-forwarded-for"];
  const ipAddress = (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : "")
    || request.ip
    || request.socket.remoteAddress
    || "";
  const userAgent = typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : "";

  return { ipAddress, userAgent, device: describeDevice(userAgent) };
}

async function recordSessionAudit(
  action: "USER_SESSION_STARTED" | "USER_SESSION_ENDED",
  userId: mongoose.Types.ObjectId,
  metadata: Record<string, unknown>,
  performedBy?: mongoose.Types.ObjectId
) {
  try {
    await AuditLog.create({
      action,
      entityType: "USER",
      entityId: userId,
      performedBy: performedBy ?? userId,
      performedAt: new Date(),
      metadata
    });
  } catch (error) {
    // Never fail a login because its audit entry could not be written.
    console.error("Session audit log write failed:", error);
  }
}

export async function endSessions(
  filter: Record<string, unknown>,
  reason: SessionEndReason,
  endedBy?: mongoose.Types.ObjectId
) {
  const sessions = await UserSession.find({ ...filter, status: "active" }).exec();

  if (!sessions.length) return 0;

  await UserSession.updateMany(
    { _id: { $in: sessions.map((session) => session._id) } },
    { $set: { status: "ended", endedAt: new Date(), endReason: reason, endedBy: endedBy ?? null } }
  ).exec();

  for (const session of sessions) {
    await recordSessionAudit("USER_SESSION_ENDED", session.userId, {
      sessionId: session.sessionId,
      reason,
      ipAddress: session.ipAddress,
      device: session.device,
      startedAt: session.createdAt,
      lastSeenAt: session.lastSeenAt
    }, endedBy);
  }

  return sessions.length;
}

/**
 * Opens a session for a login, ending whatever else that user had open.
 *
 * The newest login wins: a laptop closed without signing out must never lock
 * someone out of their own account, which is what refusing the new login would
 * do. The displaced device learns why on its next request.
 */
export async function startSession(
  userId: mongoose.Types.ObjectId,
  request: Request,
  refreshTokenTtlMs: number
) {
  const { ipAddress, userAgent, device } = readRequestContext(request);

  if (isSingleSessionEnforced()) {
    await endSessions({ userId }, "superseded_by_new_login");
  }

  const sessionId = crypto.randomUUID();

  await UserSession.create({
    userId,
    sessionId,
    status: "active",
    ipAddress,
    userAgent,
    device,
    createdAt: new Date(),
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + refreshTokenTtlMs)
  });

  await recordSessionAudit("USER_SESSION_STARTED", userId, { sessionId, ipAddress, device });

  return sessionId;
}

export type SessionCheck =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Whether a token's session is still usable.
 *
 * A token with no `sid` predates this feature and is honoured until it expires,
 * so deploying does not sign everybody out mid-task.
 */
export async function verifySession(sessionId: string | undefined): Promise<SessionCheck> {
  if (!isSingleSessionEnforced() || !sessionId) return { ok: true };

  const session = await UserSession.findOne({ sessionId }).exec();

  if (!session) return { ok: false, message: sessionEndedMessage };

  if (session.status === "ended") {
    return {
      ok: false,
      message: session.endReason === "superseded_by_new_login" ? sessionSupersededMessage : sessionEndedMessage
    };
  }

  if (session.lastSeenAt < getIdleCutoff()) {
    await endSessions({ _id: session._id }, "idle_timeout");
    return { ok: false, message: sessionEndedMessage };
  }

  return { ok: true };
}

// `lastSeenAt` drives idle expiry, so it only needs to be accurate to the
// minute; writing it on every request would add a database write to each one.
const lastSeenWriteIntervalMs = 60 * 1000;

export async function touchSession(sessionId: string | undefined) {
  if (!sessionId) return;

  await UserSession.updateOne(
    { sessionId, status: "active", lastSeenAt: { $lt: new Date(Date.now() - lastSeenWriteIntervalMs) } },
    { $set: { lastSeenAt: new Date() } }
  ).exec();
}
