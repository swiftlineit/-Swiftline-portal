import { Router } from "express";
import { createDriver, createDriverInvitationLink, getDriver, getMyDriverProfile, listDrivers, updateDriverStatus } from "../controllers/driver.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const driverManagementRouter = Router();
driverManagementRouter.use(attachUser, requireRole("admin", "operations"));
driverManagementRouter.get("/", listDrivers);
driverManagementRouter.post("/", createDriver);
driverManagementRouter.get("/:driverId", getDriver);
driverManagementRouter.post("/:driverId/invitation-link", createDriverInvitationLink);
driverManagementRouter.patch("/:driverId/status", updateDriverStatus);

export const driverPortalRouter = Router();
driverPortalRouter.use(attachUser, requireRole("delivery"));
driverPortalRouter.get("/profile", getMyDriverProfile);
