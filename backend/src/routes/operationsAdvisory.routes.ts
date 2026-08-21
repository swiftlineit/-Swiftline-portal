import { Router } from "express";
import {
  createCalendarEntry,
  createRegulatoryUpdate,
  createServiceDisruption,
  deleteCalendarEntry,
  deleteRegulatoryUpdate,
  deleteServiceDisruption,
  listCalendarEntries,
  listRegulatoryUpdates,
  listServiceDisruptions,
  updateCalendarEntry,
  updateRegulatoryUpdate,
  updateServiceDisruption
} from "../controllers/operationsAdvisory.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

/**
 * Staff endpoints for the Operations Advisory module. Publishing disruptions
 * and maintaining the Holiday & Cut-Off Calendar is an admin/operations job, so
 * the whole router is gated once. Client visibility sits under the client
 * router, which already enforces the client role.
 */
export const operationsAdvisoryRouter = Router();

operationsAdvisoryRouter.use(attachUser);
operationsAdvisoryRouter.use(requireRole("admin", "operations"));

// Service Disruption Centre
operationsAdvisoryRouter.get("/service-disruptions", listServiceDisruptions);
operationsAdvisoryRouter.post("/service-disruptions", createServiceDisruption);
operationsAdvisoryRouter.patch("/service-disruptions/:id", updateServiceDisruption);
operationsAdvisoryRouter.delete("/service-disruptions/:id", deleteServiceDisruption);

// Holiday & Cut-Off Calendar
operationsAdvisoryRouter.get("/calendar-entries", listCalendarEntries);
operationsAdvisoryRouter.post("/calendar-entries", createCalendarEntry);
operationsAdvisoryRouter.patch("/calendar-entries/:id", updateCalendarEntry);
operationsAdvisoryRouter.delete("/calendar-entries/:id", deleteCalendarEntry);

// Customs & Regulatory Updates
operationsAdvisoryRouter.get("/regulatory-updates", listRegulatoryUpdates);
operationsAdvisoryRouter.post("/regulatory-updates", createRegulatoryUpdate);
operationsAdvisoryRouter.patch("/regulatory-updates/:id", updateRegulatoryUpdate);
operationsAdvisoryRouter.delete("/regulatory-updates/:id", deleteRegulatoryUpdate);
