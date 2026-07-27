import { Router } from "express";
import {
  createManualShipmentDraft,
  getShipmentDraft,
  updateShipmentDraft,
  validateShipmentDraft
} from "../controllers/shipmentDraft.controller.js";
import { createDpdLabel, createSwiftlineShipment } from "../controllers/dpdShipment.controller.js";
import {
  createAdminShipmentAmendment,
  previewShipmentAmendment
} from "../controllers/shipmentAmendment.controller.js";
import {
  deleteShipmentKycDocument,
  deleteShipmentParcelKycDocument,
  downloadShipmentKycDocument,
  downloadShipmentParcelKycDocument,
  uploadShipmentKycDocument,
  uploadShipmentParcelKycDocument
} from "../controllers/shipmentKyc.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";
import { shipmentKycUpload } from "../middleware/shipmentKycUpload.middleware.js";

export const shipmentDraftRouter = Router();

shipmentDraftRouter.use(attachUser);
shipmentDraftRouter.use(requireRole("admin"));

shipmentDraftRouter.post("/manual", createManualShipmentDraft);
shipmentDraftRouter.get("/:id", getShipmentDraft);
shipmentDraftRouter.patch("/:id", updateShipmentDraft);
shipmentDraftRouter.post("/:id/amendments/preview", previewShipmentAmendment);
shipmentDraftRouter.post("/:id/amendments", createAdminShipmentAmendment);
shipmentDraftRouter.post("/:id/kyc-documents/:type", shipmentKycUpload, uploadShipmentKycDocument);
shipmentDraftRouter.delete("/:id/kyc-documents/:type", deleteShipmentKycDocument);
shipmentDraftRouter.get("/:id/kyc-documents/:type", downloadShipmentKycDocument);
shipmentDraftRouter.post("/:id/parcels/:sequence/kyc-documents/:type", shipmentKycUpload, uploadShipmentParcelKycDocument);
shipmentDraftRouter.delete("/:id/parcels/:sequence/kyc-documents/:type", deleteShipmentParcelKycDocument);
shipmentDraftRouter.get("/:id/parcels/:sequence/kyc-documents/:type", downloadShipmentParcelKycDocument);
shipmentDraftRouter.post("/:id/validate", validateShipmentDraft);
shipmentDraftRouter.post("/:id/create-dpd-label", createDpdLabel);
shipmentDraftRouter.post("/:id/create-swiftline-shipment", createSwiftlineShipment);
