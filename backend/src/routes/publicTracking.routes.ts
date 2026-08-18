import { Router } from "express";
import { trackPublicShipment } from "../controllers/publicTracking.controller.js";
import { publicTrackingHourlyLimiter, publicTrackingLimiter } from "../middleware/rateLimit.middleware.js";

/**
 * Reached with no session at all- the consignee owns the parcel but has no
 * portal account, and the AWB on the label is the only thing they hold.
 *
 * Mounted as its own Router, like the public rate card one, so it cannot inherit
 * a staff or client gate by accident. Nothing here calls attachUser, and nothing
 * here writes.
 */
export const publicTrackingRouter = Router();

publicTrackingRouter.use(publicTrackingHourlyLimiter);
publicTrackingRouter.use(publicTrackingLimiter);

publicTrackingRouter.get("/:trackingNumber", trackPublicShipment);
