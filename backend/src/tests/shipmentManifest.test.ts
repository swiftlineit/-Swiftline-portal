import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import type { IShipmentManifest } from "../models/shipmentManifest.model.js";
import {
  buildManifestLine,
  buildShipmentManifestWorkbook,
  formatManifestOrigin
} from "../services/shipmentManifest.service.js";
import type { ShipmentBookingSnapshot } from "../services/shipmentBookingSnapshot.service.js";

function bookingSnapshot(): ShipmentBookingSnapshot {
  return {
    version: 1,
    bookedAt: "2026-07-21T10:00:00.000Z",
    source: { invoiceNumber: "INV-001", shipmentReference: "SHIP-001" },
    account: {
      company: {
        companyName: "Example Exporter",
        registeredAddress: "1 Export Road",
        city: "Delhi",
        stateOrProvince: "Delhi",
        postalCode: "110001",
        addressCountry: "India"
      },
      contact: {
        title: "Mr.",
        firstName: "Ravi",
        lastName: "Sharma",
        countryCode: "+91",
        mobileNumber: "9000000000"
      }
    },
    sender: {
      name: "Swiftline Delhi",
      code: "DEL-001",
      address: {
        address: "1 Logistics Park",
        city: "Delhi",
        stateOrProvince: "Delhi",
        postalCode: "110001",
        countryName: "India"
      }
    },
    consignee: {
      companyName: "Example Consignee",
      contactName: "Asha Patel",
      mobileCountryCode: "+44",
      mobileNumber: "7123456789",
      addressLine1: "10 Downing Street",
      townOrCity: "London",
      postcode: "SW1A 2AA",
      countryCode: "GB",
      countryName: "United Kingdom"
    },
    service: { type: "COURIER", code: "DPD_CLASSIC" },
    tracking: {
      swiftlineTrackingNumber: "SLDL21072026000001",
      carrierShipmentId: "TEST-1",
      carrierTransactionId: "TX-1",
      providerMode: "SIMULATED"
    },
    parcels: [
      { sequence: 1, actualWeightKg: 4.5, contentsDescription: "Clothing", carrierParcelNumber: "P1", swiftlineParcelNumber: "S1" },
      { sequence: 2, actualWeightKg: 5.5, contentsDescription: "Documents", carrierParcelNumber: "P2", swiftlineParcelNumber: "S2" }
    ],
    pricing: {} as ShipmentBookingSnapshot["pricing"],
    payment: { currency: "INR", totalAmountMinor: 118000, advanceAmountMinor: 0, creditAmountMinor: 118000 }
  };
}

describe("shipment manifest workbook", () => {
  it("maps an immutable booking snapshot into one manifest line", () => {
    const line = buildManifestLine({
      shipmentDraftId: new mongoose.Types.ObjectId(),
      dpdShipmentId: new mongoose.Types.ObjectId(),
      snapshot: bookingSnapshot(),
      declaredValueMinor: 25_000_00,
      bagNumber: "BAG-01"
    });

    assert.equal(line.consignmentNumber, "SLDL21072026000001");
    assert.equal(line.pieces, 2);
    assert.equal(line.weightKg, 10);
    assert.equal(line.description, "Clothing, Documents");
    assert.equal(line.declaredValueMinor, 25_000_00);
    assert.equal(line.bagNumber, "BAG-01");
    assert.equal(line.serviceInfo, "EXP");
    assert.equal(line.consignor.formatted, "Example Exporter\nMr. Ravi Sharma\n1 Export Road\nDelhi\nDelhi\n110001\nIndia\nTEL-+919000000000");
    assert.equal(formatManifestOrigin(bookingSnapshot().sender), "Swiftline Delhi\n1 Logistics Park\nDelhi\nDelhi\n110001\nIndia");
  });

  it("creates a styled Excel manifest containing the header and shipment values", async () => {
    const line = buildManifestLine({
      shipmentDraftId: new mongoose.Types.ObjectId(),
      dpdShipmentId: new mongoose.Types.ObjectId(),
      snapshot: bookingSnapshot(),
      declaredValueMinor: 25_000_00,
      bagNumber: "BAG-01"
    });
    const manifest = {
      _id: new mongoose.Types.ObjectId(),
      manifestNumber: "SLC-001",
      businessAccountId: new mongoose.Types.ObjectId(),
      branchId: new mongoose.Types.ObjectId(),
      shipmentDraftIds: [line.shipmentDraftId],
      headerSnapshot: {
        originBranch: "Swiftline Delhi - DEL-001",
        originAddress: "Swiftline Delhi\n1 Logistics Park\nDelhi\nDelhi\n110001\nIndia",
        destinationAgent: "Swiftline UK",
        flightNumber: "EY-219",
        departureDate: "2026-07-21",
        mawbNumber: "607-54691055",
        originIataCode: "DEL",
        destinationIataCode: "LHR",
        valueType: "LV"
      },
      lineSnapshots: [line],
      totalPieces: 2,
      totalWeightKg: 10,
      totalBags: 1,
      actorRole: "admin",
      generatedAt: new Date("2026-07-21T10:00:00.000Z")
    } as unknown as IShipmentManifest;

    const workbook = new ExcelJS.Workbook();
    const workbookBytes = await buildShipmentManifestWorkbook(manifest);
    const workbookData = workbookBytes.buffer.slice(
      workbookBytes.byteOffset,
      workbookBytes.byteOffset + workbookBytes.byteLength
    ) as ArrayBuffer;
    await workbook.xlsx.load(workbookData);
    const sheet = workbook.getWorksheet("Manifest");
    assert.ok(sheet);
    assert.equal(sheet.getCell("A1").value, "Courier Manifest");
    assert.equal(sheet.getCell("E2").value, "FROM *");
    assert.equal(sheet.getCell("F2").value, "TO *");
    assert.equal(sheet.getCell("H2").value, "SLC-001");
    assert.equal(sheet.getCell("E3").value, "Swiftline Delhi");
    assert.equal(sheet.getCell("E4").value, "1 Logistics Park");
    assert.equal(sheet.getCell("B13").value, "SLDL21072026000001");
    assert.equal(sheet.getCell("C13").value, 2);
    assert.equal(sheet.getCell("D13").value, 10);
    assert.equal(sheet.getCell("E13").value, "Example Exporter");
    assert.equal(sheet.getCell("E14").value, "Mr. Ravi Sharma");
    assert.equal(sheet.getCell("E15").value, "1 Export Road");
    assert.equal(sheet.getCell("H13").value, 25000);
    assert.equal(sheet.getCell("J13").value, "BAG-01");
    assert.equal(sheet.getCell("K13").value, "EXP");
    assert.equal(sheet.autoFilter, undefined);
    assert.equal(sheet.views[0]?.state, "frozen");
    assert.equal(sheet.getCell("A1").font.bold, true);
    assert.equal(sheet.getCell("A12").font.bold, true);
  });
});
