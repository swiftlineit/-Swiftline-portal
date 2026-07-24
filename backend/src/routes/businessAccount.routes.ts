import { Router } from "express";
import {
  createBusinessAccountClientAccess,
  createBusinessAccountInvitationLink,
  listBusinessAccountMembers,
  resendBusinessAccountInvitation,
  updateBusinessAccountMemberStatus
} from "../controllers/businessAccountAccess.controller.js";
import {
  assignBusinessAccountBranch,
  createBusinessAccount,
  getBusinessAccount,
  listBusinessAccounts,
  submitBusinessAccount,
  updateBusinessAccount,
  updateBusinessAccountOperationalAction,
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
businessAccountRouter.get("/:accountId/members", listBusinessAccountMembers);
businessAccountRouter.post("/:accountId/client-access", createBusinessAccountClientAccess);
businessAccountRouter.post("/:accountId/members/:memberId/resend-invitation", resendBusinessAccountInvitation);
businessAccountRouter.post("/:accountId/members/:memberId/invitation-link", createBusinessAccountInvitationLink);
businessAccountRouter.patch("/:accountId/members/:memberId/status", updateBusinessAccountMemberStatus);
businessAccountRouter.get("/:accountId/documents/:documentType", viewBusinessAccountDocument);
businessAccountRouter.patch("/:accountId", businessDocumentUpload, updateBusinessAccount);
businessAccountRouter.patch("/:accountId/assign-branch", assignBusinessAccountBranch);
businessAccountRouter.patch("/:accountId/operational-action", updateBusinessAccountOperationalAction);
businessAccountRouter.patch("/:accountId/kyc-review", updateBusinessAccountKycReview);
businessAccountRouter.patch("/:accountId/status", updateBusinessAccountStatus);
businessAccountRouter.post("/:accountId/submit", submitBusinessAccount);
