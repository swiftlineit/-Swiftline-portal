import { Router } from "express";
import {
  createDashboardBanner,
  deleteDashboardBanner,
  getDashboardBanner,
  getDashboardBannerImage,
  updateDashboardBanner
} from "../controllers/dashboardBanner.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";
import { dashboardBannerUpload } from "../middleware/dashboardBannerUpload.middleware.js";

export const dashboardBannerRouter = Router();

dashboardBannerRouter.use(attachUser, requireRole("admin", "operations", "client"));
dashboardBannerRouter.get("/", getDashboardBanner);
dashboardBannerRouter.get("/image/:id", getDashboardBannerImage);
dashboardBannerRouter.post("/", requireRole("admin", "operations"), dashboardBannerUpload, createDashboardBanner);
dashboardBannerRouter.patch("/:id", requireRole("admin", "operations"), dashboardBannerUpload, updateDashboardBanner);
dashboardBannerRouter.delete("/:id", requireRole("admin", "operations"), deleteDashboardBanner);
