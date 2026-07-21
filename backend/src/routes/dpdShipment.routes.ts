import { Router } from "express";
import {
  createDpdLabelAccessUrl,
  downloadDpdLabel,
  downloadDpdLabelWithToken,
  getDpdShipment,
  holdDpdShipment,
  listDpdShipmentAudit,
  listDpdShipments,
  reconcileDpdShipmentDocuments,
  releaseDpdShipment,
  resetDevelopmentShipmentBooking,
  updateDpdShipmentOperationalStatus
} from "../controllers/dpdShipment.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";
import { downloadShipmentInvoicePdf, getShipmentInvoice } from "../controllers/shipmentInvoice.controller.js";
import {
  finalizeFinalShipmentCharge,
  getShipmentChargeVerification,
  previewFinalShipmentCharge
} from "../controllers/shipmentChargeVerification.controller.js";

export const dpdShipmentRouter = Router();

dpdShipmentRouter.get("/:id/label-file", downloadDpdLabelWithToken);

dpdShipmentRouter.use(attachUser);
dpdShipmentRouter.use(requireRole("admin"));

dpdShipmentRouter.get("/", listDpdShipments);
dpdShipmentRouter.get("/drafts/:draftId/invoice", getShipmentInvoice);
dpdShipmentRouter.get("/drafts/:draftId/invoice/pdf", downloadShipmentInvoicePdf);
dpdShipmentRouter.get("/drafts/:draftId/audit", listDpdShipmentAudit);
dpdShipmentRouter.post("/drafts/:draftId/reset-development-booking", resetDevelopmentShipmentBooking);
dpdShipmentRouter.get("/:id", getDpdShipment);
dpdShipmentRouter.get("/:id/charge-verification", getShipmentChargeVerification);
dpdShipmentRouter.post("/:id/charge-verification/preview", previewFinalShipmentCharge);
dpdShipmentRouter.post("/:id/charge-verification/finalize", finalizeFinalShipmentCharge);
dpdShipmentRouter.post("/:id/hold", holdDpdShipment);
dpdShipmentRouter.post("/:id/release", releaseDpdShipment);
dpdShipmentRouter.post("/:id/reconcile-documents", reconcileDpdShipmentDocuments);
dpdShipmentRouter.post("/:id/status-events", updateDpdShipmentOperationalStatus);
dpdShipmentRouter.get("/:id/label-access", createDpdLabelAccessUrl);
dpdShipmentRouter.get("/:id/label", downloadDpdLabel);
