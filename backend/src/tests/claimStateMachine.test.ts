import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertTransition,
  availableTransitions,
  canTransition,
  claimTransitionValues
} from "../services/claims/claimStateMachine.js";
import type { ClaimTransition } from "../services/claims/claimStateMachine.js";
import {
  claimFilingDeadline,
  claimStatusValues,
  defaultClaimDeadlines,
  isActiveClaimStatus
} from "../models/claimTypes.js";
import type { ClaimStatus } from "../models/claimTypes.js";

const staff = { actorKind: "STAFF" as const };
const client = { actorKind: "CLIENT" as const };
const reason = "Documented reason.";

describe("claim state machine", () => {
  it("walks the approved happy path to settlement", () => {
    const steps: Array<[ClaimStatus, ClaimTransition, ClaimStatus]> = [
      ["DRAFT", "SUBMIT", "SUBMITTED"],
      ["SUBMITTED", "REQUEST_DOCUMENTS", "DOCUMENTS_PENDING"],
      ["DOCUMENTS_PENDING", "COMPLETE_DOCUMENTS", "UNDER_REVIEW"],
      ["UNDER_REVIEW", "SEND_FOR_APPROVAL", "PENDING_APPROVAL"],
      ["PENDING_APPROVAL", "DECIDE", "DECIDED"],
      ["DECIDED", "ACCEPT_SETTLEMENT", "PAYMENT_PROCESSING"],
      ["PAYMENT_PROCESSING", "RECORD_PAYMENT", "SETTLED"],
      ["SETTLED", "CLOSE", "CLOSED"]
    ];

    for (const [from, transition, expected] of steps) {
      const result = canTransition(transition, {
        status: from,
        actorKind: transition === "SUBMIT" || transition === "ACCEPT_SETTLEMENT" ? "CLIENT" : "STAFF",
        reason,
        decisionOutcome: "FULLY_APPROVED",
        hasConfirmedPayment: true
      });
      assert.equal(result.allowed, true, `${from} -> ${transition} was refused`);
      if (result.allowed) assert.equal(result.to, expected);
    }
  });

  it("lets a complete preliminary claim skip DOCUMENTS_PENDING", () => {
    // A client who uploads everything at once should not be routed through a
    // status that exists only to ask for what they already sent.
    const result = canTransition("COMPLETE_DOCUMENTS", { status: "SUBMITTED", ...client });
    assert.equal(result.allowed, true);
    if (result.allowed) assert.equal(result.to, "UNDER_REVIEW");
  });

  it("refuses to settle without a confirmed payment", () => {
    const result = canTransition("RECORD_PAYMENT", {
      status: "PAYMENT_PROCESSING",
      ...staff,
      hasConfirmedPayment: false
    });
    assert.equal(result.allowed, false);
    if (!result.allowed) assert.match(result.reason, /bank payment/i);
  });

  it("refuses a decision without an outcome", () => {
    const result = canTransition("DECIDE", { status: "UNDER_REVIEW", ...staff, reason });
    assert.equal(result.allowed, false);
  });

  it("refuses transitions that require a reason when none is given", () => {
    for (const transition of ["REQUEST_DOCUMENTS", "REQUEST_INFORMATION", "AWAIT_THIRD_PARTY"] as const) {
      const result = canTransition(transition, { status: "UNDER_REVIEW", ...staff, reason: "  " });
      assert.equal(result.allowed, false, `${transition} accepted a blank reason`);
    }
  });

  it("does not let a client run staff-only transitions", () => {
    for (const transition of ["DECIDE", "REQUEST_INFORMATION", "RECORD_PAYMENT", "CLOSE"] as const) {
      const result = canTransition(transition, {
        status: transition === "RECORD_PAYMENT" ? "PAYMENT_PROCESSING" : "UNDER_REVIEW",
        ...client,
        reason,
        decisionOutcome: "FULLY_APPROVED",
        hasConfirmedPayment: true
      });
      assert.equal(result.allowed, false, `a client was allowed to ${transition}`);
    }
  });

  it("does not let staff accept a settlement for the client", () => {
    const result = canTransition("ACCEPT_SETTLEMENT", {
      status: "DECIDED",
      ...staff,
      decisionOutcome: "FULLY_APPROVED"
    });
    assert.equal(result.allowed, false);
  });

  it("has no settlement to accept on a rejected claim", () => {
    const result = canTransition("ACCEPT_SETTLEMENT", {
      status: "DECIDED",
      ...client,
      decisionOutcome: "REJECTED"
    });
    assert.equal(result.allowed, false);
  });

  it("freezes terminal claims except through reopen", () => {
    for (const status of ["CLOSED", "WITHDRAWN"] as const) {
      for (const transition of claimTransitionValues) {
        const result = canTransition(transition, {
          status,
          ...staff,
          reason,
          decisionOutcome: "FULLY_APPROVED",
          hasConfirmedPayment: true
        });
        const expected = transition === "REOPEN" && status === "CLOSED";
        assert.equal(result.allowed, expected, `${status} -> ${transition}`);
      }
    }
  });

  describe("appeals", () => {
    const open = {
      status: "DECIDED" as const,
      ...client,
      reason,
      decisionOutcome: "REJECTED" as const,
      appealDeadlineAt: new Date("2026-09-01T00:00:00Z"),
      now: new Date("2026-08-20T00:00:00Z")
    };

    it("allows one appeal inside the window", () => {
      const result = canTransition("SUBMIT_APPEAL", { ...open, appealCount: 0 });
      assert.equal(result.allowed, true);
      if (result.allowed) assert.equal(result.to, "UNDER_REVIEW");
    });

    it("allows only one", () => {
      const result = canTransition("SUBMIT_APPEAL", { ...open, appealCount: 1 });
      assert.equal(result.allowed, false);
      if (!result.allowed) assert.match(result.reason, /already been appealed/i);
    });

    it("refuses one filed after the window closes", () => {
      const result = canTransition("SUBMIT_APPEAL", {
        ...open,
        appealCount: 0,
        now: new Date("2026-09-02T00:00:00Z")
      });
      assert.equal(result.allowed, false);
      if (!result.allowed) assert.match(result.reason, /appeal window/i);
    });

    it("refuses when no window was ever set", () => {
      const result = canTransition("SUBMIT_APPEAL", {
        ...open,
        appealCount: 0,
        appealDeadlineAt: null
      });
      assert.equal(result.allowed, false);
    });
  });

  it("offers no transitions at all from a withdrawn claim", () => {
    assert.deepEqual(availableTransitions({ status: "WITHDRAWN", ...staff, reason }), []);
  });

  it("throws a 409 with the caller-facing reason", () => {
    assert.throws(
      () => assertTransition("RECORD_PAYMENT", { status: "DRAFT", ...staff }),
      (error: Error & { statusCode?: number }) => error.statusCode === 409
    );
  });

  it("keeps the active-status list consistent with the status enum", () => {
    // Guards against a status being added to the enum but forgotten in the
    // active list, which would silently let a second claim onto a shipment.
    for (const status of claimStatusValues) {
      const expectedInactive = ["CLOSED", "WITHDRAWN", "SETTLED"].includes(status);
      assert.equal(isActiveClaimStatus(status), !expectedInactive, `${status} activeness`);
    }
  });
});

