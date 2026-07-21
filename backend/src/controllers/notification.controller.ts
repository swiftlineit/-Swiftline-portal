import type { Request, Response } from "express";
import mongoose from "mongoose";
import {
  listPortalNotifications,
  markAllPortalNotificationsRead,
  markPortalNotificationRead,
  refreshCreditNotificationsForUser,
  serializePortalNotification
} from "../services/portalNotification.service.js";

function authenticatedUserId(request: Request) {
  const id = (request as Request & { user?: { _id?: unknown } }).user?._id;
  return id && mongoose.Types.ObjectId.isValid(String(id))
    ? new mongoose.Types.ObjectId(String(id))
    : null;
}

export async function getNotifications(request: Request, response: Response): Promise<Response> {
  const userId = authenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Please sign in again." });
  await refreshCreditNotificationsForUser(userId);
  return response.status(200).json({ success: true, ...await listPortalNotifications(userId) });
}

export async function readNotification(request: Request, response: Response): Promise<Response> {
  const userId = authenticatedUserId(request);
  const rawNotificationId = Array.isArray(request.params.notificationId)
    ? request.params.notificationId[0]
    : request.params.notificationId;
  const notificationId = mongoose.Types.ObjectId.isValid(rawNotificationId ?? "")
    ? new mongoose.Types.ObjectId(rawNotificationId)
    : null;
  if (!userId) return response.status(401).json({ success: false, message: "Please sign in again." });
  if (!notificationId) return response.status(400).json({ success: false, message: "Notification is invalid." });

  const notification = await markPortalNotificationRead(userId, notificationId);
  if (!notification) return response.status(404).json({ success: false, message: "Notification was not found." });
  return response.status(200).json({ success: true, notification: serializePortalNotification(notification) });
}

export async function readAllNotifications(request: Request, response: Response): Promise<Response> {
  const userId = authenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Please sign in again." });
  await markAllPortalNotificationsRead(userId);
  return response.status(200).json({ success: true, message: "Notifications marked as read." });
}
