import { Router } from "express";
import {
  createTaxInvoice,
  deleteTaxInvoice,
  finalizeTaxInvoice,
  getTaxInvoice,
  listTaxInvoices,
  updateTaxInvoice
} from "../controllers/taxInvoice.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const taxInvoiceRouter = Router();

taxInvoiceRouter.use(attachUser);
taxInvoiceRouter.use(requireRole("admin", "staff"));

taxInvoiceRouter.get("/", listTaxInvoices);
taxInvoiceRouter.post("/", createTaxInvoice);
taxInvoiceRouter.get("/:invoiceId", getTaxInvoice);
taxInvoiceRouter.put("/:invoiceId", updateTaxInvoice);
taxInvoiceRouter.post("/:invoiceId/finalize", finalizeTaxInvoice);
taxInvoiceRouter.delete("/:invoiceId", deleteTaxInvoice);
