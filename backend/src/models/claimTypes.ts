/**
 * Shared vocabulary for the claims domain.
 *
 * Lifecycle status is kept separate from decision, acceptance, appeal, and
 * recovery state. Folding them into one enum was considered and rejected: a
 * claim can be simultaneously decided, accepted, awaiting payment, and chasing a
 * carrier, and a single field would need a value for every combination.
 */

/** What the client says went wrong. Drives the required-evidence checklist. */
export const claimCategoryValues = [
  "TOTAL_LOSS",
  "PARTIAL_LOSS",
  "SHORTAGE",
  "PHYSICAL_DAMAGE",
  "THEFT_OR_TAMPERING",
  "DELAY_CAUSING_PHYSICAL_LOSS"
] as const;

/**
 * Where the claim sits in its handling pipeline.
 *
 * Ordinary delay, tracking enquiries, invoice disputes, cancellations, returns,
 * and customs disputes are deliberately absent — those belong to Help Desk, not
 * to compensation.
 */
export const claimStatusValues = [
  /**
   * Being filled in, before the client has submitted it. Never shown as one of
   * the published statuses because a claim in this state does not exist yet as
   * far as Swiftline is concerned.
   */
  "DRAFT",
  "SUBMITTED",
  "DOCUMENTS_PENDING",
  "UNDER_REVIEW",
  /**
   * Waiting on an answer from the client. Distinct from DOCUMENTS_PENDING: one
   * is chasing a file, the other is chasing a question, and the reminders and
   * SLA pauses differ.
   */
  "NEEDS_INFORMATION",
  /**
   * The two halves of "with the carrier". Split because a client chasing a claim
   * wants to know whether it has actually reached the carrier yet or is merely
   * queued to be sent — "submitted" and "being looked at" are different answers.
   */
  "SUBMITTED_TO_CARRIER",
  "CARRIER_REVIEWING",
  /** Swiftline's own internal sign-off before a decision is issued. */
  "PENDING_APPROVAL",
  /**
   * A decision exists. Whether it reads as Approved or Rejected comes from the
   * decision outcome, not from a second status — see `claimStatusLabels`.
   */
  "DECIDED",
  "PAYMENT_PROCESSING",
  "SETTLED",
  "CLOSED",
  "WITHDRAWN"
] as const;

/**
 * Whether the evidence pack is complete.
 *
 * A client may file a preliminary notice before every document is ready — the
 * filing deadline is short and gathering invoices is slow, so blocking the
 * notice on complete evidence would cost clients valid claims.
 */
export const claimSubmissionStageValues = ["PRELIMINARY", "FORMAL_COMPLETE"] as const;

export const claimDecisionOutcomeValues = [
  "FULLY_APPROVED",
  "PARTIALLY_APPROVED",
  "REJECTED"
] as const;

export const claimAcceptanceStateValues = [
  "NOT_REQUIRED",
  "PENDING",
  "ACCEPTED",
  "DISPUTED"
] as const;

export const claimAppealStateValues = ["NONE", "SUBMITTED", "UNDER_REVIEW", "RESOLVED"] as const;

/**
 * Recovery from the carrier or Swiftline's own insurer. Tracked separately and
 * never allowed to delay the customer: the client is paid on the merits of their
 * claim, and whether Swiftline recovers anything is Swiftline's problem.
 */
export const claimRecoveryStateValues = [
  "NOT_STARTED",
  "SUBMITTED",
  "PARTIALLY_RECOVERED",
  "RECOVERED",
  "CLOSED_UNRECOVERED"
] as const;

export type ClaimCategory = (typeof claimCategoryValues)[number];
export type ClaimStatus = (typeof claimStatusValues)[number];
export type ClaimSubmissionStage = (typeof claimSubmissionStageValues)[number];
export type ClaimDecisionOutcome = (typeof claimDecisionOutcomeValues)[number];
export type ClaimAcceptanceState = (typeof claimAcceptanceStateValues)[number];
export type ClaimAppealState = (typeof claimAppealStateValues)[number];
export type ClaimRecoveryState = (typeof claimRecoveryStateValues)[number];

/**
 * Statuses in which a claim still occupies its shipment.
 *
 * A partial unique index built on this list is what enforces "one active claim
 * per shipment". `DECIDED` is included on purpose: a rejected claim inside its
 * appeal window must block a re-file, or clients would simply file again instead
 * of appealing and the appeal limit would mean nothing. The claim leaves this
 * set when it is closed, withdrawn, or its appeal window expires.
 */
