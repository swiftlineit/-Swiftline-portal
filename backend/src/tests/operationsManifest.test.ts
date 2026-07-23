import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import { OperationsManifest } from "../models/operationsManifest.model.js";
import { OperationsManifestConsignment } from "../models/operationsManifestConsignment.model.js";
import { OperationsManifestScan } from "../models/operationsManifestScan.model.js";
import {
  buildOperationsManifestExcel,
  buildOperationsManifestPdf,
  calculateScannedParcelWeight,
  formatOperationsBagNumber,
  isOperationsBagWeightAllowed
} from "../services/operationsManifest.service.js";

function sealedManifest() {
  const manifestId = new mongoose.Types.ObjectId();
  const branchId = new mongoose.Types.ObjectId();
  const bagId = new mongoose.Types.ObjectId();
  return new OperationsManifest({
    _id: manifestId,
    manifestNumber: "SLCM262700001",
    branchId,
    header: {
      destinationAgent: "Swiftline UK\n14 Marwell Avenue\nUB4 0QR\nUnited Kingdom",
      destinationCountryCode: "GB",
      destinationCountryName: "United Kingdom",
      flightNumber: "EY-219",
      departureDate: "2026-07-25",
      mawbNumber: "607-54691055",
      originIataCode: "DEL",
      destinationIataCode: "LHR",
      valueType: "LV"
    },
    status: "SEALED",
    totalBags: 1,
    totalConsignments: 1,
    totalPhysicalParcels: 2,
    totalWeightKg: 10,
    createdBy: new mongoose.Types.ObjectId(),
    sealedSnapshot: {
      version: 1,
      manifestNumber: "SLCM262700001",
      header: {
        destinationAgent: "Swiftline UK\n14 Marwell Avenue\nUB4 0QR\nUnited Kingdom",
        destinationCountryCode: "GB", destinationCountryName: "United Kingdom", flightNumber: "EY-219",
        departureDate: "2026-07-25", mawbNumber: "607-54691055", originIataCode: "DEL", destinationIataCode: "LHR", valueType: "LV"
      },
      branch: { _id: branchId, name: "Swiftline Delhi", code: "DEL-001", address: { address: "1 Logistics Park", city: "Delhi", stateOrProvince: "Delhi", postalCode: "110001", countryName: "India" } },
      totals: { totalBags: 1, totalConsignments: 1, totalPhysicalParcels: 2, totalWeightKg: 10 },
      bags: [{ _id: bagId, bagNumber: "SLC00101" }],
      consignments: [{
        bagId, shipmentDraftId: new mongoose.Types.ObjectId(), dpdShipmentId: new mongoose.Types.ObjectId(),
        consignmentNumber: "SLDL22072026000001", manifestPieces: 1, weightKg: 10,
        consignorSnapshot: { formatted: "Example Exporter\nRavi Sharma\nDelhi\nIndia" },
        consigneeSnapshot: { formatted: "Example Consignee\nAsha Patel\nLondon\nUnited Kingdom" },
        description: "Clothing", declaredValueMinor: 25_000_00, currency: "INR", serviceInfo: "EXP"
      }],
      sealedAt: "2026-07-22T10:00:00.000Z"
    }
  });
}

describe("operations manifest safeguards", () => {
  it("keeps a multi-parcel consignment as one output row", async () => {
    const row = new OperationsManifestConsignment({
      manifestId: new mongoose.Types.ObjectId(), bagId: new mongoose.Types.ObjectId(), shipmentDraftId: new mongoose.Types.ObjectId(),
      dpdShipmentId: new mongoose.Types.ObjectId(), businessAccountId: new mongoose.Types.ObjectId(), consignmentNumber: "SLDL22072026000001",
      expectedParcelNumbers: ["SLDL22072026000001P01", "SLDL22072026000001P02"], scannedParcelNumbers: ["SLDL22072026000001P01"],
      parcelWeightSnapshots: [{ parcelNumber: "SLDL22072026000001P01", weightKg: 5 }, { parcelNumber: "SLDL22072026000001P02", weightKg: 5 }],
      manifestPieces: 1, weightKg: 10, status: "PARTIAL", consignorSnapshot: {}, consigneeSnapshot: {}, description: "Clothing", currency: "INR", serviceInfo: "EXP", dpdLabelGenerated: false
    });
    await row.validate();
    assert.equal(row.manifestPieces, 1);
    row.manifestPieces = 2 as 1;
    await assert.rejects(row.validate(), /manifestPieces/);
  });

  it("uses the flight sequence for bag numbering and adds only scanned parcel weight", async () => {
    assert.equal(formatOperationsBagNumber("SLCM262700012", 1), "SLC01201");
    const parcelWeights = [{ parcelNumber: "P01", weightKg: 5 }, { parcelNumber: "P02", weightKg: 5 }];
    assert.equal(calculateScannedParcelWeight({ scannedParcelNumbers: ["P01"], parcelWeightSnapshots: parcelWeights }), 5);
    assert.equal(calculateScannedParcelWeight({ scannedParcelNumbers: ["P01", "P02"], parcelWeightSnapshots: parcelWeights }), 10);

    assert.equal(isOperationsBagWeightAllowed(31), true);
    assert.equal(isOperationsBagWeightAllowed(31.001), false);
  });

  it("enforces idempotent scan request identifiers and active parcel uniqueness", () => {
    const indexes = OperationsManifestScan.schema.indexes() as Array<[
      Record<string, number>,
      { unique?: boolean; partialFilterExpression?: Record<string, string> }
    ]>;
    const requestIndex = indexes.find(([fields]) => fields.scanRequestId === 1);
    const parcelIndex = indexes.find(([fields]) => fields.parcelNumber === 1);
    assert.equal(requestIndex?.[1]?.unique, true);
    assert.equal(parcelIndex?.[1]?.unique, true);
    assert.deepEqual(parcelIndex?.[1]?.partialFilterExpression, { status: "ACCEPTED" });
  });

  it("renders sealed Excel and PDF files from the immutable snapshot", async () => {
    const manifest = sealedManifest();
    const bytes = await buildOperationsManifestExcel(manifest);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const sheet = workbook.getWorksheet("Manifest");
    assert.ok(sheet);
    const values = sheet.getSheetValues().flat(3).filter(Boolean).join(" ");
    assert.match(values, /SLCM262700001/);
    assert.match(values, /SLDL220720260001/);
    assert.match(values, /SLC00101/);
    assert.match(values, /Example Consignee/);
    const pdf = await buildOperationsManifestPdf(manifest);
    assert.ok(pdf.length > 1000);
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  });
});
