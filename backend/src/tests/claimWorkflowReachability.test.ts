import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  availableTransitions,
  canTransition,
  claimTransitionValues
} from "../services/claims/claimStateMachine.js";
import type { ClaimTransition } from "../services/claims/claimStateMachine.js";
import { claimStatusValues } from "../models/claimTypes.js";
import type { ClaimStatus } from "../models/claimTypes.js";

/**
 * Reachability, as distinct from legality.
 *
 * The transition tests prove the rules are right. They did not prove the rules
 * could be *reached*: for a while every transition behaved correctly and only
 * five had an HTTP route, so a submitted claim could never move to review and
 * therefore could never be decided or paid. These tests exist so that gap
 * cannot reopen silently.
 */

const routesSource = readFileSync(
  path.resolve(process.cwd(), "src/routes/claim.routes.ts"),
  "utf8"
);

/** Route path fragment expected for each transition. */
const routeFor: Record<ClaimTransition, string> = {
  SUBMIT: "/submit",
  REQUEST_DOCUMENTS: "/request-documents",
  COMPLETE_DOCUMENTS: "/complete-documents",
  START_REVIEW: "/start-review",
  REQUEST_INFORMATION: "/request-information",
  RECEIVE_INFORMATION: "/receive-information",
  AWAIT_THIRD_PARTY: "/await-third-party",
  CARRIER_ACKNOWLEDGED: "/carrier-acknowledged",
  THIRD_PARTY_RESPONDED: "/third-party-responded",
  SEND_FOR_APPROVAL: "/send-for-approval",
  DECIDE: "/decisions",
  ACCEPT_SETTLEMENT: "/accept",
  DISPUTE_SETTLEMENT: "/dispute",
  RECORD_PAYMENT: "/settlements",
  SUBMIT_APPEAL: "/appeal",
  CLOSE: "/close",
  REOPEN: "/reopen",
  WITHDRAW: "/withdraw"
};

describe("every transition has a route", () => {
  it("exposes all seventeen", () => {
    const missing = claimTransitionValues.filter(
      (transition) => !routesSource.includes(routeFor[transition])
    );

    assert.deepEqual(
      missing,
      [],
      `transitions with no HTTP route: ${missing.join(", ")}. A transition the state machine allows but nothing can call is a dead end in the workflow.`
    );
  });

  it("still refuses a generic status endpoint", () => {
    // The design rules this out: the difference between DECIDED and SETTLED is
    // money leaving a bank account, not a dropdown.
    assert.ok(!/patch\([^)]*status/i.test(routesSource));
    assert.ok(!routesSource.includes('"/:claimId/status"'));
  });

  it("populates the request user before checking it", () => {
    // `requireAuthenticated` and `requireRole` only inspect `req.user`;
    // `attachUser` is what reads the Bearer token and sets it. A router that
    // mounts the check without the setter rejects every request with a 401,
    // signed in or not- which is exactly what happened, and which a test
    // asserting only that routes exist could never notice.
    const clientSection = routesSource.slice(
      routesSource.indexOf("clientClaimRouter = Router()"),
      routesSource.indexOf("staffClaimRouter = Router()")
    );
    const staffSection = routesSource.slice(routesSource.indexOf("staffClaimRouter = Router()"));

    for (const [name, section] of [
      ["client", clientSection],
      ["staff", staffSection]
    ] as const) {
      assert.ok(
        section.includes("use(attachUser)"),
        `the ${name} claim router never attaches the user, so every request 401s`
      );
    }
  });

  it("refuses HR at the staff router door", () => {
    // The permission matrix grants HR nothing on claims, so it is turned away
    // before reaching a handler rather than by each handler in turn.
    const staffSection = routesSource.slice(routesSource.indexOf("staffClaimRouter = Router()"));
    const gate = staffSection.match(/requireRole\(([^)]*)\)/);

    assert.ok(gate, "the staff claim router has no role gate");
    const roles = gate?.[1] ?? "";
    assert.ok(!roles.includes('"hr"'), "HR must not reach the claims router");
    for (const role of ['"admin"', '"operations"', '"finance"', '"delivery"']) {
      assert.ok(roles.includes(role), `${role} is locked out of claims`);
    }
  });

  it("gives staff a document upload route", () => {
    // Recording a settlement requires a proof document. Without a staff upload
    // route there was no way to produce one, so no claim could ever be paid.
    const staffSection = routesSource.slice(routesSource.indexOf("staffClaimRouter"));
    assert.ok(
      staffSection.includes('post("/:claimId/documents"'),
      "staff cannot upload payment proof, so a settlement can never be recorded"
    );
  });
});

