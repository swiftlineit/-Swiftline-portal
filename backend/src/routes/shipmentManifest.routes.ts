import { Router } from "express";
import {
  createAdminShipmentManifest,
  downloadAdminShipmentManifest,
  getAdminShipmentManifestContext
} from "../controllers/shipmentManifest.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const shipmentManifestRouter = Router();

shipmentManifestRouter.use(attachUser);
shipmentManifestRouter.use(requireRole("admin"));
shipmentManifestRouter.get("/drafts/:draftId/context", getAdminShipmentManifestContext);
shipmentManifestRouter.post("/", createAdminShipmentManifest);
shipmentManifestRouter.get("/:manifestId/download", downloadAdminShipmentManifest);
