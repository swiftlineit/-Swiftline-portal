import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getCreditBalances, getCreditUtilization, isCreditWindowOpen } from "../services/creditAccount.service.js";

type WindowAccount = Parameters<typeof isCreditWindowOpen>[0];
type BalanceAccount = Parameters<typeof getCreditBalances>[0];

const now = new Date("2026-07-15T00:00:00.000Z");

function windowAccount(overrides: Partial<WindowAccount> = {}): WindowAccount {
  return { status: "ACTIVE", validFrom: null, validUntil: null, ...overrides };
}

function balanceAccount(overrides: Partial<BalanceAccount> = {}): BalanceAccount {
  return {
    status: "ACTIVE",
    validFrom: null,
    validUntil: null,
    approvedCreditLimitMinor: 100000,
    reservedCreditMinor: 0,
    unbilledCreditMinor: 0,
    invoicedOutstandingMinor: 0,
    customerAdvanceBalanceMinor: 0,
    reservedAdvanceMinor: 0,
    ...overrides
  };
}

describe("credit validity window", () => {
  it("is open for an active account with no window", () => {
    assert.equal(isCreditWindowOpen(windowAccount(), now), true);
  });

  it("is closed before validFrom and after validUntil", () => {
    assert.equal(isCreditWindowOpen(windowAccount({ validFrom: new Date("2026-08-01T00:00:00.000Z") }), now), false);
    assert.equal(isCreditWindowOpen(windowAccount({ validUntil: new Date("2026-07-01T00:00:00.000Z") }), now), false);
  });

  it("is closed for any non-active status", () => {
    for (const status of ["APPROVED", "SUSPENDED", "EXPIRED", "CLOSED", "ON_HOLD"] as const) {
      assert.equal(isCreditWindowOpen(windowAccount({ status }), now), false);
    }
  });
});

describe("getCreditBalances honours the validity window", () => {
  it("exposes approved credit while the window is open", () => {
    const balances = getCreditBalances(balanceAccount({ reservedCreditMinor: 20000 }), now);
    assert.equal(balances.availableCreditMinor, 80000);
    assert.equal(balances.usedCreditMinor, 20000);
  });

  it("zeroes available credit once the window has closed but keeps advance", () => {
    const expired = balanceAccount({
      validUntil: new Date("2026-07-01T00:00:00.000Z"),
      customerAdvanceBalanceMinor: 5000
    });
    const balances = getCreditBalances(expired, now);
    assert.equal(balances.availableCreditMinor, 0);
    assert.equal(balances.availableAdvanceMinor, 5000);
    assert.equal(balances.availableBookingCapacityMinor, 5000);
  });

  it("zeroes available credit before the window opens", () => {
    const future = balanceAccount({ validFrom: new Date("2026-08-01T00:00:00.000Z") });
    assert.equal(getCreditBalances(future, now).availableCreditMinor, 0);
  });
});

describe("credit utilization warning", () => {
  function utilizationAccount(overrides: Partial<Parameters<typeof getCreditUtilization>[0]> = {}) {
    return { ...balanceAccount(), creditWarningThresholdPercent: 70, ...overrides };
  }

  it("computes utilization and flags at or above the threshold", () => {
    const at = getCreditUtilization(utilizationAccount({ unbilledCreditMinor: 70000 }), now);
    assert.equal(at.utilizationPercent, 70);
    assert.equal(at.warningActive, true);
  });

  it("does not flag below the threshold", () => {
    const below = getCreditUtilization(utilizationAccount({ unbilledCreditMinor: 60000 }), now);
    assert.equal(below.utilizationPercent, 60);
    assert.equal(below.warningActive, false);
  });

  it("does not flag a low absolute balance against a 70 percent threshold", () => {
    const below = getCreditUtilization(utilizationAccount({
      approvedCreditLimitMinor: 100000000,
      unbilledCreditMinor: 1008600,
      invoicedOutstandingMinor: 70000
    }), now);
    assert.equal(below.utilizationPercent, 1);
    assert.equal(below.warningActive, false);
  });

  it("never flags when the window is closed", () => {
    const expired = getCreditUtilization(utilizationAccount({
      unbilledCreditMinor: 90000,
      validUntil: new Date("2026-07-01T00:00:00.000Z")
    }), now);
    assert.equal(expired.warningActive, false);
  });
});
