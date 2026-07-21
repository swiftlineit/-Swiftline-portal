import { Router } from "express";
import {
  convertAdminShipmentQuote, createAdminQuoteShipmentDraft, createAdminShipmentQuote, estimateAdminShipmentQuote,
  getAdminQuoteContext, getAdminShipmentQuote, listAdminShipmentQuotes,
  publishAdminShipmentQuote, updateAdminShipmentQuoteStatus
} from "../controllers/shipmentQuote.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const shipmentQuoteRouter = Router();
shipmentQuoteRouter.use(attachUser);
shipmentQuoteRouter.use(requireRole("admin"));
shipmentQuoteRouter.get("/context", getAdminQuoteContext);
shipmentQuoteRouter.post("/estimate", estimateAdminShipmentQuote);
shipmentQuoteRouter.post("/draft", createAdminQuoteShipmentDraft);
shipmentQuoteRouter.get("/", listAdminShipmentQuotes);
shipmentQuoteRouter.post("/", createAdminShipmentQuote);
shipmentQuoteRouter.get("/:quoteId", getAdminShipmentQuote);
shipmentQuoteRouter.patch("/:quoteId/status", updateAdminShipmentQuoteStatus);
shipmentQuoteRouter.post("/:quoteId/publish", publishAdminShipmentQuote);
shipmentQuoteRouter.post("/:quoteId/convert", convertAdminShipmentQuote);
