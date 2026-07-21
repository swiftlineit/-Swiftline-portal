import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  AmendmentBillingError,
  calculateAmendmentBillingAdjustment
} from "../services/amendmentBilling.service.js";

describe("amendment billing allocation policy", () => {
  test("funds an increase from Customer Advance before credit", () => {
    const result = calculateAmendmentBillingAdjustment({
      previousAmountMinor: 50_000,
      amendedAmountMinor: 75_000,
      previousAdvanceAppliedMinor: 20_000,
      previousCreditOutstandingMinor: 30_000,
      availableAdvanceMinor: 10_000,
      availableCreditMinor: 20_000
    });

    assert.equal(result.advanceUsedMinor, 10_000);
    assert.equal(result.creditUsedMinor, 15_000);
    assert.equal(result.advanceAppliedMinor, 30_000);
    assert.equal(result.creditOutstandingMinor, 45_000);
  });

  test("reduces outstanding credit before refunding Customer Advance", () => {
    const result = calculateAmendmentBillingAdjustment({
      previousAmountMinor: 50_000,
      amendedAmountMinor: 5_000,
      previousAdvanceAppliedMinor: 10_000,
      previousCreditOutstandingMinor: 40_000,
      availableAdvanceMinor: 0,
      availableCreditMinor: 0
    });

    assert.equal(result.creditReducedMinor, 40_000);
    assert.equal(result.advanceRefundedMinor, 5_000);
    assert.equal(result.advanceAppliedMinor, 5_000);
    assert.equal(result.creditOutstandingMinor, 0);
  });

  test("rejects an increase when combined capacity is insufficient", () => {
    assert.throws(
      () => calculateAmendmentBillingAdjustment({
        previousAmountMinor: 50_000,
        amendedAmountMinor: 75_000,
        previousAdvanceAppliedMinor: 20_000,
        previousCreditOutstandingMinor: 30_000,
        availableAdvanceMinor: 5_000,
        availableCreditMinor: 19_999
      }),
      (error) => error instanceof AmendmentBillingError && error.statusCode === 402
    );
  });
});
