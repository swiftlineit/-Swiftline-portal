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

export const profitabilityRouter = Router();

profitabilityRouter.use(attachUser);
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
