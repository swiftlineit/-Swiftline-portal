import { Router } from "express";
import {
  autocompleteAddress,
  autocompleteConsignorAddress,
  confirmValidatedAddress,
  getConsignorPlaceAddress,
  getPlaceAddress,
  validateAddress
} from "../controllers/address.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const addressRouter = Router();

addressRouter.use(attachUser);
addressRouter.use(requireRole("admin"));

addressRouter.post("/autocomplete", autocompleteAddress);
addressRouter.post("/consignor/autocomplete", autocompleteConsignorAddress);
addressRouter.get("/consignor/places/:placeId", getConsignorPlaceAddress);
addressRouter.get("/places/:placeId", getPlaceAddress);
addressRouter.post("/validate", validateAddress);
addressRouter.post("/confirm", confirmValidatedAddress);
