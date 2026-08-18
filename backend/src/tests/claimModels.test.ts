import assert from "node:assert/strict";
import mongoose from "mongoose";
import { describe, it } from "node:test";
import { Claim } from "../models/claim.model.js";
import { ClaimDecision } from "../models/claimDecision.model.js";
import { ClaimRecovery, swiftlineExposureMinor } from "../models/claimRecovery.model.js";
import { ClaimSettlement } from "../models/claimSettlement.model.js";
import { claimFinancialYear } from "../services/claims/claimNumber.service.js";
import { computeAppealDeadline, computeClaimDeadlines } from "../services/claims/claimPolicy.service.js";
import type { IClaimPolicyRule } from "../models/claimPolicyRule.model.js";

/**
 * Validation is driven through `validate()` rather than `validateSync()`.
 *
 * The cross-field rules live in `pre("validate")` hooks, and document middleware
 * does not run on the sync path- a `validateSync()` harness would report every
 * one of these models as valid and quietly prove nothing. `validate()` is also
 * what `save()` runs, so this exercises the real path without a connection.
 */

const objectId = () => new mongoose.Types.ObjectId();

async function errorsOf(document: mongoose.Document) {
  try {
    await document.validate();
    return [] as string[];
  } catch (error) {
    if (error instanceof mongoose.Error.ValidationError) return Object.keys(error.errors);
    throw error;
  }
}

describe("claim amount rules", () => {
  const base = {
    businessAccountId: objectId(),
    branchId: objectId(),
    shipmentDraftId: objectId(),
    claimantUserId: objectId(),
    category: "PHYSICAL_DAMAGE" as const,
    requestedAmountMinor: 50_000_00
  };

  it("refuses an approved amount above the requested amount", async () => {
    const claim = new Claim({ ...base, approvedAmountMinor: 60_000_00 });
    assert.ok((await errorsOf(claim)).includes("approvedAmountMinor"));
  });

  it("accepts an approved amount at or below the requested amount", async () => {
    for (const approved of [50_000_00, 25_000_00, 0]) {
      const claim = new Claim({ ...base, approvedAmountMinor: approved });
      assert.ok(!(await errorsOf(claim)).includes("approvedAmountMinor"), `rejected ${approved}`);
    }
  });

  it("refuses a paid amount above the approved amount", async () => {
    const claim = new Claim({ ...base, approvedAmountMinor: 20_000_00, paidAmountMinor: 30_000_00 });
    assert.ok((await errorsOf(claim)).includes("paidAmountMinor"));
  });

  it("refuses fractional amounts", async () => {
    const claim = new Claim({ ...base, requestedAmountMinor: 1234.5 });
    assert.ok((await errorsOf(claim)).includes("requestedAmountMinor"));
  });

  it("marks a claim active while it occupies its shipment", async () => {
    const claim = new Claim({ ...base, status: "UNDER_REVIEW" });
    await claim.validate().catch(() => {});
    assert.equal(String(claim.activeShipmentDraftId), String(base.shipmentDraftId));
  });

  it("keeps a decided claim active so a re-file cannot bypass the appeal", async () => {
    const claim = new Claim({ ...base, status: "DECIDED" });
    await claim.validate().catch(() => {});
    assert.ok(claim.activeShipmentDraftId, "a decided claim must still hold its shipment");
  });

  it("releases the shipment once closed or withdrawn", async () => {
    for (const status of ["CLOSED", "WITHDRAWN", "SETTLED"] as const) {
      const claim = new Claim({ ...base, status });
      await claim.validate().catch(() => {});
      assert.equal(claim.activeShipmentDraftId, null, `${status} still held the shipment`);
    }
  });

  it("refuses to claim more units than were shipped", async () => {
    const claim = new Claim({
      ...base,
      affectedItems: [
        {
          parcelSequence: 1,
          itemIndex: 0,
          quantityShipped: 5,
          quantityAffected: 9,
          declaredUnitValueMinor: 1000_00
        }
      ]
    });
    assert.ok(JSON.stringify(await errorsOf(claim)).includes("quantityAffected"));
  });
});

