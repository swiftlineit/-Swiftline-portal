import { Router } from "express";
import {
  createAdminCreditAgreementDraft,
  generateAdminCreditAgreement,
  getAdminCreditAgreement,
  getAdminCreditAgreementPdf,
  listAdminCreditAgreements
} from "../controllers/creditAgreement.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";

export const creditAgreementRouter = Router();

creditAgreementRouter.use(attachUser);
// Read-only for operations, alongside the rest of the credit records. Drafting
// and generating an agreement commits the company to terms, so both stay with
// finance.
creditAgreementRouter.use(requireRole("admin", "finance", "operations"));

const requireFinance = requireRole("admin", "finance");

creditAgreementRouter.get("/", listAdminCreditAgreements);
creditAgreementRouter.post("/business-accounts/:businessAccountId/drafts", requireFinance, createAdminCreditAgreementDraft);
creditAgreementRouter.post("/:agreementId/generate", requireFinance, generateAdminCreditAgreement);
creditAgreementRouter.get("/:agreementId/pdf", getAdminCreditAgreementPdf);
creditAgreementRouter.get("/:agreementId", getAdminCreditAgreement);
