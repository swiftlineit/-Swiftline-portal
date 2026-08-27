import assert from "node:assert/strict";
import test from "node:test";
import { ShipmentProfitability, type ShipmentProfitabilityCost } from "../models/shipmentProfitability.model.js";
import {
  blankProfitabilityCosts,
  calculateProfitabilityTotals,
  calculateVendorRateAmount,
  normalizeProfitabilityCosts,
  resolveProfitabilityAwb
} from "../services/shipmentProfitability.service.js";
import { allocateMinorUnits, calculateFlightCostTotals } from "../services/flightProfitability.service.js";

function actualCosts(values: Partial<Record<ShipmentProfitabilityCost["component"], number>>) {
  return blankProfitabilityCosts().map((cost) => values[cost.component] === undefined
    ? { ...cost, amountMinor: 0, state: "ACTUAL" as const, source: "MANUAL" as const }
    : { ...cost, amountMinor: values[cost.component] ?? 0, state: "ACTUAL" as const, source: "MANUAL" as const });
}

test("profitability keeps missing costs visibly incomplete", () => {
  const result = calculateProfitabilityTotals({ totalRevenueMinor: 100_000, costs: blankProfitabilityCosts() });
  assert.equal(result.coverage, "MISSING");
  assert.equal(result.totalCostMinor, 0);
  assert.equal(result.grossProfitMinor, 100_000);
  assert.equal(result.marginBasisPoints, 10_000);
});

test("profitability sums all confirmed cost components and preserves a loss", () => {
  const costs = actualCosts({ FREIGHT_BUYING: 70_000, AIRLINE_VENDOR: 20_000, FUEL_SURCHARGE: 15_000 });
  const result = calculateProfitabilityTotals({ totalRevenueMinor: 100_000, costs });
  assert.equal(result.coverage, "ACTUAL");
  assert.equal(result.totalCostMinor, 105_000);
  assert.equal(result.grossProfitMinor, -5_000);
  assert.equal(result.marginBasisPoints, -500);
});

test("zero revenue has no margin percentage", () => {
  const result = calculateProfitabilityTotals({ totalRevenueMinor: 0, costs: actualCosts({ FREIGHT_BUYING: 5_000 }) });
  assert.equal(result.grossProfitMinor, -5_000);
  assert.equal(result.marginBasisPoints, null);
});

test("vendor rates calculate per-kg, flat, and freight percentage amounts", () => {
  assert.equal(calculateVendorRateAmount({ calculation: "PER_KG", amountMinor: 12_50, percentageBasisPoints: 0 }, 10.5, 0), 13_125);
  assert.equal(calculateVendorRateAmount({ calculation: "FLAT", amountMinor: 7_500, percentageBasisPoints: 0 }, 20, 0), 7_500);
  assert.equal(calculateVendorRateAmount({ calculation: "PERCENT_OF_FREIGHT", amountMinor: 0, percentageBasisPoints: 1_250 }, 20, 80_000), 10_000);
});

test("profitability preserves public AWB identity for legacy invoices", () => {
  assert.equal(resolveProfitabilityAwb(" SLCDEL250825001 ", "carrier-reference"), "SLCDEL250825001");
  assert.equal(resolveProfitabilityAwb("", undefined, " SLCDEL250825002 "), "SLCDEL250825002");
  assert.equal(resolveProfitabilityAwb("", undefined, null), "AWB Pending");
});

test("profitability normalization preserves persisted cost subdocuments", () => {
  const document = new ShipmentProfitability({
    costs: actualCosts({ FREIGHT_BUYING: 100_000, HANDLING: 47_000 })
  });
  const normalized = normalizeProfitabilityCosts(document.costs);
  assert.equal(normalized.find((cost) => cost.component === "FREIGHT_BUYING")?.amountMinor, 100_000);
  assert.equal(normalized.find((cost) => cost.component === "HANDLING")?.amountMinor, 47_000);
  assert.equal(normalized.every((cost) => cost.state === "ACTUAL"), true);
});

test("flight costs calculate per-kg freight, GST, flat charges and GBP conversions", () => {
  const result = calculateFlightCostTotals({
    rate: {
      airFreightRateMinorPerKg: 28_000,
      gstBasisPoints: 1_800,
      eicfRateMinorPerKg: 1_650,
      customsMinor: 300_000,
      transportationMinor: 300_000,
      cflMinorPerBagGbp: 1_400,
      dpdLabelMinorGbp: 1_000
    },
    facts: {
      manifestWeightKg: 480,
      billedWeightKg: 480,
      totalBags: 20,
      totalParcels: 50,
      portalDpdLabels: 42,
      externalPaidLabels: 5
    },
    gbpToInr: 110,
    totalRevenueMinor: 30_000_000
  });
  assert.equal(result.airFreightBaseMinor, 13_440_000);
  assert.equal(result.airFreightGstMinor, 2_419_200);
  assert.equal(result.eicfMinor, 792_000);
  assert.equal(result.cflGbpMinor, 28_000);
  assert.equal(result.cflInrMinor, 3_080_000);
  assert.equal(result.dpdLabelsGbpMinor, 47_000);
  assert.equal(result.dpdLabelsInrMinor, 5_170_000);
  assert.equal(result.totalCostMinor, 25_501_200);
  assert.equal(result.grossProfitMinor, 4_498_800);
  assert.equal(result.marginBasisPoints, 1_500);
});

test("flight allocation reconciles every paise deterministically", () => {
  const first = allocateMinorUnits(10_001, [15_000, 10_000, 5_000], ["A", "B", "C"]);
  const second = allocateMinorUnits(10_001, [15_000, 10_000, 5_000], ["A", "B", "C"]);
  assert.deepEqual(first, second);
  assert.equal(first.reduce((sum, value) => sum + value, 0), 10_001);
  assert.deepEqual(first, [5_000, 3_334, 1_667]);
});
