import { Router } from "express";
import {
  commitRateCardImport,
  createCountryRateCard,
  deleteCountryRateCard,
  listCountryRateCards,
  listRateCardAssignmentAccounts,
  listCountryRouteCharges,
  previewRateCardImport,
  saveCountryRouteCharge,
  updateCountryRateCard
} from "../controllers/countryRateCard.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";
import { rateCardImportUpload } from "../middleware/rateCardImportUpload.middleware.js";

export const countryRateCardRouter = Router();

countryRateCardRouter.use(attachUser);
countryRateCardRouter.use(requireRole("admin", "finance", "operations"));

countryRateCardRouter.get("/", listCountryRateCards);
countryRateCardRouter.post("/", createCountryRateCard);
countryRateCardRouter.get("/assignment-accounts", listRateCardAssignmentAccounts);

// Registered before the "/:id" handlers so "route-charges" is never read as a
// rate card id.
countryRateCardRouter.get("/route-charges", listCountryRouteCharges);
countryRateCardRouter.put("/route-charges", saveCountryRouteCharge);

countryRateCardRouter.post("/imports/preview", rateCardImportUpload, previewRateCardImport);
countryRateCardRouter.post("/imports", commitRateCardImport);

countryRateCardRouter.patch("/:id", updateCountryRateCard);
countryRateCardRouter.delete("/:id", deleteCountryRateCard);
