import { Router } from "express";
import {
  getNotifications,
  readAllNotifications,
  readNotification
} from "../controllers/notification.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";
import { roleValues } from "../models/user.model.js";

export const notificationRouter = Router();

notificationRouter.use(attachUser);
// Notifications are addressed per user, so every role reads its own. Spreading
// `roleValues` keeps this open to roles added later without a second edit.
notificationRouter.use(requireRole(...roleValues));
notificationRouter.get("/", getNotifications);
notificationRouter.patch("/read-all", readAllNotifications);
notificationRouter.patch("/:notificationId/read", readNotification);
