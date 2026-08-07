import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ShipmentQuote } from "../models/shipmentQuote.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { Branch } from "../models/branch.model.js";
import {
  calculatePublishedQuotePricing,
  effectiveQuoteStatus,
  loadQuoteContext,
  loadQuoteDisplayContext
} from "../services/shipmentQuote.service.js";

describe("shipment quote policy", () => {
  it("adds configured charges before applying 18 percent GST", () => {
    const result = calculatePublishedQuotePricing({
      freightMinor: 100_000,
      fuelSurchargeMinor: 5_000,
      taxableAddOnsMinor: 2_500
    });
    assert.equal(result.taxableSubtotalMinor, 107_500);
    assert.equal(result.gstMinor, 19_350);
    assert.equal(result.totalMinor, 126_850);
    assert.deepEqual(Object.keys(result).sort(), [
      "currency", "freightMinor", "fuelSurchargeMinor", "gstMinor", "gstRate",
      "taxableAddOnsMinor", "taxableSubtotalMinor", "totalMinor"
    ]);
  });

  it("reports an elapsed published quote as expired", () => {
    assert.equal(effectiveQuoteStatus({
      status: "QUOTED",
      validUntil: new Date("2026-07-20T00:00:00.000Z")
    }, new Date("2026-07-21T00:00:00.000Z")), "EXPIRED");
  });

  it("requires request and estimate snapshots", async () => {
    const quote = new ShipmentQuote({
      quoteNumber: "QT/26-27/00001",
      businessAccountId: "64b000000000000000000001",
      branchId: "64b000000000000000000002",
      source: "CLIENT",
      requestedBy: "64b000000000000000000003"
    });
    await assert.rejects(quote.validate(), (error: unknown) => {
      const errors = (error as { errors?: Record<string, unknown> }).errors ?? {};
      return Boolean(errors.requestSnapshot && errors.estimateSnapshot);
    });
  });

  it("keeps historical quote details readable when the account is unassigned", async () => {
    const originalAccountFind = BusinessAccount.findById;
    const originalBranchFind = Branch.findById;
    BusinessAccount.findById = (() => ({
      exec: async () => ({
        _id: "64b000000000000000000001",
        accountId: "BA-2026-100001",
        company: { companyName: "Acme Exports" },
        rateCardBand: null
      })
    })) as unknown as typeof BusinessAccount.findById;
    Branch.findById = (() => ({
      exec: async () => ({
        _id: "64b000000000000000000002",
        name: "Delhi",
        code: "DEL",
        address: { city: "Delhi" },
        contact: { email: "delhi@example.com", phone: "+911112223333" }
      })
    })) as unknown as typeof Branch.findById;

    try {
      const quote = {
        businessAccountId: "64b000000000000000000001",
        branchId: "64b000000000000000000002"
      } as unknown as InstanceType<typeof ShipmentQuote>;
      const display = await loadQuoteDisplayContext(quote);
      assert.equal(display?.companyName, "Acme Exports");
      await assert.rejects(loadQuoteContext(quote), /rate card must be assigned/i);
    } finally {
      BusinessAccount.findById = originalAccountFind;
      Branch.findById = originalBranchFind;
    }
  });
});
