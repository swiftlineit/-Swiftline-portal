import { Router } from "express";
import { autocompleteLookup, getLookupPlace } from "../controllers/addressLookup.controller.js";
import { attachUser, requireAuthenticated } from "../middleware/auth.middleware.js";
import { addressLookupLimiter } from "../middleware/rateLimit.middleware.js";

// Deliberately a separate router from `address.routes.ts`: that one is scoped to
// operations shipment flows behind requireRole("admin", "operations"), and these
// endpoints are open to every signed-in user, clients included. Keeping them
// apart means neither can loosen the other by accident.
export const addressLookupRouter = Router();

addressLookupRouter.use(attachUser);
addressLookupRouter.use(requireAuthenticated);
addressLookupRouter.use(addressLookupLimiter);

addressLookupRouter.post("/autocomplete", autocompleteLookup);
addressLookupRouter.get("/places/:placeId", getLookupPlace);
