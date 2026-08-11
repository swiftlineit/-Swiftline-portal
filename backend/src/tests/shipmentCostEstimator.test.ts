import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  emptyRouteCharges,
  isRemoteAreaPostcode,
  type RouteCharges
} from "../services/countryRouteCharge.service.js";
import {
  calculateChargeBreakdown,
  resolveShipmentTaxSelection,
  type ShipmentPricingEstimate
} from "../services/shipmentPricing.service.js";
import {
  assertPriceLockUnchanged,
  buildPricingHash,
  ShipmentPriceChangedError
} from "../services/shipmentCostEstimate.service.js";

describe("shipment GST treatment", () => {
  test("charges normal accounts and defaults approved accounts to no GST", () => {
    assert.deepEqual(resolveShipmentTaxSelection({ noGstEligible: false }), {
      gstRate: 0.18,
      taxTreatment: "GST_APPLICABLE",
      gstForced: false
    });
    assert.deepEqual(resolveShipmentTaxSelection({ noGstEligible: true }), {
      gstRate: 0,
      taxTreatment: "NO_GST",
      gstForced: false
    });
  });

  test("allows only an eligible account to force GST and preserves a frozen booked rate", () => {
    assert.deepEqual(resolveShipmentTaxSelection({ noGstEligible: true, forceGst: true }), {
      gstRate: 0.18,
      taxTreatment: "GST_APPLICABLE",
      gstForced: true
    });
    assert.deepEqual(resolveShipmentTaxSelection({ noGstEligible: false, forceGst: false, frozenGstRate: 0 }), {
      gstRate: 0,
      taxTreatment: "NO_GST",
      gstForced: false
    });
  });
});

function routeCharges(overrides: Partial<RouteCharges> = {}): RouteCharges {
  return { ...emptyRouteCharges, ...overrides };
}

function breakdown(input: {
  freightAmount?: number;
  missingRate?: boolean;
  csbType?: "CSB_IV" | "CSB_V";
  destinationPostcode?: string;
  insuranceOptIn?: boolean;
  declaredGoodsValue?: number;
  charges?: Partial<RouteCharges>;
} = {}) {
  return calculateChargeBreakdown({
    freightAmount: input.freightAmount ?? 1000,
    missingRate: input.missingRate ?? false,
    parcelCount: 1,
    chargeableWeightTotal: 5,
    csbType: input.csbType ?? "CSB_IV",
    destinationPostcode: input.destinationPostcode,
    insuranceOptIn: input.insuranceOptIn ?? false,
    declaredGoodsValue: input.declaredGoodsValue ?? 0,
    routeCharges: routeCharges(input.charges),
    gstRate: 0.18
  });
}

describe("remote area postcode matching", () => {
  test("matches on prefix so a broad or a precise entry both work", () => {
    assert.equal(isRemoteAreaPostcode("HS1 2AB", ["HS"]), true);
    assert.equal(isRemoteAreaPostcode("HS12AB", ["HS12AB"]), true);
    assert.equal(isRemoteAreaPostcode("EH1 1AA", ["HS"]), false);
  });

  test("ignores the spacing and hyphens people write postcodes with", () => {
    assert.equal(isRemoteAreaPostcode("sw1a-1aa", ["SW1A"]), true);
    assert.equal(isRemoteAreaPostcode("SW1A 1AA", ["sw1a 1aa"]), true);
  });

  test("never treats a missing postcode as remote", () => {
    // A surcharge the customer cannot see the reason for is worse than one missed.
    assert.equal(isRemoteAreaPostcode("", ["HS"]), false);
    assert.equal(isRemoteAreaPostcode(undefined, ["HS"]), false);
    assert.equal(isRemoteAreaPostcode("HS1", []), false);
  });
});

