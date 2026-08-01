import { Router } from "express";
import { listAdminBookedShipments } from "../controllers/shipmentListing.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const shipmentRouter = Router();

shipmentRouter.use(attachUser);
// Delivery works the booked-shipment list alongside operations.
shipmentRouter.use(requireRole("admin", "operations", "delivery"));
shipmentRouter.get("/", listAdminBookedShipments);
