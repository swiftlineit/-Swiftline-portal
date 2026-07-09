import { Router } from "express";
import {
  assignBusinessAccountBranch,
  createBusinessAccount,
  getBusinessAccount,
  listBusinessAccounts,
  submitBusinessAccount,
  updateBusinessAccount,
  updateBusinessAccountKycReview,
  updateBusinessAccountStatus,
  viewBusinessAccountDocument,
  validateBusinessAccountUniqueness
} from "../controllers/businessAccount.controller.js";
import { attachUser, requireRole } from "../middleware/auth.middleware.js";
import { businessDocumentUpload } from "../middleware/businessDocumentUpload.middleware.js";

export const businessAccountRouter = Router();

businessAccountRouter.use(attachUser);
businessAccountRouter.use(requireRole("admin"));

businessAccountRouter.get("/", listBusinessAccounts);
businessAccountRouter.get("/validate-unique", validateBusinessAccountUniqueness);
businessAccountRouter.post("/", businessDocumentUpload, createBusinessAccount);
businessAccountRouter.get("/:accountId", getBusinessAccount);
businessAccountRouter.get("/:accountId/documents/:documentType", viewBusinessAccountDocument);
businessAccountRouter.patch("/:accountId", businessDocumentUpload, updateBusinessAccount);
businessAccountRouter.patch("/:accountId/assign-branch", assignBusinessAccountBranch);
businessAccountRouter.patch("/:accountId/kyc-review", updateBusinessAccountKycReview);
businessAccountRouter.patch("/:accountId/status", updateBusinessAccountStatus);
businessAccountRouter.post("/:accountId/submit", submitBusinessAccount);
