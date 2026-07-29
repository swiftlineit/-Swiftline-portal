import { Router } from "express";
import { listAdminBookedShipments } from "../controllers/shipmentListing.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const shipmentRouter = Router();

shipmentRouter.use(attachUser);
shipmentRouter.use(requireRole("admin"));
shipmentRouter.get("/", listAdminBookedShipments);
