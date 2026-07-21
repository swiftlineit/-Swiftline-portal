import { Router } from "express";
import {
  approveShipmentAmendment,
  listShipmentAmendments,
  rejectShipmentAmendment
} from "../controllers/shipmentAmendment.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const shipmentAmendmentRouter = Router();

shipmentAmendmentRouter.use(attachUser);
shipmentAmendmentRouter.use(requireRole("admin"));

shipmentAmendmentRouter.get("/", listShipmentAmendments);
shipmentAmendmentRouter.post("/:id/approve", approveShipmentAmendment);
shipmentAmendmentRouter.post("/:id/reject", rejectShipmentAmendment);
