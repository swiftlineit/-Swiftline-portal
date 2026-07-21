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
creditAgreementRouter.use(requireRole("admin"));
creditAgreementRouter.get("/", listAdminCreditAgreements);
creditAgreementRouter.post("/business-accounts/:businessAccountId/drafts", createAdminCreditAgreementDraft);
creditAgreementRouter.post("/:agreementId/generate", generateAdminCreditAgreement);
creditAgreementRouter.get("/:agreementId/pdf", getAdminCreditAgreementPdf);
creditAgreementRouter.get("/:agreementId", getAdminCreditAgreement);
