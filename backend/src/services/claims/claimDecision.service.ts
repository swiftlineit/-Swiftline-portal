import crypto from "crypto";
import mongoose from "mongoose";
import { AuditLog } from "../../models/auditLog.model.js";
import { Claim } from "../../models/claim.model.js";
import { ClaimAppeal, ClaimDecision } from "../../models/claimDecision.model.js";
import { ClaimEvent } from "../../models/claimEvent.model.js";
import { ClaimBeneficiary, ClaimSettlement } from "../../models/claimSettlement.model.js";
import { ClaimRecovery } from "../../models/claimRecovery.model.js";
import type { ClaimDecisionOutcome } from "../../models/claimTypes.js";
import { encryptSecret } from "../credentialEncryption.service.js";
import { computeAppealDeadline } from "./claimPolicy.service.js";
import { assertTransition } from "./claimStateMachine.js";
import {
  notifyClaimAppealSubmitted,
  notifyClaimBankDetailsRejected,
  notifyClaimDecision,
  notifyClaimPaid,
  notifyClaimSettlementAccepted
} from "./claimNotification.service.js";

/**
 * Deciding a claim, settling it, and chasing the carrier afterwards.
 *
 * Each command is a state transition with its own preconditions rather than a
 * field update. The gap between "approved" and "paid" is where claims go wrong,
 * so the two are separate steps with separate evidence.
 */

export class ClaimDecisionError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "ClaimDecisionError";
  }
}

/**
 * Issues a decision.
 *
 * The approved amount is whatever a reviewer typed. Nothing here derives it from
 * declared value, insurance, or liability limits — a human weighs the evidence
 * and the portal records the number.
 */
