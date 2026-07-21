import { Router } from "express";
import {
  getBranchDpdStatus,
  listDpdConfigurations,
  upsertDpdConfiguration
} from "../controllers/dpdConfiguration.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const dpdConfigurationRouter = Router();

dpdConfigurationRouter.use(attachUser);
dpdConfigurationRouter.use(requireRole("admin"));

dpdConfigurationRouter.get("/", listDpdConfigurations);
dpdConfigurationRouter.put("/", upsertDpdConfiguration);
dpdConfigurationRouter.get("/branches/:branchId/status", getBranchDpdStatus);
