import { Router } from "express";
import {
  createManualShipmentDraft,
  getShipmentDraft,
  updateShipmentDraft,
  validateShipmentDraft
} from "../controllers/shipmentDraft.controller.js";
import { createDpdLabel } from "../controllers/dpdShipment.controller.js";
import {
  createAdminShipmentAmendment,
  previewShipmentAmendment
} from "../controllers/shipmentAmendment.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const shipmentDraftRouter = Router();

shipmentDraftRouter.use(attachUser);
shipmentDraftRouter.use(requireRole("admin"));

shipmentDraftRouter.post("/manual", createManualShipmentDraft);
shipmentDraftRouter.get("/:id", getShipmentDraft);
shipmentDraftRouter.patch("/:id", updateShipmentDraft);
shipmentDraftRouter.post("/:id/amendments/preview", previewShipmentAmendment);
shipmentDraftRouter.post("/:id/amendments", createAdminShipmentAmendment);
shipmentDraftRouter.post("/:id/validate", validateShipmentDraft);
shipmentDraftRouter.post("/:id/create-dpd-label", createDpdLabel);