export async function decideClaim(input: {
  claimId: string;
  reviewerId: string;
  outcome: ClaimDecisionOutcome;
  approvedAmountMinor: number;
  reasonCode: string;
  customerExplanation: string;
  internalNote?: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const claim = await Claim.findById(input.claimId).exec();
  if (!claim) throw new ClaimDecisionError("Claim not found.", 404);

  assertTransition("DECIDE", {
    status: claim.status,
    actorKind: "STAFF",
    reason: input.customerExplanation,
    decisionOutcome: input.outcome
  });

  const previous = await ClaimDecision.findOne({ claimId: claim._id }).sort({ revision: -1 }).exec();
  const isAppealOutcome = claim.appealState === "SUBMITTED" || claim.appealState === "UNDER_REVIEW";
  const appeal = isAppealOutcome ? await ClaimAppeal.findOne({ claimId: claim._id }).exec() : null;

  const session = await mongoose.startSession();
  let decision: InstanceType<typeof ClaimDecision> | null = null;

  try {
    await session.withTransaction(async () => {
      const [created] = await ClaimDecision.create(
        [
          {
            claimId: claim._id,
            revision: (previous?.revision ?? 0) + 1,
            outcome: input.outcome,
            requestedAmountMinor: claim.requestedAmountMinor,
            approvedAmountMinor: input.approvedAmountMinor,
            declaredValueMinor: claim.shipmentSnapshot?.totalDeclaredValueMinor ?? 0,
            reasonCode: input.reasonCode,
            customerExplanation: input.customerExplanation,
            internalNote: input.internalNote ?? "",
            decidedBy: new mongoose.Types.ObjectId(input.reviewerId),
            supersedesDecisionId: previous?._id ?? null,
            appealId: appeal?._id ?? null
          }
        ],
        { session }
      );
      if (!created) throw new ClaimDecisionError("The decision could not be recorded.", 500);
      decision = created;

      claim.status = "DECIDED";
      claim.decisionOutcome = input.outcome;
      claim.approvedAmountMinor = input.approvedAmountMinor;
      claim.decidedAt = now;
      // A rejection has nothing to accept, so acceptance never becomes pending —
      // the client's route from here is an appeal, not a settlement.
      claim.acceptanceState = input.outcome === "REJECTED" ? "NOT_REQUIRED" : "PENDING";
      if (appeal) claim.appealState = "RESOLVED";

      if (claim.deadlines) {
        claim.deadlines.appealDeadlineAt = computeAppealDeadline(now);
      }

      await claim.save({ session });

      if (appeal) {
        appeal.reviewedBy = new mongoose.Types.ObjectId(input.reviewerId);
        appeal.reviewedAt = now;
        appeal.resultingDecisionId = created._id;
        appeal.outcomeSummary = input.customerExplanation;
        await appeal.save({ session });
      }

      await ClaimEvent.create(
        [
          {
            claimId: claim._id,
            type: "DECISION_ISSUED",
            fromStatus: "PENDING_APPROVAL",
            toStatus: "DECIDED",
            actorUserId: new mongoose.Types.ObjectId(input.reviewerId),
            actorKind: "STAFF",
            visibility: "PUBLIC",
            reason: input.customerExplanation,
            metadata: {
              outcome: input.outcome,
              approvedAmountMinor: input.approvedAmountMinor,
              revision: created.revision
            }
          }
        ],
        { session }
      );
    });
  } finally {
    await session.endSession();
  }

  await AuditLog.create({
    action: "CLAIM_DECISION_ISSUED",
    entityType: "CLAIM",
    entityId: claim._id,
    performedBy: new mongoose.Types.ObjectId(input.reviewerId),
    performedAt: now,
    metadata: {
      outcome: input.outcome,
      approvedAmountMinor: input.approvedAmountMinor,
      reasonCode: input.reasonCode
    }
  });

  await notifyClaimDecision(
    claim,
    input.outcome,
    input.approvedAmountMinor,
    input.customerExplanation
  );

  return { claim, decision };
}

/** The client accepts the decision, moving the claim toward payment. */
export async function acceptSettlement(input: { claimId: string; userId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const claim = await Claim.findById(input.claimId).exec();
  if (!claim) throw new ClaimDecisionError("Claim not found.", 404);

  assertTransition("ACCEPT_SETTLEMENT", {
    status: claim.status,
    actorKind: "CLIENT",
    decisionOutcome: claim.decisionOutcome
  });

  claim.status = "SETTLEMENT_PENDING";
  claim.acceptanceState = "ACCEPTED";
  claim.acceptedAt = now;
  await claim.save();

  await ClaimEvent.create({
    claimId: claim._id,
    type: "SETTLEMENT_ACCEPTED",
    fromStatus: "DECIDED",
    toStatus: "SETTLEMENT_PENDING",
    actorUserId: new mongoose.Types.ObjectId(input.userId),
    actorKind: "CLIENT",
    visibility: "PUBLIC",
    reason: "Client accepted the settlement."
  });

  // Finance needs to know a payment is now due, not just operations.
  await notifyClaimSettlementAccepted(claim);

  return claim;
}

/** The client appeals. One appeal, inside the window — both enforced upstream. */
export async function submitAppeal(input: {
  claimId: string;
  userId: string;
  reason: string;
  newEvidenceDocumentIds?: string[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const claim = await Claim.findById(input.claimId).exec();
  if (!claim) throw new ClaimDecisionError("Claim not found.", 404);

  const existingAppeals = await ClaimAppeal.countDocuments({ claimId: claim._id });

  assertTransition("SUBMIT_APPEAL", {
    status: claim.status,
    actorKind: "CLIENT",
    reason: input.reason,
    appealDeadlineAt: claim.deadlines?.appealDeadlineAt ?? null,
    appealCount: existingAppeals,
    now
  });

  const decision = await ClaimDecision.findOne({ claimId: claim._id }).sort({ revision: -1 }).exec();
  if (!decision) throw new ClaimDecisionError("This claim has no decision to appeal.", 409);

  claim.status = "UNDER_REVIEW";
  claim.appealState = "SUBMITTED";
  claim.acceptanceState = "DISPUTED";
  await claim.save();

  // The unique index on claimId is the real guarantee here: two tabs submitting
  // at once must not both create an appeal.
  const appeal = await ClaimAppeal.create({
    claimId: claim._id,
    againstDecisionId: decision._id,
    reason: input.reason,
    submittedBy: new mongoose.Types.ObjectId(input.userId),
    submittedAt: now,
    newEvidenceDocumentIds: (input.newEvidenceDocumentIds ?? []).map(
      (id) => new mongoose.Types.ObjectId(id)
    )
  });

  await ClaimEvent.create({
    claimId: claim._id,
    type: "APPEAL_SUBMITTED",
    fromStatus: "DECIDED",
    toStatus: "UNDER_REVIEW",
    actorUserId: new mongoose.Types.ObjectId(input.userId),
    actorKind: "CLIENT",
    visibility: "PUBLIC",
    reason: input.reason
  });

  await AuditLog.create({
    action: "CLAIM_APPEAL_SUBMITTED",
    entityType: "CLAIM",
    entityId: claim._id,
    performedBy: new mongoose.Types.ObjectId(input.userId),
    performedAt: now,
    metadata: { appealId: String(appeal._id) }
  });

  await notifyClaimAppealSubmitted(claim, input.reason);

  return appeal;
}

/** Masked form of an account number: last four digits only. */
function maskAccountNumber(accountNumber: string) {
  const digits = accountNumber.replace(/\s+/g, "");
  return `${"X".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

/**
 * Records where an approved claim should be paid.
 *
 * Versioned rather than edited: a correction creates a new row and supersedes
 * the old one, so which details a given payment actually went to stays
 * answerable years later.
 */
export async function submitBeneficiary(input: {
  claimId: string;
  userId: string;
  accountHolderName: string;
  accountNumber: string;
  confirmAccountNumber: string;
  ifsc: string;
  bankName: string;
  accountType: "SAVINGS" | "CURRENT";
  proofDocumentId?: string | null;
  authorityDocumentId?: string | null;
}) {
  const claim = await Claim.findById(input.claimId).exec();
  if (!claim) throw new ClaimDecisionError("Claim not found.", 404);

  if (claim.decisionOutcome === "REJECTED" || !claim.decisionOutcome) {
    throw new ClaimDecisionError("Bank details are collected once a claim has been approved.", 409);
  }
  if (input.accountNumber !== input.confirmAccountNumber) {
    throw new ClaimDecisionError("The account numbers do not match.");
  }
  if (!/^[0-9]{9,18}$/.test(input.accountNumber.replace(/\s+/g, ""))) {
    throw new ClaimDecisionError("Enter a valid bank account number.");
  }
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(input.ifsc.toUpperCase())) {
    throw new ClaimDecisionError("Enter a valid IFSC code.");
  }

  const digits = input.accountNumber.replace(/\s+/g, "");
  const previous = await ClaimBeneficiary.findOne({ claimId: claim._id }).sort({ version: -1 }).exec();

  if (previous) {
    // Any change forces re-verification, so a corrected account cannot inherit
    // the trust earned by the one it replaced.
    previous.state = "SUPERSEDED";
    await previous.save();
  }

  const beneficiary = await ClaimBeneficiary.create({
    claimId: claim._id,
    businessAccountId: claim.businessAccountId,
    version: (previous?.version ?? 0) + 1,
    accountHolderName: input.accountHolderName,
    accountNumberEncrypted: encryptSecret(digits, "taxId"),
    accountNumberMasked: maskAccountNumber(digits),
    accountNumberHash: crypto.createHash("sha256").update(digits).digest("hex"),
    ifsc: input.ifsc.toUpperCase(),
    bankName: input.bankName,
    accountType: input.accountType,
    proofDocumentId: input.proofDocumentId ? new mongoose.Types.ObjectId(input.proofDocumentId) : null,
    authorityDocumentId: input.authorityDocumentId
      ? new mongoose.Types.ObjectId(input.authorityDocumentId)
      : null,
    submittedBy: new mongoose.Types.ObjectId(input.userId)
  });

  await ClaimEvent.create({
    claimId: claim._id,
    type: "BENEFICIARY_SUBMITTED",
    actorUserId: new mongoose.Types.ObjectId(input.userId),
    actorKind: "CLIENT",
    visibility: "PUBLIC",
    reason: "Settlement bank details submitted.",
    // Masked only. A full account number never reaches the timeline, the audit
    // log, a notification, or a URL.
    metadata: { version: beneficiary.version, accountNumberMasked: beneficiary.accountNumberMasked }
  });

  await AuditLog.create({
    action: "CLAIM_BENEFICIARY_SUBMITTED",
    entityType: "CLAIM_BENEFICIARY",
    entityId: beneficiary._id,
    performedBy: new mongoose.Types.ObjectId(input.userId),
    performedAt: new Date(),
    metadata: { claimId: String(claim._id), version: beneficiary.version }
  });

  return beneficiary;
}

export async function verifyBeneficiary(input: {
  claimId: string;
  beneficiaryId: string;
  verifierId: string;
  approved: boolean;
  reason?: string;
}) {
  const beneficiary = await ClaimBeneficiary.findOne({
    _id: input.beneficiaryId,
    claimId: input.claimId
  }).exec();

  if (!beneficiary) throw new ClaimDecisionError("Bank details not found.", 404);

  if (!input.approved && !input.reason?.trim()) {
    throw new ClaimDecisionError("Explain why the bank details were rejected.");
  }

  beneficiary.state = input.approved ? "VERIFIED" : "REJECTED";
  beneficiary.verifiedBy = new mongoose.Types.ObjectId(input.verifierId);
  beneficiary.verifiedAt = new Date();
  beneficiary.rejectionReason = input.approved ? "" : (input.reason ?? "");
  await beneficiary.save();

  await ClaimEvent.create({
    claimId: beneficiary.claimId,
    type: "BENEFICIARY_VERIFIED",
    actorUserId: new mongoose.Types.ObjectId(input.verifierId),
    actorKind: "STAFF",
    visibility: "PUBLIC",
    reason: input.reason ?? "",
    metadata: { approved: input.approved, version: beneficiary.version }
  });

  await AuditLog.create({
    action: "CLAIM_BENEFICIARY_VERIFIED",
    entityType: "CLAIM_BENEFICIARY",
    entityId: beneficiary._id,
    performedBy: new mongoose.Types.ObjectId(input.verifierId),
    performedAt: new Date(),
    metadata: { approved: input.approved }
  });

  // Only the rejection is announced. A successful verification is invisible to
  // the client until the payment itself lands, which is the message that matters.
  if (!input.approved) {
    const claim = await Claim.findById(input.claimId).exec();
    if (claim) await notifyClaimBankDetailsRejected(claim, input.reason ?? "");
  }

  return beneficiary;
}

/**
 * Records a completed bank payment, moving the claim to SETTLED.
 *
 * The portal does not move money. The transfer happens through Swiftline's own
 * banking process and is recorded here with its reference and proof — which is
 * why proof is mandatory rather than encouraged.
 */
export async function recordSettlement(input: {
  claimId: string;
  userId: string;
  paidAmountMinor: number;
  transactionReference: string;
  paymentDate: Date;
  proofDocumentId: string;
  idempotencyKey: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const claim = await Claim.findById(input.claimId).exec();
  if (!claim) throw new ClaimDecisionError("Claim not found.", 404);

  // Replaying the same key returns the original payment rather than creating a
  // second one. Permanent, unlike the shared 24-hour idempotency store — a
  // duplicate payout a day later is still a duplicate payout.
  const existing = await ClaimSettlement.findOne({ idempotencyKey: input.idempotencyKey }).exec();
  if (existing) {
    return {
      settlement: existing,
      claim,
      duplicate: true,
      settledInFull: claim.status === "SETTLED",
      outstandingMinor: Math.max(0, (claim.approvedAmountMinor ?? 0) - (claim.paidAmountMinor ?? 0))
    };
  }

  const beneficiary = await ClaimBeneficiary.findOne({
    claimId: claim._id,
    state: "VERIFIED"
  })
    .sort({ version: -1 })
    .exec();

  if (!beneficiary) {
    throw new ClaimDecisionError("Verify the client's bank details before recording a payment.", 409);
  }

  /**
   * Payments accumulate rather than replacing one another.
   *
   * A claim can legitimately be paid in instalments, and a reopened claim may
   * already carry a payment against its earlier decision. Treating "a settlement
   * exists" as "this claim is paid" stranded exactly that case: ₹100 recorded
   * against a ₹1,000 award, with no way to pay the rest.
   *
   * Reversed and failed payments are excluded — money that came back is not
   * money the client has.
   */
  const priorPayments = await ClaimSettlement.find({
    claimId: claim._id,
    state: "RECORDED"
  })
    .select("paidAmountMinor")
    .lean()
    .exec();

  const alreadyPaid = priorPayments.reduce((total, row) => total + row.paidAmountMinor, 0);
  const approved = claim.approvedAmountMinor ?? 0;
  const outstanding = approved - alreadyPaid;

  if (outstanding <= 0) {
    throw new ClaimDecisionError(
      `This claim is already paid in full (${(alreadyPaid / 100).toFixed(2)} of ${(approved / 100).toFixed(2)}).`,
      409
    );
  }
  if (input.paidAmountMinor > outstanding) {
    throw new ClaimDecisionError(
      `Only ${(outstanding / 100).toFixed(2)} is outstanding on this claim.`,
      400
    );
  }

  const totalAfter = alreadyPaid + input.paidAmountMinor;
  // Only the payment that clears the balance settles the claim. A part payment
  // leaves it in SETTLEMENT_PENDING so the queue keeps showing what is owed.
  const settlesInFull = totalAfter >= approved;

  if (settlesInFull) {
    assertTransition("RECORD_PAYMENT", {
      status: claim.status,
      actorKind: "STAFF",
      hasConfirmedPayment: true
    });
  } else if (claim.status !== "SETTLEMENT_PENDING") {
    // Part payments do not move the claim, so the transition rules never run —
    // which means the status has to be checked here instead.
    throw new ClaimDecisionError(
      "A payment can only be recorded once the client has accepted the settlement.",
      409
    );
  }

  const session = await mongoose.startSession();
  let settlement: InstanceType<typeof ClaimSettlement> | null = null;

  try {
    await session.withTransaction(async () => {
      const [created] = await ClaimSettlement.create(
        [
          {
            claimId: claim._id,
            beneficiaryId: beneficiary._id,
            // Pinned so a later beneficiary edit cannot rewrite where this
            // particular payment went.
            beneficiaryVersion: beneficiary.version,
            approvedAmountMinor: claim.approvedAmountMinor ?? 0,
            paidAmountMinor: input.paidAmountMinor,
            transactionReference: input.transactionReference,
            paymentDate: input.paymentDate,
            proofDocumentId: new mongoose.Types.ObjectId(input.proofDocumentId),
            recordedBy: new mongoose.Types.ObjectId(input.userId),
            idempotencyKey: input.idempotencyKey
          }
        ],
        { session }
      );
      if (!created) throw new ClaimDecisionError("The payment could not be recorded.", 500);
      settlement = created;

      // The running total, not this instalment: `paidAmountMinor` is what the
      // client has received altogether.
      claim.paidAmountMinor = totalAfter;
      if (settlesInFull) {
        claim.status = "SETTLED";
        claim.settledAt = now;
      }
      await claim.save({ session });

      await ClaimEvent.create(
        [
          {
            claimId: claim._id,
            type: "PAYMENT_RECORDED",
            fromStatus: "SETTLEMENT_PENDING",
            // A part payment leaves the claim where it is, and the timeline says
            // so rather than claiming a move that did not happen.
            toStatus: settlesInFull ? "SETTLED" : "SETTLEMENT_PENDING",
            actorUserId: new mongoose.Types.ObjectId(input.userId),
            actorKind: "STAFF",
            visibility: "PUBLIC",
            reason: settlesInFull
              ? `Payment of ${(input.paidAmountMinor / 100).toFixed(2)} recorded. Claim settled in full.`
              : `Part payment of ${(input.paidAmountMinor / 100).toFixed(2)} recorded. ${((approved - totalAfter) / 100).toFixed(2)} still outstanding.`,
            metadata: {
              transactionReference: input.transactionReference,
              beneficiaryVersion: beneficiary.version,
              accountNumberMasked: beneficiary.accountNumberMasked
            }
          }
        ],
        { session }
      );
    });
  } finally {
    await session.endSession();
  }

  await AuditLog.create({
    action: "CLAIM_PAYMENT_RECORDED",
    entityType: "CLAIM_SETTLEMENT",
    entityId: settlement!._id,
    performedBy: new mongoose.Types.ObjectId(input.userId),
    performedAt: now,
    metadata: {
      claimId: String(claim._id),
      paidAmountMinor: input.paidAmountMinor,
      transactionReference: input.transactionReference
    }
  });

  // Announced per payment: a client receiving ₹100 today should be told about
  // ₹100, not about the total they are eventually owed.
  await notifyClaimPaid(claim, input.paidAmountMinor, input.transactionReference);

  return {
    settlement: settlement!,
    claim,
    duplicate: false,
    settledInFull: settlesInFull,
    outstandingMinor: Math.max(0, approved - totalAfter)
  };
}

/**
 * Opens or updates a recovery case against a carrier or insurer.
 *
 * Never touches the customer's claim. A client is paid on the merits of what
 * happened to their shipment; whether Swiftline recovers anything afterwards is
 * Swiftline's problem, and letting recovery reach back into a settled claim is
 * exactly the coupling this separation exists to prevent.
 */
export async function upsertRecovery(input: {
  claimId: string;
  userId: string;
  recoveryId?: string;
  partyType: "CARRIER" | "PARTNER" | "INSURER";
  partyName: string;
  externalReference?: string;
  submittedAmountMinor?: number;
  admittedAmountMinor?: number;
  receivedAmountMinor?: number;
  state?: string;
  followUpAt?: Date | null;
  notes?: string;
  filedOutsideCarrierWindow?: boolean;
}) {
  const claim = await Claim.findById(input.claimId).exec();
  if (!claim) throw new ClaimDecisionError("Claim not found.", 404);

  const recovery = input.recoveryId
    ? await ClaimRecovery.findOne({ _id: input.recoveryId, claimId: claim._id }).exec()
    : new ClaimRecovery({ claimId: claim._id });

  if (!recovery) throw new ClaimDecisionError("Recovery case not found.", 404);

  recovery.partyType = input.partyType;
  recovery.partyName = input.partyName;
  if (input.externalReference !== undefined) recovery.externalReference = input.externalReference;
  if (input.submittedAmountMinor !== undefined) recovery.submittedAmountMinor = input.submittedAmountMinor;
  if (input.admittedAmountMinor !== undefined) recovery.admittedAmountMinor = input.admittedAmountMinor;
  if (input.receivedAmountMinor !== undefined) recovery.receivedAmountMinor = input.receivedAmountMinor;
  if (input.followUpAt !== undefined) recovery.followUpAt = input.followUpAt;
  if (input.notes !== undefined) recovery.notes = input.notes;
  if (input.filedOutsideCarrierWindow !== undefined) {
    recovery.filedOutsideCarrierWindow = input.filedOutsideCarrierWindow;
  }
  recovery.handledBy = new mongoose.Types.ObjectId(input.userId);

  // Derived from the money rather than set by hand, so the queue cannot show a
  // case as recovered while its figures say otherwise.
  if (recovery.receivedAmountMinor > 0) {
    recovery.state =
      recovery.receivedAmountMinor >= recovery.admittedAmountMinor ? "RECOVERED" : "PARTIALLY_RECOVERED";
  } else if (recovery.submittedAmountMinor > 0) {
    recovery.state = "SUBMITTED";
  }

  await recovery.save();

  // Mirrored onto the claim for the work queue's recovery filter. It is a
  // reporting field only and never gates anything the client sees.
  claim.recoveryState = recovery.state;
  await claim.save();

  await AuditLog.create({
    action: "CLAIM_RECOVERY_UPDATED",
    entityType: "CLAIM_RECOVERY",
    entityId: recovery._id,
    performedBy: new mongoose.Types.ObjectId(input.userId),
    performedAt: new Date(),
    metadata: { claimId: String(claim._id), state: recovery.state }
  });

  return recovery;
}
