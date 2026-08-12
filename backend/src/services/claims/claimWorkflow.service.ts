import mongoose from "mongoose";
import { AuditLog } from "../../models/auditLog.model.js";
import { Claim } from "../../models/claim.model.js";
import type { IClaim } from "../../models/claim.model.js";
import { ClaimEvent } from "../../models/claimEvent.model.js";
import type { ClaimEventType } from "../../models/claimEvent.model.js";
import { buildClaimChecklistFor } from "./claimChecklist.service.js";
import {
  notifyClaimClosed,
  notifyClaimDocumentsComplete,
  notifyClaimDocumentsRequired
} from "./claimNotification.service.js";
import { assertTransition, type ClaimTransition } from "./claimStateMachine.js";

/**
 * The claim transitions that move a case through review.
 *
 * Each is a named command with its own route, not a status field anyone can
 * set. That is the whole reason the state machine exists — but the machine only
 * decides whether a move is *legal*; this is where a legal move is actually
 * performed, recorded on the timeline, and audited.
 */

export class ClaimWorkflowError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "ClaimWorkflowError";
  }
}

/** Which timeline entry each transition writes. */
const eventTypes: Partial<Record<ClaimTransition, ClaimEventType>> = {
  REQUEST_DOCUMENTS: "INFORMATION_REQUESTED",
  COMPLETE_DOCUMENTS: "STATUS_CHANGED",
  START_REVIEW: "STATUS_CHANGED",
  REQUEST_INFORMATION: "INFORMATION_REQUESTED",
  RECEIVE_INFORMATION: "STATUS_CHANGED",
  AWAIT_THIRD_PARTY: "STATUS_CHANGED",
  CARRIER_ACKNOWLEDGED: "STATUS_CHANGED",
  THIRD_PARTY_RESPONDED: "STATUS_CHANGED",
  SEND_FOR_APPROVAL: "STATUS_CHANGED",
  DISPUTE_SETTLEMENT: "SETTLEMENT_DISPUTED",
  CLOSE: "CLOSED",
  REOPEN: "REOPENED",
  WITHDRAW: "WITHDRAWN"
};

/**
 * Transitions whose timeline entry the client should see.
 *
 * Internal routing — picking a case up, sending it for approval — is noise to a
 * client and is kept off their timeline. Anything that asks them for something,
 * or ends the claim, is public.
 */
const publicTransitions = new Set<ClaimTransition>([
  "REQUEST_DOCUMENTS",
  "REQUEST_INFORMATION",
  "AWAIT_THIRD_PARTY",
  // The carrier picking the claim up is one of the statuses a client is shown,
  // so the move onto it belongs on their timeline too.
  "CARRIER_ACKNOWLEDGED",
  "DISPUTE_SETTLEMENT",
  "CLOSE",
  "WITHDRAW",
  "REOPEN"
]);

export interface RunTransitionInput {
  claimId: string;
  actorUserId: string;
  actorKind: "CLIENT" | "STAFF";
  transition: ClaimTransition;
  reason?: string;
  now?: Date;
}

/**
 * Applies one transition.
 *
 * Deliberately not exported as a generic "set the status to X" — callers reach
 * it through the named wrappers below, each of which is a distinct route with
 * its own permission check. A single exported mover with a `transition`
 * parameter would recreate exactly the endpoint the design rules out.
 */
async function runTransition(input: RunTransitionInput) {
  const now = input.now ?? new Date();
  const claim = await Claim.findById(input.claimId).exec();
  if (!claim) throw new ClaimWorkflowError("Claim not found.", 404);

  const fromStatus = claim.status;
  const toStatus = assertTransition(input.transition, {
    status: fromStatus,
    actorKind: input.actorKind,
    reason: input.reason,
    decisionOutcome: claim.decisionOutcome
  });

  claim.status = toStatus;

  // Terminal and near-terminal transitions carry timestamps the reporting and
  // retention rules read, so they are set here rather than left to the caller.
  if (input.transition === "CLOSE") {
    claim.closedAt = now;
    // Eight years from the last final event. Computed on closure because that
    // is the first moment the clock has something to start from.
    claim.retainUntil = new Date(now.getTime() + 8 * 365 * 24 * 60 * 60 * 1000);
  }
  if (input.transition === "WITHDRAW") claim.withdrawnAt = now;
  if (input.transition === "REOPEN") {
    claim.closedAt = null;
    claim.retainUntil = null;
  }
  if (input.transition === "DISPUTE_SETTLEMENT") claim.acceptanceState = "DISPUTED";

  await claim.save();

  await ClaimEvent.create({
    claimId: claim._id,
    type: eventTypes[input.transition] ?? "STATUS_CHANGED",
    fromStatus,
    toStatus,
    actorUserId: new mongoose.Types.ObjectId(input.actorUserId),
    actorKind: input.actorKind,
    visibility: publicTransitions.has(input.transition) ? "PUBLIC" : "INTERNAL",
    reason: input.reason ?? ""
  });

  return { claim, fromStatus, toStatus };
}

