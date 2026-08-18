import { Router } from "express";
import {
  createRateCardShare,
  downloadPublicRateCardSharePdf,
  downloadPublicRateCardShareWorkbook,
  downloadRateCardSharePdf,
  downloadRateCardShareWorkbook,
  getPublicRateCardShare,
  getRateCardShare,
  listRateCardShares,
  revokeRateCardShare
} from "../controllers/rateCardShare.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";
import { publicRateCardLimiter } from "../middleware/rateLimit.middleware.js";

export const rateCardShareRouter = Router();

// Pricing is commercial: the same roles that maintain the rate card decide who
// sees it and at what markup.
rateCardShareRouter.use(attachUser);
rateCardShareRouter.use(requireRole("admin", "finance", "operations"));

rateCardShareRouter.get("/", listRateCardShares);
rateCardShareRouter.post("/", createRateCardShare);
rateCardShareRouter.get("/:shareId", getRateCardShare);
rateCardShareRouter.get("/:shareId/pdf", downloadRateCardSharePdf);
rateCardShareRouter.get("/:shareId/xlsx", downloadRateCardShareWorkbook);
rateCardShareRouter.post("/:shareId/revoke", revokeRateCardShare);

/**
 * Reached with no session at all- the link token is the whole credential, so
 * this router deliberately never calls attachUser. Mounted separately so it
 * cannot inherit the staff gate above by accident.
 */
export const publicRateCardRouter = Router();

publicRateCardRouter.use(publicRateCardLimiter);

publicRateCardRouter.get("/:shareId", getPublicRateCardShare);
publicRateCardRouter.get("/:shareId/pdf", downloadPublicRateCardSharePdf);
publicRateCardRouter.get("/:shareId/xlsx", downloadPublicRateCardShareWorkbook);
