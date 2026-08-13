import { Router } from "express";
import {
  deleteSwiftlineRoute,
  listSwiftlineRoutes,
  saveSwiftlineRoute
} from "../controllers/swiftlineRoute.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const swiftlineRouteRouter = Router();

swiftlineRouteRouter.use(attachUser);
// Operations maintains the lanes day to day and admin oversees them. Finance is
// left off: a transit time carries no money, and route charges are where the
// pricing they own already lives.
swiftlineRouteRouter.use(requireRole("admin", "operations"));

swiftlineRouteRouter.get("/", listSwiftlineRoutes);
swiftlineRouteRouter.put("/", saveSwiftlineRoute);
swiftlineRouteRouter.delete("/:routeId", deleteSwiftlineRoute);
