import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requiredDocumentsFor } from "../services/claims/claimChecklist.service.js";
import { claimCategoryValues } from "../models/claimTypes.js";

/**
 * The checklist is what a client is judged against, so asking for the wrong
 * documents is not a cosmetic problem — it is the difference between a claim
 * settled in a week and one that dies in correspondence.
 */

describe("required evidence by category", () => {
  it("always asks for proof of value and a packing list", () => {
    for (const category of claimCategoryValues) {
      const required = requiredDocumentsFor(category);
      assert.ok(required.includes("VALUE_PROOF"), `${category} did not ask for value proof`);
      assert.ok(required.includes("PACKING_LIST"), `${category} did not ask for a packing list`);
    }
  });

  it("does not ask a total loss for photographs of the goods", () => {
    // The parcel never arrived. Asking the client to photograph it is the
    // fastest way to make a valid claim feel like an accusation.
    const required = requiredDocumentsFor("TOTAL_LOSS");

    assert.ok(!required.includes("GOODS_PHOTO"));
    assert.ok(!required.includes("OUTER_PACKAGING_PHOTO"));
    assert.ok(required.includes("NON_RECEIPT_DECLARATION"));
  });

  it("asks damage claims for packaging as well as goods", () => {
    // Whether the outer packaging was intact is what separates transit damage
    // from goods that were packed badly, so both are needed.
    const required = requiredDocumentsFor("PHYSICAL_DAMAGE");

    assert.ok(required.includes("GOODS_PHOTO"));
    assert.ok(required.includes("OUTER_PACKAGING_PHOTO"));
    assert.ok(required.includes("INNER_PACKAGING_PHOTO"));
    assert.ok(required.includes("LABEL_PHOTO"));
  });

  it("asks shortage and partial loss for a missing-item list", () => {
    for (const category of ["SHORTAGE", "PARTIAL_LOSS"] as const) {
      assert.ok(requiredDocumentsFor(category).includes("MISSING_ITEM_LIST"), category);
    }
  });

  it("asks theft claims for tampering evidence and a consignee statement", () => {
    const required = requiredDocumentsFor("THEFT_OR_TAMPERING");

    assert.ok(required.includes("TAMPERING_PHOTO"));
    assert.ok(required.includes("CONSIGNEE_STATEMENT"));
  });

  it("never repeats a category", () => {
    for (const category of claimCategoryValues) {
      const required = requiredDocumentsFor(category);
      assert.equal(new Set(required).size, required.length, `${category} had duplicates`);
    }
  });

  it("lets a policy rule replace the list wholesale", () => {
    // A negotiated contract may waive the packing list, or a route may demand a
    // carrier exception report that no default would produce.
    const required = requiredDocumentsFor("PHYSICAL_DAMAGE", ["VALUE_PROOF", "CARRIER_EXCEPTION_REPORT"]);

    assert.deepEqual(required, ["VALUE_PROOF", "CARRIER_EXCEPTION_REPORT"]);
    assert.ok(!required.includes("PACKING_LIST"));
  });

  it("ignores an empty override rather than requiring nothing", () => {
    // An unconfigured rule must not silently drop every requirement.
    assert.deepEqual(requiredDocumentsFor("SHORTAGE", []), requiredDocumentsFor("SHORTAGE"));
  });

  it("produces a list for every category in the enum", () => {
    for (const category of claimCategoryValues) {
      assert.ok(requiredDocumentsFor(category).length > 0, `${category} required nothing`);
    }
  });
});
