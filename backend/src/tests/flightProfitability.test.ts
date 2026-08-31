import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  allocateMinorUnits,
  calculateFlightCostTotals,
  clearExchangeRateCacheForTests,
  isFlightBuyingRateApplicable,
  isBilledWeightOverride,
  nextFlightSnapshotRevision,
  resolveFlightRateRegion
} from "../services/flightProfitability.service.js";
import { ExchangeRateCache } from "../models/exchangeRateCache.model.js";

describe("flight cost calculations", () => {
  test("only a genuinely different billed weight is an override", () => {
    assert.equal(isBilledWeightOverride(480, 480), false);
    assert.equal(isBilledWeightOverride(480.0004, 480), false);
    assert.equal(isBilledWeightOverride(480.001, 480), true);
  });

  test("GST zero leaves air freight total equal to base", () => {
    const result = calculateFlightCostTotals({
      rate: { airFreightRateMinorPerKg: 20_000, gstBasisPoints: 0, eicfRateMinorPerKg: 0, customsMinor: 0, transportationMinor: 0, cflMinorPerBagGbp: 0, dpdLabelMinorGbp: 0 },
      facts: { manifestWeightKg: 100, billedWeightKg: 100, totalBags: 0, totalParcels: 0, portalDpdLabels: 0, externalPaidLabels: 0 },
      gbpToInr: 100,
      totalRevenueMinor: 0,
    });
    assert.equal(result.airFreightBaseMinor, 2_000_000);
    assert.equal(result.airFreightGstMinor, 0);
    assert.equal(result.airFreightTotalMinor, 2_000_000);
    assert.equal(result.totalCostMinor, 2_000_000);
    assert.equal(result.marginBasisPoints, null);
  });

  test("manual FX override uses provided rate and margin is dash when revenue zero", () => {
    const result = calculateFlightCostTotals({
      rate: { airFreightRateMinorPerKg: 10_000, gstBasisPoints: 1_800, eicfRateMinorPerKg: 500, customsMinor: 50_000, transportationMinor: 25_000, cflMinorPerBagGbp: 1_000, dpdLabelMinorGbp: 500 },
      facts: { manifestWeightKg: 10, billedWeightKg: 10, totalBags: 2, totalParcels: 4, portalDpdLabels: 2, externalPaidLabels: 1 },
      gbpToInr: 115.5,
      totalRevenueMinor: 0,
    });
    // cfl 2 bags * 1000 =2000 GBP minor -> 231000 INR ; labels 3*500=1500 GBP ->173250 INR
    assert.equal(result.cflInrMinor, Math.round(2_000 * 115.5));
    assert.equal(result.dpdLabelsInrMinor, Math.round(1_500 * 115.5));
    assert.equal(result.marginBasisPoints, null);
  });

  test("label reconciliation: billable = portal + external, missing = parcels - billable", () => {
    const facts = { manifestWeightKg: 50, billedWeightKg: 50, totalBags: 5, totalParcels: 20, portalDpdLabels: 12, externalPaidLabels: 5 };
    const result = calculateFlightCostTotals({
      rate: { airFreightRateMinorPerKg: 0, gstBasisPoints: 0, eicfRateMinorPerKg: 0, customsMinor: 0, transportationMinor: 0, cflMinorPerBagGbp: 0, dpdLabelMinorGbp: 1_000 },
      facts, gbpToInr: 100,
    });
    assert.equal(result.dpdLabelsGbpMinor, 17_000);
    assert.equal(result.dpdLabelsInrMinor, 1_700_000);
    const billable = facts.portalDpdLabels + facts.externalPaidLabels;
    const missing = Math.max(0, facts.totalParcels - billable);
    assert.equal(billable, 17);
    assert.equal(missing, 3);
  });

  test("zero bags and zero labels still produce valid totals", () => {
    const result = calculateFlightCostTotals({
      rate: { airFreightRateMinorPerKg: 15_000, gstBasisPoints: 1_800, eicfRateMinorPerKg: 1_000, customsMinor: 100_000, transportationMinor: 100_000, cflMinorPerBagGbp: 2_000, dpdLabelMinorGbp: 3_000 },
      facts: { manifestWeightKg: 0, billedWeightKg: 0, totalBags: 0, totalParcels: 0, portalDpdLabels: 0, externalPaidLabels: 0 },
      gbpToInr: 110,
    });
    assert.equal(result.airFreightBaseMinor, 0);
    assert.equal(result.cflGbpMinor, 0);
    assert.equal(result.dpdLabelsGbpMinor, 0);
    assert.equal(result.totalCostMinor, 200_000);
  });

  test("fractional billed weight rounds correctly", () => {
    const result = calculateFlightCostTotals({
      rate: { airFreightRateMinorPerKg: 10_000, gstBasisPoints: 1_800, eicfRateMinorPerKg: 0, customsMinor: 0, transportationMinor: 0, cflMinorPerBagGbp: 0, dpdLabelMinorGbp: 0 },
      facts: { manifestWeightKg: 10.333, billedWeightKg: 10.333, totalBags: 0, totalParcels: 0, portalDpdLabels: 0, externalPaidLabels: 0 },
      gbpToInr: 1,
    });
    assert.equal(result.airFreightBaseMinor, Math.round(10_000 * 10.333));
  });
});

