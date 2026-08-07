import { Router } from "express";
import { listCounterSales } from "../controllers/counterSales.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const counterSalesRouter = Router();

counterSalesRouter.use(attachUser);
// Counter takings belong to the team that booked them. Finance is included
// because this is the money side of individual shipments, which never reaches the
// credit statements they normally work from.
counterSalesRouter.use(requireRole("admin", "operations", "finance"));

counterSalesRouter.get("/", listCounterSales);
