import { Router } from "express";
import {
  getNotifications,
  readAllNotifications,
  readNotification
} from "../controllers/notification.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const notificationRouter = Router();

notificationRouter.use(attachUser);
notificationRouter.use(requireRole("admin", "client"));
notificationRouter.get("/", getNotifications);
notificationRouter.patch("/read-all", readAllNotifications);
notificationRouter.patch("/:notificationId/read", readNotification);
