import assert from "node:assert/strict";
import { describe, test } from "node:test";
import mongoose from "mongoose";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import {
  resolveShipmentInvoicePaymentAllocation,
  serializeShipmentInvoice
} from "../services/shipmentInvoice.service.js";

function invoiceWithAmendment() {
  const issuedAt = new Date("2026-07-14T09:00:00.000Z");
  const revisedAt = new Date("2026-07-15T10:00:00.000Z");

  return new ShipmentInvoice({
    invoiceNumber: "SL/26-27/00001",
    financialYear: "26-27",
    shipmentDraftId: new mongoose.Types.ObjectId(),
    dpdShipmentId: new mongoose.Types.ObjectId(),
    businessAccountId: new mongoose.Types.ObjectId(),
    branchId: new mongoose.Types.ObjectId(),
    currency: "INR",
    supplier: { legalName: "Swiftline" },
    customer: { companyName: "Updated Customer" },
    shipment: { parcels: [{ sequence: 1, actualWeightKg: 12 }] },
    sacCode: "996812",
    description: "Updated courier shipment",
    taxableValueMinor: 20_000,
    gstRatePercent: 18,
    taxType: "IGST",
    cgstAmountMinor: 0,
    sgstAmountMinor: 0,
    igstAmountMinor: 3_600,
    totalTaxAmountMinor: 3_600,
    totalAmountMinor: 23_600,
    reverseCharge: false,
    status: "ISSUED",
    validationWarnings: [],
    paymentStatus: "UNPAID",
    advanceAppliedMinor: 0,
    creditOutstandingMinor: 23_600,
    pricingSnapshot: { totalAmount: 236 },
    revision: 2,
    revisions: [{
      revision: 1,
      revisedAt: issuedAt,
      supplier: { legalName: "Swiftline" },
      customer: { companyName: "Original Customer" },
      shipment: { parcels: [{ sequence: 1, actualWeightKg: 10 }] },
      sacCode: "996812",
      description: "Original courier shipment",
      taxableValueMinor: 10_000,
      gstRatePercent: 18,
      taxType: "IGST",
      cgstAmountMinor: 0,
      sgstAmountMinor: 0,
      igstAmountMinor: 1_800,
      totalTaxAmountMinor: 1_800,
      totalAmountMinor: 11_800,
      advanceAppliedMinor: 5_000,
      creditOutstandingMinor: 6_800,
      pricingSnapshot: { totalAmount: 118 },
      reverseCharge: false,
      status: "ISSUED",
      validationWarnings: [],
      paymentStatus: "PARTIALLY_PAID"
    }],
    issuedAt,
    revisedAt,
    createdBy: new mongoose.Types.ObjectId()
  });
}

describe("shipment invoice revisions", () => {
  test("returns the latest invoice with a complete ordered version index", () => {
    const invoice = serializeShipmentInvoice(invoiceWithAmendment());

    assert.equal(invoice.revision, 2);
    assert.equal(invoice.totalAmountMinor, 23_600);
    assert.equal(invoice.isLatest, true);
    assert.deepEqual(invoice.versions.map((version) => version.revision), [1, 2]);
    assert.equal(invoice.versions[0]?.totalAmountMinor, 11_800);
    assert.equal(invoice.versions[1]?.isLatest, true);
  });

  test("returns the immutable values and allocation from a previous invoice", () => {
    const invoice = serializeShipmentInvoice(invoiceWithAmendment(), 1);
    const parcels = invoice.shipment.parcels as Array<{ actualWeightKg: number }>;

    assert.equal(invoice.revision, 1);
    assert.equal(invoice.isLatest, false);
    assert.equal(invoice.totalAmountMinor, 11_800);
    assert.equal(invoice.advanceAppliedMinor, 5_000);
    assert.equal(invoice.creditOutstandingMinor, 6_800);
    assert.equal(invoice.paymentStatus, "PARTIALLY_PAID");
    assert.equal(parcels[0]?.actualWeightKg, 10);
  });

  test("rejects a revision that does not belong to the shipment invoice", () => {
    assert.throws(
      () => serializeShipmentInvoice(invoiceWithAmendment(), 3),
      /Invoice revision not found/
    );
  });

  test("preserves the amended allocation when a draft invoice refreshes", () => {
    const allocation = resolveShipmentInvoicePaymentAllocation({
      totalAmountMinor: 472_000,
      existingAllocation: { advanceAppliedMinor: 0, creditOutstandingMinor: 472_000 },
      reservationAllocation: { advanceAmountMinor: 0, creditAmountMinor: 389_400 }
    });

    assert.deepEqual(allocation, {
      advanceAppliedMinor: 0,
      creditOutstandingMinor: 472_000
    });
  });
});