export const activeClaimStatusValues = [
  "DRAFT",
  "SUBMITTED",
  "DOCUMENTS_PENDING",
  "UNDER_REVIEW",
  "NEEDS_INFORMATION",
  "SUBMITTED_TO_CARRIER",
  "CARRIER_REVIEWING",
  "PENDING_APPROVAL",
  "DECIDED",
  "PAYMENT_PROCESSING"
] as const;

/** Statuses a client may still withdraw from. Past a decision it is too late. */
export const withdrawableClaimStatusValues = [
  "DRAFT",
  "SUBMITTED",
  "DOCUMENTS_PENDING",
  "UNDER_REVIEW",
  "NEEDS_INFORMATION",
  "SUBMITTED_TO_CARRIER",
  "CARRIER_REVIEWING",
  "PENDING_APPROVAL"
] as const;

/** Terminal statuses. Nothing transitions out of these. */
export const terminalClaimStatusValues = ["CLOSED", "WITHDRAWN"] as const;

/**
 * What each status is called wherever a person reads it.
 *
 * The stored value and the label are kept apart on purpose. `DECIDED` is one
 * state in the machine but reads as two different words to a client depending on
 * the decision outcome, and folding that into the enum would mean two statuses
 * that can never be reached by two different transitions — see `claimStatusLabel`.
 */
export const claimStatusLabels: Record<ClaimStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  DOCUMENTS_PENDING: "Documents Pending",
  UNDER_REVIEW: "Under Review",
  NEEDS_INFORMATION: "Information Requested",
  SUBMITTED_TO_CARRIER: "Submitted to Carrier",
  CARRIER_REVIEWING: "Carrier Reviewing",
  PENDING_APPROVAL: "Pending Approval",
  DECIDED: "Decided",
  PAYMENT_PROCESSING: "Payment Processing",
  SETTLED: "Settled",
  CLOSED: "Closed",
  WITHDRAWN: "Withdrawn"
};

/**
 * The status as a person should read it.
 *
 * A decided claim reads as "Approved" or "Rejected" rather than "Decided": the
 * outcome is the part anyone actually wants, and a partial approval is still an
 * approval as far as the headline goes — the amount tells the rest of the story.
 */
export function claimStatusLabel(
  status: ClaimStatus,
  decisionOutcome?: ClaimDecisionOutcome | null
) {
  if (status === "DECIDED" && decisionOutcome) {
    return decisionOutcome === "REJECTED" ? "Rejected" : "Approved";
  }

  return claimStatusLabels[status];
}

export function isActiveClaimStatus(status: ClaimStatus) {
  return (activeClaimStatusValues as readonly string[]).includes(status);
}

export function isTerminalClaimStatus(status: ClaimStatus) {
  return (terminalClaimStatusValues as readonly string[]).includes(status);
}

/**
 * Filing deadlines, in days.
 *
 * These are the defaults seeded into `ClaimPolicyRule`. They are not hard-coded
 * into the deadline calculation — a rule record can override them per carrier,
 * route, or contract, which is the whole reason that model exists.
 */
export const defaultClaimDeadlines = {
  /**
   * For a shipment that never arrived. Generous because a slow international
   * route can legitimately still be moving at day 25, and a window that closed
   * mid-transit would reject genuine total-loss claims.
   */
  bookingToClaimDays: 35,
  /**
   * For damage, shortage, or tampering. Short because the client had to open the
   * parcel to discover it, so the clock starts from a known inspection point.
   */
  deliveryToClaimDays: 7,
  /** How long after a decision a client may appeal. */
  appealDays: 15,
  /** How long a client has to answer a document request before staff chase it. */
  documentResponseDays: 7
} as const;

/**
 * Once a shipment is delivered the delivery clock governs and the booking clock
 * stops applying — they are alternatives, not a pair to satisfy at once.
 * Applying both would expire a claim on a parcel delivered on day 34 before the
 * client had any chance to open it.
 */
export function claimFilingDeadline(input: {
  bookedAt: Date;
  deliveredAt?: Date | null;
  bookingToClaimDays?: number;
  deliveryToClaimDays?: number;
}) {
  const addDays = (from: Date, days: number) =>
    new Date(from.getTime() + days * 24 * 60 * 60 * 1000);

  if (input.deliveredAt) {
    return {
      basis: "DELIVERY" as const,
      deadline: addDays(
        input.deliveredAt,
        input.deliveryToClaimDays ?? defaultClaimDeadlines.deliveryToClaimDays
      )
    };
  }

  return {
    basis: "BOOKING" as const,
    deadline: addDays(
      input.bookedAt,
      input.bookingToClaimDays ?? defaultClaimDeadlines.bookingToClaimDays
    )
  };
}

/** Amounts are integer paise, matching the credit and prepaid ledgers. */
export const claimCurrencyValues = ["INR"] as const;
export type ClaimCurrency = (typeof claimCurrencyValues)[number];
