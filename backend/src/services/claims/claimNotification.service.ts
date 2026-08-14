import mongoose from "mongoose";
import { BusinessAccountMember, claimHandlingRoles } from "../../models/businessAccountMember.model.js";
import { User } from "../../models/user.model.js";
import type { IClaim } from "../../models/claim.model.js";
import type { ClaimDecisionOutcome } from "../../models/claimTypes.js";
import { notifyOperationsStaff, notifyPortalUsers } from "../portalNotification.service.js";

/**
 * Every notification a claim raises, in one place.
 *
 * Each function is deliberately fire-and-forget from the caller's point of view:
 * failing to send an email must never roll back a decision or a payment that has
 * already been recorded. `notifyPortalUsers` already swallows email failures;
 * this module additionally swallows its own lookup failures for the same reason.
 */

/** Rupees for display. Claim amounts are stored as integer paise. */
function money(minor: number | null | undefined) {
  if (minor === null || minor === undefined) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(minor / 100);
}

function clientHref(claim: IClaim) {
  return `/client/claims/${String(claim._id)}`;
}

function staffHref(claim: IClaim) {
  return `/dashboard/claims/${String(claim._id)}`;
}

function label(claim: IClaim) {
  return claim.claimNumber ?? "your claim";
}

/**
 * Members who should hear about a claim.
 *
 * Tracking-only members are excluded: they can see a claim's status in the
 * portal but have no part in running one, and claim mail carries amounts.
 */
async function claimAudience(businessAccountId: mongoose.Types.ObjectId) {
  const members = await BusinessAccountMember.find({
    businessAccount: businessAccountId,
    status: "active",
    role: { $in: claimHandlingRoles }
  })
    .select("user")
    .lean()
    .exec();
  return members.map((member) => member.user);
}

/**
 * Only the members who can actually act.
 *
 * Accepting a settlement, appealing, and supplying bank details are restricted
 * to owners and admins, so telling operations that action is required would send
 * them to a button they cannot press.
 */
async function decisionMakers(businessAccountId: mongoose.Types.ObjectId) {
  const members = await BusinessAccountMember.find({
    businessAccount: businessAccountId,
    status: "active",
    role: { $in: ["account_owner", "account_admin"] }
  })
    .select("user")
    .lean()
    .exec();
  return members.map((member) => member.user);
}

/** Finance sees settlement work; operations and admin see everything. */
async function settlementStaff() {
  const staff = await User.find({
    role: { $in: ["admin", "operations", "finance"] },
    userStatus: "active"
  })
    .select("_id")
    .lean()
    .exec();
  return staff.map((member) => member._id);
}

/**
 * Wraps a send so a notification failure cannot break the domain action that
 * triggered it. A claim that was decided but failed to email is recoverable;
 * a decision rolled back by a mail outage is not.
 */