describe("shipment charge breakdown", () => {
  test("an unconfigured route prices exactly as it did before route charges existed", () => {
    const result = breakdown({ freightAmount: 1000 });

    assert.equal(result.baseAmount, 1000);
    assert.equal(result.gstAmount, 180);
    assert.equal(result.totalAmount, 1180);
    assert.deepEqual(result.lines.map((line) => line.code), ["FREIGHT", "GST"]);
  });

  test("CSB-V adds its flat clearance charge once, before GST", () => {
    const result = breakdown({ freightAmount: 1000, csbType: "CSB_V" });

    assert.equal(result.csbClearanceAmount, 1800);
    assert.equal(result.baseAmount, 2800);
    assert.equal(result.totalAmount, 3304);
  });

  test("fuel is a percentage of freight only, not of the other charges", () => {
    const result = breakdown({
      freightAmount: 1000,
      csbType: "CSB_V",
      charges: { fuelSurchargePercent: 15 }
    });

    // 15% of 1000 freight, not of the 2800 that includes clearance.
    assert.equal(result.fuelSurchargeAmount, 150);
    assert.equal(result.baseAmount, 2950);
  });

  test("the remote area charge applies only to a matching postcode", () => {
    const charges = { remoteAreaCharge: 750, remoteAreaPostcodes: ["HS"] };

    const remote = breakdown({ destinationPostcode: "HS1 2AB", charges });
    assert.equal(remote.remoteAreaApplied, true);
    assert.equal(remote.remoteAreaAmount, 750);

    const mainland = breakdown({ destinationPostcode: "EH1 1AA", charges });
    assert.equal(mainland.remoteAreaApplied, false);
    assert.equal(mainland.remoteAreaAmount, 0);
  });

  test("insurance is never charged while the product is switched off", () => {
    const charges = { insurancePercent: 2, insuranceMinimum: 100 };

    const declined = breakdown({ declaredGoodsValue: 50_000, charges });
    assert.equal(declined.insuranceApplied, false);
    assert.equal(declined.insuranceAmount, 0);

    // Opting in no longer buys cover. The flag is still accepted so stored
    // drafts and snapshots that carry it keep pricing without error, but it can
    // no longer put a premium on a new shipment.
    const optedIn = breakdown({ declaredGoodsValue: 50_000, insuranceOptIn: true, charges });
    assert.equal(optedIn.insuranceApplied, false);
    assert.equal(optedIn.insuranceAmount, 0);
  });

  test("a configured insurance minimum cannot reintroduce a premium", () => {
    // The minimum used to floor the premium at 250 on a low-value shipment.
    // With cover switched off, a configured minimum must not become a way for
    // a charge to reappear on a route that still has the rates set.
    const result = breakdown({
      declaredGoodsValue: 1000,
      insuranceOptIn: true,
      charges: { insurancePercent: 2, insuranceMinimum: 250 }
    });

    assert.equal(result.insuranceAmount, 0);
    assert.equal(result.insuranceApplied, false);
  });

  test("the discount comes off every charge, not off freight alone", () => {
    const result = breakdown({
      freightAmount: 1000,
      csbType: "CSB_V",
      charges: { fuelSurchargePercent: 10, discountPercent: 10 }
    });

    // Subtotal 1000 freight + 100 fuel + 1800 clearance = 2900.
    assert.equal(result.discountAmount, 290);
    assert.equal(result.baseAmount, 2610);
    assert.equal(result.gstAmount, 469.8);
    assert.equal(result.totalAmount, 3079.8);
  });

  test("a full discount floors the taxable base at zero rather than going negative", () => {
    const result = breakdown({ freightAmount: 1000, charges: { discountPercent: 100 } });

    assert.equal(result.baseAmount, 0);
    assert.equal(result.gstAmount, 0);
    assert.equal(result.totalAmount, 0);
  });

  test("an unpriceable route quotes no surcharges at all", () => {
    // Freight could not be calculated, so a fuel surcharge or clearance charge on
    // its own would be a number the customer cannot act on.
    const result = breakdown({
      freightAmount: 0,
      missingRate: true,
      csbType: "CSB_V",
      insuranceOptIn: true,
      declaredGoodsValue: 50_000,
      charges: {
        fuelSurchargePercent: 15,
        handlingCharge: 500,
        insurancePercent: 2,
        remoteAreaCharge: 750,
        remoteAreaPostcodes: ["HS"]
      }
    });

    assert.equal(result.totalAmount, 0);
    assert.deepEqual(result.lines, []);
  });

  test("lines carry minor units that match the rupee amounts they are billed at", () => {
    const result = breakdown({
      freightAmount: 1234.56,
      charges: { fuelSurchargePercent: 7.5 }
    });

    for (const line of result.lines) {
      assert.equal(line.amountMinor, Math.round(line.amount * 100));
    }
  });

  // Insurance is absent from this list because cover is switched off portal-wide.
  // Restoring it means restoring the opt-in in shipmentPricing.service.ts.
  test("only the components that apply are listed, in a fixed order", () => {
    const result = breakdown({
      freightAmount: 1000,
      csbType: "CSB_V",
      insuranceOptIn: true,
      declaredGoodsValue: 10_000,
      destinationPostcode: "HS1 2AB",
      charges: {
        fuelSurchargePercent: 10,
        remoteAreaCharge: 750,
        remoteAreaPostcodes: ["HS"],
        handlingCharge: 500,
        insurancePercent: 2,
        discountPercent: 5
      }
    });

    assert.deepEqual(result.lines.map((line) => line.code), [
      "FREIGHT",
      "FUEL_SURCHARGE",
      "REMOTE_AREA",
      "CUSTOMS_CLEARANCE",
      "HANDLING",
      "DISCOUNT",
      "GST"
    ]);
  });

  test("the total is always the taxable base plus its own GST", () => {
    const result = breakdown({
      freightAmount: 3333.33,
      csbType: "CSB_V",
      insuranceOptIn: true,
      declaredGoodsValue: 12_345,
      charges: { fuelSurchargePercent: 12.5, handlingCharge: 250, insurancePercent: 1.5, discountPercent: 7 }
    });

    assert.equal(result.totalAmount, Math.round((result.baseAmount + result.gstAmount) * 100) / 100);
  });
});

