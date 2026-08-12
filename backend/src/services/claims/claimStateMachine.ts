import { isTerminalClaimStatus } from "../../models/claimTypes.js";
import type { ClaimAcceptanceState, ClaimDecisionOutcome, ClaimStatus } from "../../models/claimTypes.js";

/**
 * Every legal claim transition, in one table.
 *
 * There is deliberately no generic "set status" endpoint. Each transition is a
 * named command with its own preconditions, because the difference between
 * DECIDED and SETTLED is a payment leaving a bank account — not a dropdown.
 *
 * Written as pure functions with no database access so the rules can be tested
 * exhaustively without fixtures, and so a caller cannot accidentally bypass them
 * by constructing a document directly.
 */

export const claimTransitionValues = [
  "SUBMIT",
  "REQUEST_DOCUMENTS",
  "COMPLETE_DOCUMENTS",
  "START_REVIEW",
  "REQUEST_INFORMATION",
  "RECEIVE_INFORMATION",
  "AWAIT_THIRD_PARTY",
  "CARRIER_ACKNOWLEDGED",
  "THIRD_PARTY_RESPONDED",
  "SEND_FOR_APPROVAL",
  "DECIDE",
  "ACCEPT_SETTLEMENT",
  "DISPUTE_SETTLEMENT",
  "RECORD_PAYMENT",
  "SUBMIT_APPEAL",
  "CLOSE",
  "REOPEN",
  "WITHDRAW"
] as const;

export type ClaimTransition = (typeof claimTransitionValues)[number];

/** Who is permitted to trigger a transition at all, before branch scoping. */
export type ClaimActorKind = "CLIENT" | "STAFF";

interface TransitionRule {
  from: readonly ClaimStatus[];
  to: ClaimStatus;
  actor: ClaimActorKind | "EITHER";
  /** Whether the timeline entry must carry a reason. */
  requiresReason: boolean;
}

const transitions: Record<ClaimTransition, TransitionRule> = {
  /** Preliminary notice. Allocates the claim number and freezes the snapshot. */
  SUBMIT: { from: ["DRAFT"], to: "SUBMITTED", actor: "CLIENT", requiresReason: false },

  REQUEST_DOCUMENTS: {
    from: ["SUBMITTED", "UNDER_REVIEW"],
    to: "DOCUMENTS_PENDING",
    actor: "STAFF",
    requiresReason: true
  },

  /**
   * The client's evidence pack is complete. Reachable straight from SUBMITTED
   * because a client who uploads everything at once should never be routed
   * through DOCUMENTS_PENDING just to leave it again.
   */
  COMPLETE_DOCUMENTS: {
    from: ["SUBMITTED", "DOCUMENTS_PENDING"],
    to: "UNDER_REVIEW",
    actor: "EITHER",
    requiresReason: false
  },

  START_REVIEW: {
    from: [
      "SUBMITTED",
      "DOCUMENTS_PENDING",
      "NEEDS_INFORMATION",
      "SUBMITTED_TO_CARRIER",
      "CARRIER_REVIEWING"
    ],
    to: "UNDER_REVIEW",
    actor: "STAFF",
    requiresReason: false
  },

  REQUEST_INFORMATION: {
    from: ["UNDER_REVIEW", "PENDING_APPROVAL"],
    to: "NEEDS_INFORMATION",
    actor: "STAFF",
    requiresReason: true
  },

  RECEIVE_INFORMATION: {
    from: ["NEEDS_INFORMATION"],
    to: "UNDER_REVIEW",
    actor: "EITHER",
    requiresReason: false
  },

  /** Swiftline has passed the claim to the carrier and is waiting for pick-up. */
  AWAIT_THIRD_PARTY: {
    from: ["UNDER_REVIEW", "PENDING_APPROVAL"],
    to: "SUBMITTED_TO_CARRIER",
    actor: "STAFF",
    requiresReason: true
  },

  /**
   * The carrier has picked the claim up and started looking at it. A separate
   * step because "sent" and "being reviewed" are the two things a client chasing
   * a claim actually wants told apart.
   */
  CARRIER_ACKNOWLEDGED: {
    from: ["SUBMITTED_TO_CARRIER"],
    to: "CARRIER_REVIEWING",
    actor: "STAFF",
    requiresReason: false
  },

  /**
   * The carrier has come back. Allowed from either carrier state, because a
   * carrier that answers immediately never passes through CARRIER_REVIEWING and
   * must not be stranded in SUBMITTED_TO_CARRIER for it.
   */
  THIRD_PARTY_RESPONDED: {
    from: ["SUBMITTED_TO_CARRIER", "CARRIER_REVIEWING"],
    to: "UNDER_REVIEW",
    actor: "STAFF",
    requiresReason: false
  },

  SEND_FOR_APPROVAL: {
    from: ["UNDER_REVIEW"],
    to: "PENDING_APPROVAL",
    actor: "STAFF",
    requiresReason: false
  },

  /** Full approval, partial approval, or rejection. Always carries a reason. */
  DECIDE: {
    from: ["UNDER_REVIEW", "PENDING_APPROVAL"],
    to: "DECIDED",
    actor: "STAFF",
    requiresReason: true
  },

  ACCEPT_SETTLEMENT: {
    from: ["DECIDED"],
    to: "PAYMENT_PROCESSING",
    actor: "CLIENT",
    requiresReason: false
  },

  DISPUTE_SETTLEMENT: { from: ["DECIDED"], to: "DECIDED", actor: "CLIENT", requiresReason: true },

  /** Only a confirmed bank payment reaches SETTLED. Approval alone does not. */
  RECORD_PAYMENT: {
    from: ["PAYMENT_PROCESSING"],
    to: "SETTLED",
    actor: "STAFF",
    requiresReason: false
  },

  /** An appeal reopens review from a decision, within the appeal window. */
  SUBMIT_APPEAL: { from: ["DECIDED"], to: "UNDER_REVIEW", actor: "CLIENT", requiresReason: true },

  CLOSE: {
    from: ["DECIDED", "SETTLED"],
    to: "CLOSED",
    actor: "STAFF",
    requiresReason: false
  },

  REOPEN: { from: ["CLOSED"], to: "UNDER_REVIEW", actor: "STAFF", requiresReason: true },

  WITHDRAW: {
    from: [
      "DRAFT",
      "SUBMITTED",
      "DOCUMENTS_PENDING",
      "UNDER_REVIEW",
      "NEEDS_INFORMATION",
      "SUBMITTED_TO_CARRIER",
      "CARRIER_REVIEWING",
      "PENDING_APPROVAL"
    ],
    to: "WITHDRAWN",
    actor: "EITHER",
    requiresReason: true
  }
};