describe("decision consistency", () => {
  const base = {
    claimId: objectId(),
    revision: 1,
    requestedAmountMinor: 100_000_00,
    declaredValueMinor: 80_000_00,
    reasonCode: "PARTIAL_EVIDENCE",
    customerExplanation: "Explained to the customer in full.",
    decidedBy: objectId()
  };

  it("requires a full approval to match the requested amount", async () => {
    const wrong = new ClaimDecision({ ...base, outcome: "FULLY_APPROVED", approvedAmountMinor: 90_000_00 });
    assert.ok((await errorsOf(wrong)).includes("approvedAmountMinor"));

    const right = new ClaimDecision({ ...base, outcome: "FULLY_APPROVED", approvedAmountMinor: 100_000_00 });
    assert.ok(!(await errorsOf(right)).includes("approvedAmountMinor"));
  });

  it("requires a rejection to approve zero", async () => {
    const wrong = new ClaimDecision({ ...base, outcome: "REJECTED", approvedAmountMinor: 1 });
    assert.ok((await errorsOf(wrong)).includes("approvedAmountMinor"));
  });

  it("requires a partial approval to sit strictly between zero and the request", async () => {
    for (const amount of [0, 100_000_00]) {
      const wrong = new ClaimDecision({ ...base, outcome: "PARTIALLY_APPROVED", approvedAmountMinor: amount });
      assert.ok((await errorsOf(wrong)).includes("approvedAmountMinor"), `accepted ${amount}`);
    }

    const right = new ClaimDecision({ ...base, outcome: "PARTIALLY_APPROVED", approvedAmountMinor: 60_000_00 });
    assert.ok(!(await errorsOf(right)).includes("approvedAmountMinor"));
  });

  it("always requires a customer-facing explanation", async () => {
    const decision = new ClaimDecision({
      ...base,
      outcome: "FULLY_APPROVED",
      approvedAmountMinor: 100_000_00,
      customerExplanation: ""
    });
    assert.ok((await errorsOf(decision)).includes("customerExplanation"));
  });
});

describe("settlement records", () => {
  const base = {
    claimId: objectId(),
    beneficiaryId: objectId(),
    beneficiaryVersion: 1,
    approvedAmountMinor: 40_000_00,
    paidAmountMinor: 40_000_00,
    paymentDate: new Date(),
    proofDocumentId: objectId(),
    recordedBy: objectId(),
    idempotencyKey: "claim-settlement:abc"
  };

  it("requires a transaction reference", async () => {
    const settlement = new ClaimSettlement({ ...base });
    assert.ok((await errorsOf(settlement)).includes("transactionReference"));
  });

  it("requires payment proof", async () => {
    const settlement = new ClaimSettlement({ ...base, transactionReference: "UTR123456", proofDocumentId: undefined });
    assert.ok((await errorsOf(settlement)).includes("proofDocumentId"));
  });

  it("refuses to pay more than was approved", async () => {
    const settlement = new ClaimSettlement({
      ...base,
      transactionReference: "UTR123456",
      paidAmountMinor: 50_000_00
    });
    assert.ok((await errorsOf(settlement)).includes("paidAmountMinor"));
  });

  it("accepts a complete record", async () => {
    const settlement = new ClaimSettlement({ ...base, transactionReference: "UTR123456" });
    assert.deepEqual(await errorsOf(settlement), []);
  });
});

describe("recovery arithmetic", () => {
  const base = { claimId: objectId(), partyType: "CARRIER" as const, partyName: "DPD" };

  it("refuses an admitted amount above what was claimed", async () => {
    const recovery = new ClaimRecovery({ ...base, submittedAmountMinor: 80_000_00, admittedAmountMinor: 90_000_00 });
    assert.ok((await errorsOf(recovery)).includes("admittedAmountMinor"));
  });

  it("refuses a received amount above what was admitted", async () => {
    const recovery = new ClaimRecovery({
      ...base,
      submittedAmountMinor: 80_000_00,
      admittedAmountMinor: 60_000_00,
      receivedAmountMinor: 70_000_00
    });
    assert.ok((await errorsOf(recovery)).includes("receivedAmountMinor"));
  });

  it("computes Swiftline's exposure", async () => {
    // The worked example from the plan: paid 80,000, recovered 60,000.
    assert.equal(
      swiftlineExposureMinor({ paidToCustomerMinor: 80_000_00, recoveredMinor: 60_000_00 }),
      20_000_00
    );
  });

  it("never reports a negative exposure", async () => {
    assert.equal(
      swiftlineExposureMinor({ paidToCustomerMinor: 10_000_00, recoveredMinor: 15_000_00 }),
      0
    );
  });
});

