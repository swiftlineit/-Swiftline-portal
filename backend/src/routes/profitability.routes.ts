import { Router } from "express";
import {
  createLogisticsVendor,
  createVendorCostRate,
  getProfitabilityOverview,
  listLogisticsVendors,
  listShipmentProfitability,
  listVendorCostRates,
  retireVendorCostRate,
  updateLogisticsVendorStatus,
  updateShipmentProfitabilityCosts
} from "../controllers/profitability.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";
import * as flightController from "../controllers/flightProfitability.controller.js";

export const profitabilityRouter = Router();

profitabilityRouter.use(attachUser);
profitabilityRouter.patch(
  "/flight-cost-sheets/:sheetId/external-labels",
  requireRole("admin", "finance", "operations"),
  flightController.updateExternalLabels
);
profitabilityRouter.use(requireRole("admin", "finance"));

profitabilityRouter.get("/overview", getProfitabilityOverview);
profitabilityRouter.get("/shipments", listShipmentProfitability);
profitabilityRouter.patch("/shipments/:shipmentDraftId/costs", updateShipmentProfitabilityCosts);

profitabilityRouter.get("/vendors", listLogisticsVendors);
profitabilityRouter.post("/vendors", createLogisticsVendor);
profitabilityRouter.patch("/vendors/:vendorId/status", updateLogisticsVendorStatus);

profitabilityRouter.get("/vendor-rates", listVendorCostRates);
profitabilityRouter.post("/vendor-rates", createVendorCostRate);
profitabilityRouter.patch("/vendor-rates/:rateId/retire", retireVendorCostRate);

profitabilityRouter.get("/flight-rates", flightController.listFlightBuyingRates);
profitabilityRouter.post("/flight-rates", flightController.createFlightBuyingRate);
profitabilityRouter.patch("/flight-rates/:rateId", flightController.updateFlightBuyingRate);
profitabilityRouter.delete("/flight-rates/:rateId", flightController.deleteFlightBuyingRate);

profitabilityRouter.get("/fx/gbp-inr", flightController.getExchangeRate);
profitabilityRouter.get("/flight-manifests", flightController.listFlightManifestOptions);
profitabilityRouter.get("/flight-manifests/:manifestId/preview", flightController.getFlightManifestPreview);
profitabilityRouter.get("/flight-cost-sheets", flightController.listFlightCostSheets);
profitabilityRouter.post("/flight-cost-sheets", flightController.createFlightCostSheet);
profitabilityRouter.get("/flight-cost-sheets/:sheetId", flightController.getFlightCostSheet);
profitabilityRouter.get("/flight-cost-sheets/:sheetId/revisions", flightController.listFlightCostRevisions);
profitabilityRouter.patch("/flight-cost-sheets/:sheetId", flightController.updateFlightCostSheet);
profitabilityRouter.post("/flight-cost-sheets/:sheetId/finalize", flightController.finalizeFlightCostSheet);
profitabilityRouter.post("/flight-cost-sheets/:sheetId/cancel", flightController.cancelFlightCostSheet);
profitabilityRouter.post("/flight-cost-sheets/:sheetId/review", flightController.reviewFlightCostSheet);
profitabilityRouter.post("/flight-manifests/:manifestId/review-check", flightController.triggerManifestReviewCheck);
