import { Router } from "express";
import {
  createCountryRateCard,
  deleteCountryRateCard,
  listCountryRateCards,
  listRateCardAssignmentAccounts,
  listCountryRouteCharges,
  saveCountryRouteCharge,
  updateCountryRateCard
} from "../controllers/countryRateCard.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

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

countryRateCardRouter.patch("/:id", updateCountryRateCard);
countryRateCardRouter.delete("/:id", deleteCountryRateCard);
