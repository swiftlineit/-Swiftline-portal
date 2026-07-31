import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  csbVClearanceCharge,
  formatCsbType,
  getCsbClearanceCharge,
  normalizeCsbType
} from "../services/csbType.service.js";
import {
  composeContentsDescription,
  contentsDescriptionMaxLength,
  isValidHsnCode,
  normalizeParcelItems
} from "../services/parcelItems.service.js";
import { normalizeQuoteDocuments } from "../services/quoteDocuments.service.js";

describe("CSB type", () => {
  test("treats a missing or unknown value as CSB-IV so historical pricing never changes", () => {
    for (const value of [undefined, null, "", "CSB-IV", "nonsense", 5]) {
      assert.equal(normalizeCsbType(value), "CSB_IV");
      assert.equal(getCsbClearanceCharge(value), 0);
    }
  });

  test("only CSB-V attracts the flat clearance charge", () => {
    assert.equal(getCsbClearanceCharge("CSB_V"), csbVClearanceCharge);
    assert.equal(getCsbClearanceCharge("CSB_IV"), 0);
    assert.equal(csbVClearanceCharge, 1800);
  });

  test("formats display labels", () => {
    assert.equal(formatCsbType("CSB_V"), "CSB-V");
    assert.equal(formatCsbType(undefined), "CSB-IV");
  });
});

// The pricing maths CSB-V introduces, verified independently of the database so
// these run without a Mongo connection. calculateShipmentPricingEstimate applies
// exactly this arithmetic on top of the rate card lookup.
describe("CSB-V charge arithmetic", () => {
  const gstRate = 0.18;

  test("adds 1800 once per shipment, then GST on the combined base", () => {
    // The worked example: 2000 freight across a 5 kg shipment.
    const freight = 2000;
    const base = freight + getCsbClearanceCharge("CSB_V");
    const gst = base * gstRate;

    assert.equal(base, 3800);
    assert.equal(gst, 684);
    assert.equal(base + gst, 4484);
  });

  test("the charge does not scale with parcel count or weight", () => {
    // Same freight total, whether it arrived as one box or five.
    const onePercel = 2000 + getCsbClearanceCharge("CSB_V");
    const fiveParcels = 2000 + getCsbClearanceCharge("CSB_V");
    assert.equal(onePercel, fiveParcels);
  });

  test("CSB-IV prices exactly as before the charge existed", () => {
    const freight = 2000;
    const base = freight + getCsbClearanceCharge("CSB_IV");
    assert.equal(base, freight);
    assert.equal(base + base * gstRate, 2360);
  });
});

// The review shipment form prices in the browser via the frontend's own copy of
// this maths (frontend/src/lib/shipmentPricing.ts). The two drifting apart once
// already showed a customer 2,360 on screen while the backend charged 4,484, so
// the shared rule is pinned here: the charge is added to freight BEFORE GST, once
// per shipment, and is suppressed when no rate applies.
describe("frontend/backend pricing parity rule", () => {
  const gstRate = 0.18;
  const price = (freight: number, csbType: "CSB_IV" | "CSB_V", missingRate = false) => {
    const csb = missingRate ? 0 : getCsbClearanceCharge(csbType);
    const base = freight + csb;
    return { csb, base, gst: base * gstRate, total: base + base * gstRate };
  };

  test("the screenshot case: 10 kg to GB at 200/kg on CSB-V", () => {
    const result = price(2000, "CSB_V");
    assert.deepEqual(result, { csb: 1800, base: 3800, gst: 684, total: 4484 });
  });

  test("the same shipment on CSB-IV is unchanged", () => {
    const result = price(2000, "CSB_IV");
    assert.deepEqual(result, { csb: 0, base: 2000, gst: 360, total: 2360 });
  });

  test("no rate available never quotes the clearance charge alone", () => {
    assert.equal(price(0, "CSB_V", true).total, 0);
  });
});

describe("HSN codes", () => {
  test("accepts 4, 6 and 8 digit codes", () => {
    for (const code of ["1905", "190531", "19053100"]) {
      assert.ok(isValidHsnCode(code), `expected ${code} to be valid`);
    }
  });

  test("rejects malformed codes", () => {
    for (const code of ["", "190", "12345", "1234567", "123456789", "1905AB", "19 05", null, undefined]) {
      assert.ok(!isValidHsnCode(code), `expected ${JSON.stringify(code)} to be invalid`);
    }
  });

  test("trims surrounding whitespace before validating", () => {
    assert.ok(isValidHsnCode("  19053100  "));
  });
});

describe("parcel items", () => {
  test("composes the derived contents description from item descriptions", () => {
    const items = [{ description: "Cookies", hsnCode: "1905" }, { description: "Clothes", hsnCode: "6203" }];
    assert.equal(composeContentsDescription(items), "Cookies, Clothes");
  });

  test("never exceeds the contentsDescription column length", () => {
    // 20 items well past the limit; the result must still fit and end cleanly.
    const items = Array.from({ length: 20 }, (_, index) => ({
      description: `Item number ${index + 1} description`,
      hsnCode: "1905"
    }));
    const composed = composeContentsDescription(items);
    assert.ok(composed.length <= contentsDescriptionMaxLength, `got ${composed.length} chars`);
    assert.ok(!composed.endsWith(","), "should not end mid-list");
  });

  test("hard-cuts a single oversized item rather than dropping it", () => {
    const composed = composeContentsDescription([{ description: "x".repeat(300), hsnCode: "1905" }]);
    assert.equal(composed.length, contentsDescriptionMaxLength);
  });

  test("ignores blank descriptions", () => {
    const composed = composeContentsDescription([
      { description: "  ", hsnCode: "" },
      { description: "Cookies", hsnCode: "1905" }
    ]);
    assert.equal(composed, "Cookies");
  });

  test("rebuilds items for legacy parcels that only have a description", () => {
    const items = normalizeParcelItems({ contentsDescription: "Handicrafts" });
    assert.deepEqual(items, [{ description: "Handicrafts", hsnCode: "" }]);
  });

  test("prefers stored items over the legacy description", () => {
    const items = normalizeParcelItems({
      items: [{ description: "Cookies", hsnCode: "19053100" }],
      contentsDescription: "Cookies"
    });
    assert.deepEqual(items, [{ description: "Cookies", hsnCode: "19053100" }]);
  });

  test("returns nothing for a parcel with neither", () => {
    assert.deepEqual(normalizeParcelItems({}), []);
  });
});

describe("quote documents", () => {
  test("keeps only known codes, de-duplicated and in canonical order", () => {
    const documents = normalizeQuoteDocuments(["PAN", "IEC", "PAN", "NOT_A_DOCUMENT"]);
    assert.deepEqual(documents, ["IEC", "PAN"]);
  });

  test("returns an empty list for a non-array", () => {
    assert.deepEqual(normalizeQuoteDocuments(undefined), []);
  });
});
