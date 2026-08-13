import { Router } from "express";
import {
  acceptClientSettlement,
  awaitStaffClaimThirdParty,
  staffClaimCarrierAcknowledged,
  closeStaffClaim,
  completeStaffClaimDocuments,
  disputeClientSettlement,
  receiveStaffClaimInformation,
  reopenStaffClaim,
  requestStaffClaimDocuments,
  requestStaffClaimInformation,
  sendStaffClaimForApproval,
  startStaffClaimReview,
  staffThirdPartyResponded,
  requestStaffConditionalDocuments,
  uploadStaffClaimDocument,
  setStaffClaimLegalHold,
  waiveStaffClaimDocument,
  withdrawClientClaim,
  withdrawStaffClaim,
  assignStaffClaim,
  createClientClaim,
  decideStaffClaim,
  deleteClientClaimDocument,
  downloadClientClaimDocument,
  downloadClientDecisionLetter,
  downloadStaffClaimDocument,
  downloadStaffDecisionLetter,
  getClientClaim,
  getClientClaimEligibility,
  getStaffClaim,
  listClientClaimableShipments,
  listClientClaims,
  listStaffClaims,
  postClientClaimMessage,
  postStaffClaimMessage,
  revealStaffBeneficiary,
  recordStaffSettlement,
  reviewStaffClaimDocument,
  submitClientAppeal,
  submitClientBeneficiary,
  submitClientClaim,
  updateClientClaimDraft,
  uploadClientClaimDocument,
  upsertStaffRecovery,
  verifyStaffBeneficiary
} from "../controllers/claim.controller.js";
import { claimDocumentUpload } from "../middleware/claimDocumentUpload.middleware.js";
import { attachUser, requireAuthenticated, requireRole } from "../middleware/auth.middleware.js";

/**
 * Claim routes, split by audience.
 *
 * Every path is a named command rather than a generic update. There is
 * deliberately no `PATCH /claims/:id/status` — the difference between DECIDED
 * and SETTLED is money leaving a bank account, and each such step carries its
 * own preconditions and evidence.
 */

export const clientClaimRouter = Router();

// `attachUser` is what reads the Bearer token and populates `req.user`;
// `requireAuthenticated` only checks that it is there. Mounting the check
// without it rejects every request, signed in or not.
clientClaimRouter.use(attachUser);
clientClaimRouter.use(requireAuthenticated);

clientClaimRouter.get("/", listClientClaims);
clientClaimRouter.get("/claimable-shipments", listClientClaimableShipments);
clientClaimRouter.get("/eligibility/:shipmentId", getClientClaimEligibility);
clientClaimRouter.post("/", createClientClaim);
clientClaimRouter.get("/:claimId", getClientClaim);
clientClaimRouter.patch("/:claimId/draft", updateClientClaimDraft);
clientClaimRouter.post("/:claimId/submit", submitClientClaim);
clientClaimRouter.post("/:claimId/documents", claimDocumentUpload, uploadClientClaimDocument);
clientClaimRouter.get("/:claimId/documents/:documentId", downloadClientClaimDocument);
clientClaimRouter.delete("/:claimId/documents/:documentId", deleteClientClaimDocument);
clientClaimRouter.post("/:claimId/messages", postClientClaimMessage);
clientClaimRouter.post("/:claimId/withdraw", withdrawClientClaim);
clientClaimRouter.post("/:claimId/accept", acceptClientSettlement);
clientClaimRouter.post("/:claimId/dispute", disputeClientSettlement);
clientClaimRouter.post("/:claimId/appeal", submitClientAppeal);
clientClaimRouter.get("/:claimId/decision-letter", downloadClientDecisionLetter);
clientClaimRouter.post("/:claimId/beneficiary", submitClientBeneficiary);

export const staffClaimRouter = Router();

staffClaimRouter.use(attachUser);
// HR is absent deliberately — the permission matrix grants it nothing on claims,
// so it is refused at the door rather than at each handler. The per-action
// `staffCan` checks inside still apply; this is the coarse gate.
staffClaimRouter.use(requireRole("admin", "operations", "finance", "delivery"));

staffClaimRouter.get("/", listStaffClaims);
staffClaimRouter.get("/:claimId", getStaffClaim);
staffClaimRouter.post("/:claimId/assign", assignStaffClaim);

// The review pipeline. One route per transition, because the permission and the
// reason requirement differ per command — a single endpoint taking a transition
// name would be the generic status setter this design rules out.
staffClaimRouter.post("/:claimId/start-review", startStaffClaimReview);
staffClaimRouter.post("/:claimId/request-documents", requestStaffClaimDocuments);
staffClaimRouter.post("/:claimId/complete-documents", completeStaffClaimDocuments);
staffClaimRouter.post("/:claimId/request-information", requestStaffClaimInformation);
staffClaimRouter.post("/:claimId/receive-information", receiveStaffClaimInformation);
staffClaimRouter.post("/:claimId/await-third-party", awaitStaffClaimThirdParty);
staffClaimRouter.post("/:claimId/carrier-acknowledged", staffClaimCarrierAcknowledged);
staffClaimRouter.post("/:claimId/third-party-responded", staffThirdPartyResponded);
staffClaimRouter.post("/:claimId/send-for-approval", sendStaffClaimForApproval);
staffClaimRouter.post("/:claimId/close", closeStaffClaim);
staffClaimRouter.post("/:claimId/reopen", reopenStaffClaim);
staffClaimRouter.post("/:claimId/withdraw", withdrawStaffClaim);

staffClaimRouter.post("/:claimId/decisions", decideStaffClaim);
staffClaimRouter.get("/:claimId/decision-letter", downloadStaffDecisionLetter);

// Staff upload their own documents — payment proof above all, which a
// settlement cannot be recorded without.
staffClaimRouter.post("/:claimId/documents", claimDocumentUpload, uploadStaffClaimDocument);
staffClaimRouter.get("/:claimId/documents/:documentId", downloadStaffClaimDocument);
staffClaimRouter.post("/:claimId/documents/:documentId/review", reviewStaffClaimDocument);
// Waiving a requirement and asking for extra evidence: the two escape hatches
// that keep a claim with unobtainable paperwork from stalling with no remedy.
staffClaimRouter.post("/:claimId/documents/waive", waiveStaffClaimDocument);
staffClaimRouter.post("/:claimId/documents/request", requestStaffConditionalDocuments);
staffClaimRouter.post("/:claimId/messages", postStaffClaimMessage);
staffClaimRouter.post("/:claimId/beneficiary/:beneficiaryId/verify", verifyStaffBeneficiary);
// POST, not GET: a full account number must never reach browser history or a
// proxy log. Every reveal is audited.
staffClaimRouter.post("/:claimId/beneficiary/:beneficiaryId/reveal", revealStaffBeneficiary);
staffClaimRouter.post("/:claimId/settlements", recordStaffSettlement);
staffClaimRouter.post("/:claimId/recoveries", upsertStaffRecovery);
// Admin only: a hold suspends the retention purge indefinitely.
staffClaimRouter.post("/:claimId/legal-hold", setStaffClaimLegalHold);