/** Records an audit entry for the transitions an auditor asks about. */
async function audit(
  claim: IClaim,
  action: "CLAIM_CLOSED" | "CLAIM_REOPENED" | "CLAIM_WITHDRAWN",
  actorUserId: string,
  reason: string
) {
  await AuditLog.create({
    action,
    entityType: "CLAIM",
    entityId: claim._id,
    performedBy: new mongoose.Types.ObjectId(actorUserId),
    performedAt: new Date(),
    metadata: { claimNumber: claim.claimNumber, reason }
  });
}

// ---------------------------------------------------------------------------
// Staff commands
// ---------------------------------------------------------------------------

/** Picks the claim up for assessment. */
export async function startClaimReview(input: { claimId: string; actorUserId: string }) {
  const { claim } = await runTransition({ ...input, actorKind: "STAFF", transition: "START_REVIEW" });
  return claim;
}

/**
 * Asks the client for the evidence still missing.
 *
 * The outstanding count comes from the checklist rather than the request, so the
 * client is told what is actually missing rather than what a reviewer remembered.
 */
export async function requestClaimDocuments(input: {
  claimId: string;
  actorUserId: string;
  reason: string;
}) {
  const { claim } = await runTransition({
    ...input,
    actorKind: "STAFF",
    transition: "REQUEST_DOCUMENTS"
  });

  const checklist = await buildClaimChecklistFor(claim);
  await notifyClaimDocumentsRequired(claim, checklist.missingCount + checklist.rejectedCount);

  return claim;
}

/**
 * Marks the evidence pack complete and moves the claim into review.
 *
 * Refuses while anything required is still missing or rejected: letting a claim
 * reach assessment on evidence a reviewer has already refused is exactly the
 * confusion the checklist exists to prevent.
 */
export async function completeClaimDocuments(input: {
  claimId: string;
  actorUserId: string;
  actorKind: "CLIENT" | "STAFF";
}) {
  const claim = await Claim.findById(input.claimId).exec();
  if (!claim) throw new ClaimWorkflowError("Claim not found.", 404);

  const checklist = await buildClaimChecklistFor(claim);

  if (!checklist.complete) {
    throw new ClaimWorkflowError(
      checklist.rejectedCount > 0
        ? "Replace the rejected documents before submitting the evidence pack."
        : `${checklist.missingCount} required document(s) are still missing.`,
      409
    );
  }

  const result = await runTransition({ ...input, transition: "COMPLETE_DOCUMENTS" });
  result.claim.submissionStage = "FORMAL_COMPLETE";
  result.claim.formalCompletedAt = new Date();
  await result.claim.save();

  await notifyClaimDocumentsComplete(result.claim);

  return result.claim;
}

export async function requestClaimInformation(input: {
  claimId: string;
  actorUserId: string;
  reason: string;
}) {
  const { claim } = await runTransition({
    ...input,
    actorKind: "STAFF",
    transition: "REQUEST_INFORMATION"
  });
  return claim;
}

export async function receiveClaimInformation(input: {
  claimId: string;
  actorUserId: string;
  actorKind: "CLIENT" | "STAFF";
}) {
  const { claim } = await runTransition({ ...input, transition: "RECEIVE_INFORMATION" });
  return claim;
}

export async function awaitClaimThirdParty(input: {
  claimId: string;
  actorUserId: string;
  reason: string;
}) {
  const { claim } = await runTransition({
    ...input,
    actorKind: "STAFF",
    transition: "AWAIT_THIRD_PARTY"
  });
  return claim;
}

/** The carrier has picked the claim up and begun reviewing it. */
export async function claimCarrierAcknowledged(input: { claimId: string; actorUserId: string }) {
  const { claim } = await runTransition({
    ...input,
    actorKind: "STAFF",
    transition: "CARRIER_ACKNOWLEDGED"
  });
  return claim;
}

export async function thirdPartyResponded(input: { claimId: string; actorUserId: string }) {
  const { claim } = await runTransition({
    ...input,
    actorKind: "STAFF",
    transition: "THIRD_PARTY_RESPONDED"
  });
  return claim;
}

export async function sendClaimForApproval(input: { claimId: string; actorUserId: string }) {
  const { claim } = await runTransition({
    ...input,
    actorKind: "STAFF",
    transition: "SEND_FOR_APPROVAL"
  });
  return claim;
}

export async function closeClaim(input: { claimId: string; actorUserId: string; reason?: string }) {
  const { claim } = await runTransition({ ...input, actorKind: "STAFF", transition: "CLOSE" });
  await audit(claim, "CLAIM_CLOSED", input.actorUserId, input.reason ?? "");
  await notifyClaimClosed(claim);
  return claim;
}