describe("filing deadlines", () => {
  const bookedAt = new Date("2026-08-01T00:00:00Z");

  it("measures from booking while the shipment is undelivered", () => {
    const result = claimFilingDeadline({ bookedAt, deliveredAt: null });
    assert.equal(result.basis, "BOOKING");
    assert.equal(
      result.deadline.toISOString(),
      new Date("2026-09-05T00:00:00Z").toISOString(),
      "35 days from booking"
    );
  });

  it("switches to the delivery clock once delivered", () => {
    const result = claimFilingDeadline({
      bookedAt,
      deliveredAt: new Date("2026-08-10T00:00:00Z")
    });
    assert.equal(result.basis, "DELIVERY");
    assert.equal(result.deadline.toISOString(), new Date("2026-08-17T00:00:00Z").toISOString());
  });

  it("does not expire a slow shipment delivered near the booking deadline", () => {
    // The case that makes these alternatives rather than a pair: a parcel
    // delivered on day 34 would already be out of time if both applied.
    const deliveredAt = new Date("2026-09-04T00:00:00Z");
    const result = claimFilingDeadline({ bookedAt, deliveredAt });

    assert.equal(result.basis, "DELIVERY");
    assert.ok(
      result.deadline > new Date("2026-09-05T00:00:00Z"),
      "delivery window must outlive the booking window"
    );
  });

  it("honours a policy rule that overrides the defaults", () => {
    const result = claimFilingDeadline({ bookedAt, deliveredAt: null, bookingToClaimDays: 60 });
    assert.equal(result.deadline.toISOString(), new Date("2026-09-30T00:00:00Z").toISOString());
  });

  it("uses the agreed default windows", () => {
    assert.equal(defaultClaimDeadlines.bookingToClaimDays, 35);
    assert.equal(defaultClaimDeadlines.deliveryToClaimDays, 7);
    assert.equal(defaultClaimDeadlines.appealDays, 15);
  });
});