/** A priced estimate in the shape the lock hashes, with the parts it reads set. */
function pricingEstimate(overrides: Partial<ShipmentPricingEstimate> = {}): ShipmentPricingEstimate {
  const base = breakdown({ freightAmount: 1000 });
  return {
    parcels: [],
    ...base,
    missingRate: false,
    exceedsMaxBoxKg: false,
    gstRate: 0.18,
    pricingBasis: { rateCardBand: "BAND_A", rateCardIds: ["rate-1"], routeChargesUpdatedAt: null },
    ...overrides
  };
}

describe("price lock", () => {
  test("the same priced shipment always fingerprints the same way", () => {
    assert.equal(buildPricingHash(pricingEstimate()), buildPricingHash(pricingEstimate()));
  });

  test("a changed amount changes the fingerprint", () => {
    const cheaper = pricingEstimate();
    const dearer = pricingEstimate(breakdown({ freightAmount: 1200 }));

    assert.notEqual(buildPricingHash(cheaper), buildPricingHash(dearer));
  });

  test("a configuration edit invalidates the lock even when the total is unchanged", () => {
    // An admin who re-saves route charges without altering a value still moves the
    // basis the customer was quoted against, and the booking must be re-confirmed.
    const before = pricingEstimate();
    const after = pricingEstimate({
      pricingBasis: { rateCardBand: "BAND_A", rateCardIds: ["rate-1"], routeChargesUpdatedAt: new Date("2026-08-05T10:00:00.000Z") }
    });

    assert.equal(before.totalAmount, after.totalAmount);
    assert.notEqual(buildPricingHash(before), buildPricingHash(after));
  });

  test("reassigning the band invalidates the lock even when totals are identical", () => {
    const before = pricingEstimate();
    const after = pricingEstimate({ pricingBasis: { ...before.pricingBasis, rateCardBand: "BAND_C" } });
    assert.equal(before.totalAmount, after.totalAmount);
    assert.notEqual(buildPricingHash(before), buildPricingHash(after));
  });

  test("a booking that matches the accepted price is allowed through", () => {
    const pricing = pricingEstimate();

    assert.doesNotThrow(() => assertPriceLockUnchanged({
      acceptedPricingHash: buildPricingHash(pricing),
      currentPricing: pricing
    }));
  });

  test("a booking whose price moved is refused with the current breakdown", () => {
    const accepted = buildPricingHash(pricingEstimate());
    const currentPricing = pricingEstimate(breakdown({ freightAmount: 1500 }));

    assert.throws(
      () => assertPriceLockUnchanged({ acceptedPricingHash: accepted, currentPricing }),
      (error: unknown) => {
        assert.ok(error instanceof ShipmentPriceChangedError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, "PRICE_CHANGED");
        // The caller needs the new figures to show what changed.
        assert.equal(error.currentPricing.totalAmount, currentPricing.totalAmount);
        return true;
      }
    );
  });

  test("a booking with no accepted price is not blocked", () => {
    // Counter sales and seed scripts book drafts that were never quoted through
    // the estimator, so there is no accepted price for them to differ from.
    const pricing = pricingEstimate();

    assert.doesNotThrow(() => assertPriceLockUnchanged({ currentPricing: pricing }));
    assert.doesNotThrow(() => assertPriceLockUnchanged({ acceptedPricingHash: "  ", currentPricing: pricing }));
  });

  test("a business-account booking without an accepted price is blocked", () => {
    const pricing = pricingEstimate();

    assert.throws(
      () => assertPriceLockUnchanged({ currentPricing: pricing, requireAcceptedPricing: true }),
      (error: unknown) => {
        assert.ok(error instanceof ShipmentPriceChangedError);
        assert.equal(error.statusCode, 409);
        assert.equal(error.code, "PRICE_CHANGED");
        return true;
      }
    );
  });
});