export async function reopenClaim(input: {
  claimId: string;
  actorUserId: string;
  reason: string;
}) {
  const { claim } = await runTransition({ ...input, actorKind: "STAFF", transition: "REOPEN" });
  await audit(claim, "CLAIM_REOPENED", input.actorUserId, input.reason);
  return claim;
}

/**
 * Drops a required document from this claim's checklist.
 *
 * Exists because some requirements are genuinely unobtainable — a packing list
 * for goods the shipper never itemised, a consignee statement from a receiver
 * who will not respond. Without it those claims stall forever with no remedy
 * an operator can apply.
 *
 * The reason is mandatory and goes on the client-visible timeline: waiving a
 * requirement is a decision someone will be asked to justify.
 */
export async function waiveClaimDocument(input: {
  claimId: string;
  actorUserId: string;
  category: string;
  reason: string;
}) {
  const claim = await Claim.findById(input.claimId).exec();
  if (!claim) throw new ClaimWorkflowError("Claim not found.", 404);

  if (!input.reason.trim()) {
    throw new ClaimWorkflowError("Give a reason for waiving this document.");
  }
  if (claim.waivedDocuments.some((entry) => entry.category === input.category)) {
    throw new ClaimWorkflowError("That document has already been waived.", 409);
  }

  claim.waivedDocuments.push({
    category: input.category,
    reason: input.reason,
    actorUserId: new mongoose.Types.ObjectId(input.actorUserId),
    createdAt: new Date()
  });
  await claim.save();

  await ClaimEvent.create({
    claimId: claim._id,
    type: "DOCUMENT_WAIVED",
    actorUserId: new mongoose.Types.ObjectId(input.actorUserId),
    actorKind: "STAFF",
    visibility: "PUBLIC",
    reason: input.reason,
    metadata: { category: input.category }
  });

  await AuditLog.create({
    action: "CLAIM_DOCUMENT_WAIVED",
    entityType: "CLAIM",
    entityId: claim._id,
    performedBy: new mongoose.Types.ObjectId(input.actorUserId),
    performedAt: new Date(),
    metadata: { category: input.category, reason: input.reason }
  });

  return claim;
}

/**
 * Asks the client for extra evidence beyond the standard list.
 *
 * A survey report or police complaint is not required of every claim — asking
 * for one routinely would make an ordinary claim feel like an investigation —
 * so they are requested case by case and then appear on the client's checklist
 * as required.
 */
export async function requestConditionalDocuments(input: {
  claimId: string;
  actorUserId: string;
  categories: string[];
  reason: string;
}) {
  const claim = await Claim.findById(input.claimId).exec();
  if (!claim) throw new ClaimWorkflowError("Claim not found.", 404);

  const added = input.categories.filter(
    (category) => !claim.requestedDocuments.some((entry) => entry.category === category)
  );
  if (added.length === 0) {
    throw new ClaimWorkflowError("Those documents have already been requested.", 409);
  }

  for (const category of added) {
    claim.requestedDocuments.push({
      category,
      reason: input.reason,
      actorUserId: new mongoose.Types.ObjectId(input.actorUserId),
      createdAt: new Date()
    });
  }
  await claim.save();

  await ClaimEvent.create({
    claimId: claim._id,
    type: "INFORMATION_REQUESTED",
    actorUserId: new mongoose.Types.ObjectId(input.actorUserId),
    actorKind: "STAFF",
    visibility: "PUBLIC",
    reason: input.reason,
    metadata: { categories: added }
  });

  const checklist = await buildClaimChecklistFor(claim);
  await notifyClaimDocumentsRequired(claim, checklist.missingCount + checklist.rejectedCount);

  return claim;
}

// ---------------------------------------------------------------------------
// Client commands
// ---------------------------------------------------------------------------

/** The client abandons the claim. Only possible before a decision is issued. */
export async function withdrawClaim(input: {
  claimId: string;
  actorUserId: string;
  actorKind: "CLIENT" | "STAFF";
  reason: string;
}) {
  const { claim } = await runTransition({ ...input, transition: "WITHDRAW" });
  await audit(claim, "CLAIM_WITHDRAWN", input.actorUserId, input.reason);
  return claim;
}

/**
 * The client rejects the outcome without formally appealing.
 *
 * Keeps the claim at DECIDED and marks acceptance disputed, so staff see the
 * disagreement while the appeal window — and the one appeal it allows — stays
 * untouched.
 */
export async function disputeClaimSettlement(input: {
  claimId: string;
  actorUserId: string;
  reason: string;
}) {
  const { claim } = await runTransition({
    ...input,
    actorKind: "CLIENT",
    transition: "DISPUTE_SETTLEMENT"
  });
  return claim;
}