async function safely(task: () => Promise<unknown>, context: string) {
  try {
    await task();
  } catch (error) {
    console.error(`Claim notification failed: ${context}`, {
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
}

// ---------------------------------------------------------------------------
// Client-facing
// ---------------------------------------------------------------------------

export async function notifyClaimSubmitted(claim: IClaim, filedLate: boolean) {
  await safely(async () => {
    await notifyPortalUsers(await claimAudience(claim.businessAccountId), {
      type: "CLAIM_SUBMITTED",
      title: `Claim ${claim.claimNumber} received`,
      message: filedLate
        ? "We have your claim. It was filed after the usual window, so our team will review whether it can be accepted."
        : "We have your claim and will confirm the next steps shortly.",
      href: clientHref(claim),
      idempotencyKey: `claim-submitted:${String(claim._id)}`,
      businessAccountId: claim.businessAccountId,
      metadata: { claimNumber: claim.claimNumber, filedLate }
    });

    await notifyOperationsStaff({
      type: "CLAIM_RECEIVED_STAFF",
      title: `New claim ${claim.claimNumber}`,
      message: `${claim.category.replace(/_/g, " ").toLowerCase()} · ${money(claim.requestedAmountMinor)} requested${filedLate ? " · filed late" : ""}`,
      href: staffHref(claim),
      idempotencyKey: `claim-received-staff:${String(claim._id)}`,
      metadata: { claimNumber: claim.claimNumber, filedLate }
    });
  }, "submitted");
}

export async function notifyClaimDocumentsRequired(claim: IClaim, missingCount: number) {
  await safely(async () => {
    await notifyPortalUsers(await claimAudience(claim.businessAccountId), {
      type: "CLAIM_DOCUMENTS_REQUIRED",
      title: `Documents needed for ${label(claim)}`,
      message: `${missingCount} document${missingCount === 1 ? "" : "s"} still outstanding. Your claim cannot be assessed until they arrive.`,
      href: clientHref(claim),
      // Keyed by count so a further request after more arrive is a new message
      // rather than a silent duplicate.
      idempotencyKey: `claim-documents-required:${String(claim._id)}:${missingCount}`,
      businessAccountId: claim.businessAccountId
    });
  }, "documents required");
}

export async function notifyClaimDocumentRejected(
  claim: IClaim,
  documentName: string,
  reason: string
) {
  await safely(async () => {
    await notifyPortalUsers(await claimAudience(claim.businessAccountId), {
      type: "CLAIM_DOCUMENT_REJECTED",
      title: `A document on ${label(claim)} needs replacing`,
      // The reason is carried through so the client can act without opening the
      // portal to find out what was wrong.
      message: `${documentName}: ${reason}`,
      href: clientHref(claim),
      idempotencyKey: `claim-document-rejected:${String(claim._id)}:${documentName}:${Date.now()}`,
      businessAccountId: claim.businessAccountId
    });
  }, "document rejected");
}

export async function notifyClaimDecision(
  claim: IClaim,
  outcome: ClaimDecisionOutcome,
  approvedAmountMinor: number,
  explanation: string
) {
  await safely(async () => {
    const rejected = outcome === "REJECTED";

    await notifyPortalUsers(await claimAudience(claim.businessAccountId), {
      type: "CLAIM_DECISION_ISSUED",
      title: `Decision on ${label(claim)}`,
      message: rejected
        ? `Your claim was not approved. ${explanation}`
        : `${money(approvedAmountMinor)} approved. ${explanation}`,
      href: clientHref(claim),
      idempotencyKey: `claim-decision:${String(claim._id)}:${claim.decidedAt?.getTime() ?? Date.now()}`,
      businessAccountId: claim.businessAccountId,
      metadata: { outcome, approvedAmountMinor },
      // The only claim mail with its own template. Everything the client needs
      // to accept or challenge the outcome has to be in the email itself, not
      // behind a login — including the arithmetic and the appeal deadline.
      email: {
        templateKey: "CLAIM_DECISION",
        payload: {
          claimNumber: claim.claimNumber,
          outcome,
          requestedAmountMinor: claim.requestedAmountMinor,
          approvedAmountMinor,
          declaredValueMinor: claim.shipmentSnapshot?.totalDeclaredValueMinor ?? 0,
          customerExplanation: explanation,
          trackingNumber: claim.shipmentSnapshot?.trackingNumber ?? "",
          appealDeadlineAt: claim.deadlines?.appealDeadlineAt ?? null
        }
      }
    });

    // Sent separately and only to those who can act, because it asks for an
    // action rather than announcing an outcome.
    if (!rejected) {
      await notifyPortalUsers(await decisionMakers(claim.businessAccountId), {
        type: "CLAIM_SETTLEMENT_ACCEPTANCE_REQUIRED",
        title: `Accept the settlement on ${label(claim)}`,
        message: `${money(approvedAmountMinor)} is ready to settle once you accept and confirm your bank details.`,
        href: clientHref(claim),
        idempotencyKey: `claim-acceptance-required:${String(claim._id)}`,
        businessAccountId: claim.businessAccountId
      });
    }
  }, "decision issued");
}

export async function notifyClaimBankDetailsRejected(claim: IClaim, reason: string) {
  await safely(async () => {
    await notifyPortalUsers(await decisionMakers(claim.businessAccountId), {
      type: "CLAIM_BANK_DETAILS_REJECTED",
      title: `Bank details on ${label(claim)} need correcting`,
      message: reason,
      href: clientHref(claim),
      idempotencyKey: `claim-bank-rejected:${String(claim._id)}:${Date.now()}`,
      businessAccountId: claim.businessAccountId
    });
  }, "bank details rejected");
}

export async function notifyClaimPaid(claim: IClaim, paidAmountMinor: number, reference: string) {
  await safely(async () => {
    await notifyPortalUsers(await claimAudience(claim.businessAccountId), {
      type: "CLAIM_PAYMENT_COMPLETED",
      title: `${money(paidAmountMinor)} paid for ${label(claim)}`,
      // The bank reference is safe to send; the account number is not, and never
      // appears in a notification, an email, or a URL.
      message: `Payment has been made to your verified account. Bank reference ${reference}.`,
      href: clientHref(claim),
      idempotencyKey: `claim-paid:${String(claim._id)}`,
      businessAccountId: claim.businessAccountId,
      metadata: { paidAmountMinor, reference }
    });
  }, "payment completed");
}

export async function notifyClaimAppealWindowClosing(claim: IClaim, daysLeft: number) {
  await safely(async () => {
    await notifyPortalUsers(await decisionMakers(claim.businessAccountId), {
      type: "CLAIM_APPEAL_WINDOW_CLOSING",
      title: `${daysLeft} day${daysLeft === 1 ? "" : "s"} left to appeal ${label(claim)}`,
      message: "After this date the decision on your claim becomes final.",
      href: clientHref(claim),
      // Keyed by day so a reminder can be sent more than once without repeating
      // itself on the same day.
      idempotencyKey: `claim-appeal-closing:${String(claim._id)}:${daysLeft}`,
      businessAccountId: claim.businessAccountId
    });
  }, "appeal window closing");
}

export async function notifyClaimClosed(claim: IClaim) {
  await safely(async () => {
    await notifyPortalUsers(await claimAudience(claim.businessAccountId), {
      type: "CLAIM_CLOSED",
      title: `${label(claim)} is closed`,
      message: "No further action is needed. The claim record remains available in the portal.",
      href: clientHref(claim),
      idempotencyKey: `claim-closed:${String(claim._id)}`,
      businessAccountId: claim.businessAccountId
    });
  }, "closed");
}

// ---------------------------------------------------------------------------
// Staff-facing
// ---------------------------------------------------------------------------

export async function notifyClaimClientReplied(claim: IClaim) {
  await safely(
    () =>
      notifyOperationsStaff({
        type: "CLAIM_CLIENT_REPLIED",
        title: `Client replied on ${claim.claimNumber ?? "a claim"}`,
        message: "A new message is waiting on this claim.",
        href: staffHref(claim),
        idempotencyKey: `claim-client-replied:${String(claim._id)}:${Date.now()}`
      }),
    "client replied"
  );
}

export async function notifyClaimDocumentsComplete(claim: IClaim) {
  await safely(
    () =>
      notifyOperationsStaff({
        type: "CLAIM_DOCUMENTS_COMPLETE",
        title: `${claim.claimNumber ?? "A claim"} is ready to assess`,
        message: "Every required document has arrived.",
        href: staffHref(claim),
        idempotencyKey: `claim-documents-complete:${String(claim._id)}`
      }),
    "documents complete"
  );
}

export async function notifyClaimSettlementAccepted(claim: IClaim) {
  await safely(async () => {
    await notifyPortalUsers(await settlementStaff(), {
      type: "CLAIM_SETTLEMENT_ACCEPTED",
      title: `${claim.claimNumber ?? "A claim"} accepted — payment due`,
      message: `${money(claim.approvedAmountMinor)} to pay once bank details are verified.`,
      href: staffHref(claim),
      idempotencyKey: `claim-settlement-accepted:${String(claim._id)}`
    });
  }, "settlement accepted");
}

export async function notifyClaimAppealSubmitted(claim: IClaim, reason: string) {
  await safely(
    () =>
      notifyOperationsStaff({
        type: "CLAIM_APPEAL_SUBMITTED",
        title: `Appeal on ${claim.claimNumber ?? "a claim"}`,
        message: reason.slice(0, 300),
        href: staffHref(claim),
        idempotencyKey: `claim-appeal:${String(claim._id)}`
      }),
    "appeal submitted"
  );
}

export async function notifyClaimSlaDue(claim: IClaim, overdue: boolean) {
  await safely(
    () =>
      notifyOperationsStaff({
        type: "CLAIM_SLA_DUE",
        title: `${claim.claimNumber ?? "A claim"} review ${overdue ? "overdue" : "due"}`,
        message: overdue
          ? "This claim has passed its internal review target."
          : "This claim reaches its internal review target today.",
        href: staffHref(claim),
        // Keyed by day so a daily sweep re-notifies rather than sending once and
        // going quiet on a claim that stays overdue.
        idempotencyKey: `claim-sla:${String(claim._id)}:${new Date().toISOString().slice(0, 10)}`
      }),
    "sla due"
  );
}
