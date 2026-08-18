/**
 * Admin view and control of a user's sessions.
 *
 * The requirement asks for an administrator-controlled way to end an existing
 * session- for the case where someone is locked out of their own account by a
 * device they no longer have.
 */
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { UserSession } from "../models/userSession.model.js";
import { endSessions } from "../services/userSession.service.js";

function getAuthenticatedUserId(request: Request) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const id = (request as any).user?._id;

  return id ? new mongoose.Types.ObjectId(String(id)) : null;
}

export async function listUserSessions(request: Request, response: Response): Promise<Response> {
  const userId = String(request.params.id ?? "");

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return response.status(400).json({ success: false, message: "Invalid user id" });
  }

  const sessions = await UserSession
    .find({ userId })
    .sort({ createdAt: -1 })
    // Enough history to explain a lockout without turning into a log viewer.
    .limit(20)
    // The user agent is kept for the audit log, not for display; `device` is the
    // readable form.
    .select("sessionId status ipAddress device createdAt lastSeenAt endedAt endReason")
    .lean()
    .exec();

  return response.status(200).json({ success: true, sessions });
}

export async function terminateUserSessions(request: Request, response: Response): Promise<Response> {
  const adminId = getAuthenticatedUserId(request);
  if (!adminId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const userId = String(request.params.id ?? "");

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return response.status(400).json({ success: false, message: "Invalid user id" });
  }

  const ended = await endSessions({ userId }, "terminated_by_admin", adminId);

  return response.status(200).json({
    success: true,
    ended,
    message: ended
      ? `Ended ${ended} active session${ended === 1 ? "" : "s"}.`
      : "That user has no active sessions."
  });
}
