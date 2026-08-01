import { Router } from "express";
import {
  createInvoiceUpload,
  getInvoiceUpload,
  processInvoiceUpload
} from "../controllers/invoiceUpload.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";
import { invoiceUpload } from "../middleware/invoiceUpload.middleware.js";

export const invoiceUploadRouter = Router();

invoiceUploadRouter.use(attachUser);
invoiceUploadRouter.use(requireRole("admin", "operations"));

invoiceUploadRouter.post("/", invoiceUpload, createInvoiceUpload);
invoiceUploadRouter.post("/:id/process", processInvoiceUpload);
invoiceUploadRouter.get("/:id", getInvoiceUpload);
