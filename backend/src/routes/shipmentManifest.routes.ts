import { Router } from "express";
import {
  createAdminBulkShipmentManifest,
  createAdminShipmentManifest,
  downloadAdminShipmentManifest,
  downloadAdminShipmentManifestPdf,
  getAdminShipmentManifestContext,
  listAdminShipmentManifests
} from "../controllers/shipmentManifest.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const shipmentManifestRouter = Router();

shipmentManifestRouter.use(attachUser);
shipmentManifestRouter.use(requireRole("admin"));
shipmentManifestRouter.get("/", listAdminShipmentManifests);
shipmentManifestRouter.get("/drafts/:draftId/context", getAdminShipmentManifestContext);
shipmentManifestRouter.post("/", createAdminShipmentManifest);
shipmentManifestRouter.post("/bulk", createAdminBulkShipmentManifest);
shipmentManifestRouter.get("/:manifestId/download", downloadAdminShipmentManifest);
shipmentManifestRouter.get("/:manifestId/pdf", downloadAdminShipmentManifestPdf);
