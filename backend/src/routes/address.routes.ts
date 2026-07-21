import { Router } from "express";
import {
  autocompleteAddress,
  confirmValidatedAddress,
  getPlaceAddress,
  validateAddress
} from "../controllers/address.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const addressRouter = Router();

addressRouter.use(attachUser);
addressRouter.use(requireRole("admin"));

addressRouter.post("/autocomplete", autocompleteAddress);
addressRouter.get("/places/:placeId", getPlaceAddress);
addressRouter.post("/validate", validateAddress);
addressRouter.post("/confirm", confirmValidatedAddress);
