import { Router } from "express";
import {
  createShipmentImportBatch,
  createShipmentImportDrafts,
  downloadShipmentImportTemplate,
  getShipmentImportBatch
} from "../controllers/shipmentImport.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";
import { shipmentImportUpload } from "../middleware/shipmentImportUpload.middleware.js";

export const shipmentImportRouter = Router();

shipmentImportRouter.use(attachUser);
shipmentImportRouter.use(requireRole("admin", "operations"));
shipmentImportRouter.get("/template", downloadShipmentImportTemplate);
shipmentImportRouter.post("/batches", shipmentImportUpload, createShipmentImportBatch);
shipmentImportRouter.get("/batches/:batchId", getShipmentImportBatch);
shipmentImportRouter.post("/batches/:batchId/create-drafts", createShipmentImportDrafts);