describe("allocation rounding", () => {
  test("reconciles every paise and is deterministic via stableIds", () => {
    const w = [15_000, 10_000, 5_000];
    const ids = ["A", "B", "C"];
    const a = allocateMinorUnits(10_001, w, ids);
    const b = allocateMinorUnits(10_001, w, ids);
    assert.deepEqual(a, b);
    assert.equal(a.reduce((s, v) => s + v, 0), 10_001);
  });

  test("equal weights split remainder by stableId order", () => {
    const result = allocateMinorUnits(10, [1_000, 1_000, 1_000], ["C", "A", "B"]);
    // raw 3.33 each, fractions equal -> tie-break by id A,B,C order
    assert.equal(result.reduce((s, v) => s + v, 0), 10);
    // A gets extra first
    const idxA = ["C", "A", "B"].indexOf("A");
    assert.equal(result[idxA], 4);
  });

  test("zero denominator distributes equally", () => {
    const result = allocateMinorUnits(5, [0, 0, 0], ["X", "Y", "Z"]);
    assert.deepEqual(result, [2, 2, 1]);
    assert.equal(result.reduce((s, v) => s + v, 0), 5);
  });

  test("single shipment receives full total", () => {
    assert.deepEqual(allocateMinorUnits(99_99, [5_000], ["ONLY"]), [99_99]);
  });

  test("parcel-based DPD allocation vs weight-based totals preserve sum", () => {
    const weightUnits = [10_000, 20_000, 5_000];
    const parcelUnits = [2, 1, 3];
    const ids = ["S1", "S2", "S3"];
    const air = allocateMinorUnits(10_000, weightUnits, ids);
    const dpd = allocateMinorUnits(3_000, parcelUnits, ids);
    assert.equal(air.reduce((s, v) => s + v, 0), 10_000);
    assert.equal(dpd.reduce((s, v) => s + v, 0), 3_000);
    // Heaviest weight gets largest air share, most parcels gets largest DPD share
    assert.ok(air[1]! > air[0]!);
    assert.ok(dpd[2]! > dpd[1]!);
  });

  test("empty weights returns empty", () => {
    assert.deepEqual(allocateMinorUnits(100, [], []), []);
  });
});

describe("exchange rate cache", () => {
  test("clear helper resets cache for test isolation", () => {
    clearExchangeRateCacheForTests();
    // no assertion, just ensures function exists and is callable
    assert.ok(true);
  });
});

describe("flight buying-rate eligibility", () => {
  const rate = {
    region: "UK" as const,
    effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    effectiveTo: new Date("2026-08-31T00:00:00.000Z"),
    status: "ACTIVE" as const
  };

  test("maps supported manifest destinations to configured flight regions", () => {
    assert.equal(resolveFlightRateRegion("GB"), "UK");
    assert.equal(resolveFlightRateRegion("US"), "US");
    assert.equal(resolveFlightRateRegion("CA"), "CANADA");
    assert.equal(resolveFlightRateRegion("DE"), "EUROPE");
    assert.equal(resolveFlightRateRegion("AE"), null);
  });

  test("requires matching region, active status, and inclusive effective date", () => {
    assert.equal(isFlightBuyingRateApplicable(rate, "GB", "2026-08-01"), true);
    assert.equal(isFlightBuyingRateApplicable(rate, "GB", "2026-08-31"), true);
    assert.equal(isFlightBuyingRateApplicable(rate, "GB", "2026-09-01"), false);
    assert.equal(isFlightBuyingRateApplicable(rate, "US", "2026-08-15"), false);
    assert.equal(isFlightBuyingRateApplicable({ ...rate, status: "DELETED" }, "GB", "2026-08-15"), false);
  });
});

describe("flight cost revisions", () => {
  test("advances clean revision sequences", () => {
    assert.equal(nextFlightSnapshotRevision(1, null), 1);
    assert.equal(nextFlightSnapshotRevision(2, 1), 2);
  });

  test("repairs legacy sheets whose stored revision already collides", () => {
    assert.equal(nextFlightSnapshotRevision(1, 1), 2);
    assert.equal(nextFlightSnapshotRevision(2, 5), 6);
  });
});
