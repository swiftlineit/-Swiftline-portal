import { Router } from "express";
import {
  createCountryRateCard,
  deleteCountryRateCard,
  listCountryRateCards,
  updateCountryRateCard
} from "../controllers/countryRateCard.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const countryRateCardRouter = Router();

countryRateCardRouter.use(attachUser);
countryRateCardRouter.use(requireRole("admin", "finance"));

countryRateCardRouter.get("/", listCountryRateCards);
countryRateCardRouter.post("/", createCountryRateCard);
countryRateCardRouter.patch("/:id", updateCountryRateCard);
countryRateCardRouter.delete("/:id", deleteCountryRateCard);