describe("the workflow has no dead ends", () => {
  /** Transitions available from a status, ignoring per-claim preconditions. */
  function movesFrom(status: ClaimStatus, actorKind: "CLIENT" | "STAFF") {
    return claimTransitionValues.filter(
      (transition) =>
        canTransition(transition, {
          status,
          actorKind,
          reason: "A stated reason.",
          decisionOutcome: "FULLY_APPROVED",
          hasConfirmedPayment: true,
          appealCount: 0,
          appealDeadlineAt: new Date(Date.now() + 86_400_000)
        }).allowed
    );
  }

  it("lets every non-terminal status move somewhere", () => {
    for (const status of claimStatusValues) {
      if (status === "WITHDRAWN") continue;
      const moves = [...movesFrom(status, "STAFF"), ...movesFrom(status, "CLIENT")];
      assert.ok(moves.length > 0, `${status} is a dead end`);
    }
  });

  it("can walk a submitted claim all the way to closed", () => {
    // The end-to-end path that was broken: SUBMITTED could not reach review,
    // so nothing downstream of it was reachable either.
    const path: Array<[ClaimStatus, ClaimTransition, "CLIENT" | "STAFF"]> = [
      ["SUBMITTED", "START_REVIEW", "STAFF"],
      ["UNDER_REVIEW", "SEND_FOR_APPROVAL", "STAFF"],
      ["PENDING_APPROVAL", "DECIDE", "STAFF"],
      ["DECIDED", "ACCEPT_SETTLEMENT", "CLIENT"],
      ["PAYMENT_PROCESSING", "RECORD_PAYMENT", "STAFF"],
      ["SETTLED", "CLOSE", "STAFF"]
    ];

    for (const [status, transition, actorKind] of path) {
      const result = canTransition(transition, {
        status,
        actorKind,
        reason: "A stated reason.",
        decisionOutcome: "FULLY_APPROVED",
        hasConfirmedPayment: true
      });
      assert.equal(result.allowed, true, `${status} -> ${transition} is blocked`);
      assert.ok(routesSource.includes(routeFor[transition]), `${transition} has no route`);
    }
  });

  it("can walk a documents-required claim back into review", () => {
    for (const [status, transition] of [
      ["SUBMITTED", "REQUEST_DOCUMENTS"],
      ["DOCUMENTS_PENDING", "COMPLETE_DOCUMENTS"]
    ] as Array<[ClaimStatus, ClaimTransition]>) {
      const result = canTransition(transition, {
        status,
        actorKind: "STAFF",
        reason: "Evidence outstanding."
      });
      assert.equal(result.allowed, true, `${status} -> ${transition} is blocked`);
    }
  });

  it("can return a stalled claim to review from either waiting state", () => {
    for (const status of ["NEEDS_INFORMATION", "SUBMITTED_TO_CARRIER"] as ClaimStatus[]) {
      const moves = movesFrom(status, "STAFF");
      assert.ok(
        moves.includes("START_REVIEW") ||
          moves.includes("RECEIVE_INFORMATION") ||
          moves.includes("THIRD_PARTY_RESPONDED"),
        `${status} cannot get back to review`
      );
    }
  });

  it("offers the decision control before an outcome has been chosen", () => {
    // The bug this exists for: DECIDE requires a decision outcome, which does
    // not exist until a reviewer picks one- and the reviewer picks one in the
    // panel that is only rendered when DECIDE is offered. Evaluating the command
    // payload while deciding what to *offer* made the panel unreachable, so a
    // claim could reach PENDING_APPROVAL and never be decided.
    for (const status of ["UNDER_REVIEW", "PENDING_APPROVAL"] as ClaimStatus[]) {
      const offered = availableTransitions({
        status,
        actorKind: "STAFF",
        // Exactly what a controller has for an undecided claim: nothing typed.
        decisionOutcome: null
      });

      assert.ok(
        offered.includes("DECIDE"),
        `a claim in ${status} does not offer DECIDE, so it can never be decided`
      );
    }
  });

  it("still refuses to execute a decision with no outcome", () => {
    // The other half: relaxing availability must not relax the command itself.
    const result = canTransition("DECIDE", {
      status: "PENDING_APPROVAL",
      actorKind: "STAFF",
      reason: "A stated reason.",
      decisionOutcome: null
    });

    assert.equal(result.allowed, false);
    if (!result.allowed) assert.match(result.reason, /outcome/i);
  });

  it("keeps state-dependent rules out of the availability answer", () => {
    // Availability sets aside "you have not filled this in yet", not "this claim
    // is in no position for that". A spent appeal and an unpaid settlement must
    // still hide their controls.
    const spentAppeal = availableTransitions({
      status: "DECIDED",
      actorKind: "CLIENT",
      decisionOutcome: "REJECTED",
      appealDeadlineAt: new Date(Date.now() + 86_400_000),
      appealCount: 1
    });
    assert.ok(!spentAppeal.includes("SUBMIT_APPEAL"), "a second appeal was offered");

    const unpaid = availableTransitions({
      status: "PAYMENT_PROCESSING",
      actorKind: "STAFF",
      hasConfirmedPayment: false
    });
    assert.ok(!unpaid.includes("RECORD_PAYMENT"), "settling was offered with no payment");
  });

  it("leaves a closed claim reopenable and a withdrawn claim final", () => {
    assert.deepEqual(movesFrom("CLOSED", "STAFF"), ["REOPEN"]);
    assert.deepEqual(movesFrom("WITHDRAWN", "STAFF"), []);
  });
});