export interface TransitionContext {
  status: ClaimStatus;
  actorKind: ClaimActorKind;
  reason?: string | null;
  /** Set when the transition is DECIDE. */
  decisionOutcome?: ClaimDecisionOutcome | null;
  acceptanceState?: ClaimAcceptanceState;
  /** Appeal window end, checked for SUBMIT_APPEAL. */
  appealDeadlineAt?: Date | null;
  /** How many appeals the client has already used. One is the limit. */
  appealCount?: number;
  /** Whether a payment record exists. Checked for RECORD_PAYMENT. */
  hasConfirmedPayment?: boolean;
  now?: Date;
}

export type TransitionCheck =
  | { allowed: true; to: ClaimStatus }
  | { allowed: false; reason: string };

/**
 * Decides whether one transition may run.
 *
 * Returns a reason rather than throwing so callers can surface it to the user —
 * "this claim has already been appealed once" is far more useful than a 409.
 */
export function canTransition(
  transition: ClaimTransition,
  context: TransitionContext,
  options: { forAvailability?: boolean } = {}
): TransitionCheck {
  /**
   * Two different questions share this function, and they need different rules.
   *
   * *Can this move be made from here?* depends on the claim — its status, the
   * actor, whether an appeal window is still open. *Is this command valid?*
   * additionally depends on what the caller typed: a reason, a decision outcome.
   *
   * Asking the second question when offering a button is wrong, because the
   * caller has not typed anything yet. A decision has no outcome until a
   * reviewer picks one, so requiring an outcome to *offer* the decision control
   * means it can never be offered — which is exactly what happened.
   */
  const checkCommandPayload = !options.forAvailability;
  const rule = transitions[transition];
  if (!rule) return { allowed: false, reason: "Unknown claim transition." };

  if (isTerminalClaimStatus(context.status) && transition !== "REOPEN") {
    return { allowed: false, reason: "This claim is closed and cannot be changed." };
  }

  if (!rule.from.includes(context.status)) {
    return {
      allowed: false,
      reason: `A claim in ${context.status.replace(/_/g, " ").toLowerCase()} cannot take this action.`
    };
  }

  if (rule.actor !== "EITHER" && rule.actor !== context.actorKind) {
    return { allowed: false, reason: "This action is not available to you." };
  }

  if (checkCommandPayload && rule.requiresReason && !context.reason?.trim()) {
    return { allowed: false, reason: "A reason is required for this action." };
  }

  if (checkCommandPayload && transition === "DECIDE" && !context.decisionOutcome) {
    return { allowed: false, reason: "A decision outcome is required." };
  }

  if (transition === "ACCEPT_SETTLEMENT" && context.decisionOutcome === "REJECTED") {
    return { allowed: false, reason: "A rejected claim has no settlement to accept." };
  }

  if (transition === "RECORD_PAYMENT" && !context.hasConfirmedPayment) {
    return {
      allowed: false,
      reason: "Record the bank payment with its reference and proof before settling."
    };
  }

  if (transition === "SUBMIT_APPEAL") {
    const now = context.now ?? new Date();
    if ((context.appealCount ?? 0) >= 1) {
      return { allowed: false, reason: "This claim has already been appealed once." };
    }
    if (!context.appealDeadlineAt) {
      return { allowed: false, reason: "This claim has no appeal window." };
    }
    if (now > context.appealDeadlineAt) {
      return { allowed: false, reason: "The 15-day appeal window for this claim has closed." };
    }
  }

  return { allowed: true, to: rule.to };
}

/** Throws with the caller-facing reason. For command handlers that cannot proceed. */
export function assertTransition(transition: ClaimTransition, context: TransitionContext) {
  const result = canTransition(transition, context);
  if (!result.allowed) {
    const error = new Error(result.reason) as Error & { statusCode?: number };
    error.statusCode = 409;
    throw error;
  }
  return result.to;
}

/**
 * Every transition currently available. Drives which controls a UI renders.
 *
 * Evaluated without the command payload: a caller has typed no reason and picked
 * no outcome at the point a button is drawn. The state-dependent rules still
 * apply, so a closed appeal window or an unpaid settlement still hides its
 * control — only "you have not filled this in yet" is set aside.
 */
export function availableTransitions(context: TransitionContext): ClaimTransition[] {
  return claimTransitionValues.filter(
    (transition) => canTransition(transition, context, { forAvailability: true }).allowed
  );
}

export function transitionRequiresReason(transition: ClaimTransition) {
  return transitions[transition]?.requiresReason ?? false;
}
