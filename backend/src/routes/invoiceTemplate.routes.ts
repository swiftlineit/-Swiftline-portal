import { Router } from "express";
import { downloadDpdInvoiceTemplate } from "../controllers/invoiceUpload.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const invoiceTemplateRouter = Router();

invoiceTemplateRouter.use(attachUser);
invoiceTemplateRouter.use(requireRole("admin"));

invoiceTemplateRouter.get("/dpd/download", downloadDpdInvoiceTemplate);