describe("policy deadlines", () => {
  const bookedAt = new Date("2026-08-01T00:00:00Z");

  const rule = (overrides: Partial<IClaimPolicyRule>) =>
    ({
      _id: objectId(),
      bookingToClaimDays: 35,
      deliveryToClaimDays: 7,
      evidenceDays: 7,
      appealDays: 15,
      internalReviewDays: 15,
      carrierRecoveryDays: null,
      ...overrides
    }) as IClaimPolicyRule;

  it("falls back to the built-in defaults when no rule is configured", async () => {
    const result = computeClaimDeadlines({ rule: null, bookedAt, filedAt: bookedAt });
    assert.equal(result.policyRuleId, null);
    assert.equal(result.filingBasis, "BOOKING");
    assert.equal(result.filingDeadlineAt.toISOString(), "2026-09-05T00:00:00.000Z");
  });

  it("flags a late filing without rejecting it", async () => {
    const result = computeClaimDeadlines({
      rule: null,
      bookedAt,
      filedAt: new Date("2026-09-20T00:00:00Z")
    });
    assert.equal(result.filedLate, true);
  });

  it("does not flag a filing inside the window", async () => {
    const result = computeClaimDeadlines({
      rule: null,
      bookedAt,
      filedAt: new Date("2026-08-20T00:00:00Z")
    });
    assert.equal(result.filedLate, false);
  });

  it("warns when the carrier window has closed but the client's has not", async () => {
    // The exposure case: valid for the client, unrecoverable from the carrier.
    const result = computeClaimDeadlines({
      rule: rule({ carrierRecoveryDays: 21 }),
      bookedAt,
      filedAt: new Date("2026-08-30T00:00:00Z")
    });

    assert.equal(result.filedLate, false, "still inside the client window");
    assert.equal(result.outsideCarrierWindow, true, "past the carrier window");
  });

  it("stays quiet while both windows are open", async () => {
    const result = computeClaimDeadlines({
      rule: rule({ carrierRecoveryDays: 21 }),
      bookedAt,
      filedAt: new Date("2026-08-10T00:00:00Z")
    });
    assert.equal(result.outsideCarrierWindow, false);
  });

  it("cannot warn when no carrier window is configured", async () => {
    const result = computeClaimDeadlines({
      rule: rule({ carrierRecoveryDays: null }),
      bookedAt,
      filedAt: new Date("2027-01-01T00:00:00Z")
    });
    assert.equal(result.outsideCarrierWindow, false);
  });

  it("honours a negotiated rule over the defaults", async () => {
    const result = computeClaimDeadlines({
      rule: rule({ bookingToClaimDays: 60, appealDays: 30 }),
      bookedAt,
      filedAt: bookedAt
    });
    assert.equal(result.filingDeadlineAt.toISOString(), "2026-09-30T00:00:00.000Z");
    assert.equal(result.appealDays, 30);
  });

  it("counts the appeal window from the decision", async () => {
    const decidedAt = new Date("2026-08-10T00:00:00Z");
    assert.equal(
      computeAppealDeadline(decidedAt).toISOString(),
      new Date("2026-08-25T00:00:00Z").toISOString()
    );
  });
});

describe("claim numbering", () => {
  it("uses the India financial year", async () => {
    assert.equal(claimFinancialYear(new Date("2026-08-08T00:00:00Z")), "26-27");
    assert.equal(claimFinancialYear(new Date("2026-04-01T06:00:00Z")), "26-27");
    assert.equal(claimFinancialYear(new Date("2026-03-31T06:00:00Z")), "25-26");
  });

  it("rolls over in IST, not UTC", async () => {
    // 31 March 21:00 UTC is 1 April 02:30 IST, so this belongs to the new year.
    // A UTC-based calculation would file it under the old one.
    assert.equal(claimFinancialYear(new Date("2026-03-31T21:00:00Z")), "26-27");
  });
});
