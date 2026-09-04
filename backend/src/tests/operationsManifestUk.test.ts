import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import { OperationsManifest } from "../models/operationsManifest.model.js";
import type { ManifestDocumentConsignment } from "../types/manifestDocument.js";
import {
  buildOperationsManifestUkExcel,
  buildUkManifestEntries,
  convertInrMinorToGbpMinor,
  reconcileGbpMinorValues,
  uniqueUkDescriptionItems,
  ukManifestConfiguredEntryCount,
  ukOperationsManifestFilename
} from "../services/operationsManifestUk.service.js";
import {
  chooseOperationsBagForParcel,
  isOperationsBagWeightAllowed,
  UK_OPERATIONS_BAG_MAX_PIECES
} from "../services/operationsManifest.service.js";

function consignmentCandidate(number: number): ManifestDocumentConsignment {
  return {
    consignmentIndex: number - 1,
    consignmentNumber: `SLCDEL040926${String(number).padStart(3, "0")}-01`,
    formattedConsignmentNumber: `SLCDEL040926${String(number).padStart(3, "0")}-01`,
    declaredValueMinor: number * 100,
    currency: "INR",
    serviceInfo: "CARGO",
    consignor: { formatted: "", party: null },
    consignee: { formatted: "", party: null },
    shipmentDraftId: new mongoose.Types.ObjectId().toString(),
    dpdShipmentId: new mongoose.Types.ObjectId().toString(),
    parcels: []
  };
}

function ukManifestFixture(options: { bagCount?: number; consignmentCount?: number } = {}) {
  const bagCount = options.bagCount ?? 21;
  const consignmentCount = options.consignmentCount ?? 15;
  const bagDocuments = Array.from({ length: bagCount }, (_, index) => ({
    _id: new mongoose.Types.ObjectId(),
    sequence: index + 3,
    bagNumber: `SLC018${String(index + 1).padStart(2, "0")}`,
    totalPhysicalParcels: 2,
    totalWeightKg: index < 2 ? 31 : 30
  }));
  const consignments = Array.from({ length: consignmentCount }, (_, index) => ({
    ...consignmentCandidate(index + 1),
    bagId: bagDocuments[0]!._id,
    manifestPieces: 1 as const,
    weightKg: 0,
    consignorSnapshot: {
      formatted: "RAJ EXPORTS\nDELHI\n110001\nIN",
      party: {
        companyName: "Raj Exports",
        contactName: `Sender ${index + 1}`,
        addressLine1: "1 Export Road",
        addressLine2: "",
        city: "Delhi",
        state: "Delhi",
        postcode: "110001",
        countryCode: "IN",
        countryName: "India",
        phone: ""
      }
    },
    consigneeSnapshot: {
      formatted: "UK RECEIVER\nLONDON\nSW1A 1AA\nGB",
      party: {
        companyName: "UK Receiver",
        contactName: `Receiver ${index + 1}`,
        addressLine1: "1 London Road",
        addressLine2: "",
        city: "London",
        state: "",
        postcode: "SW1A 1AA",
        countryCode: "GB",
        countryName: "United Kingdom",
        phone: "447700900123"
      }
    },
    description: "CLOTHING AND PERSONAL EFFECTS",
    currency: "INR" as const,
    parcels: [] as Array<{
      parcelNumber: string;
      weightKg: number;
      description: string;
      bagNumber: string;
      valueMinor: number;
    }>
  }));

  bagDocuments.forEach((bag, bagIndex) => {
    const parcelWeights = bagIndex < 2 ? [15, 16] : [15, 15];
    parcelWeights.forEach((weightKg, parcelIndex) => {
      const owner = consignments[(bagIndex * 2 + parcelIndex) % consignments.length]!;
      owner.parcels.push({
        parcelNumber: `${bag.bagNumber}P${parcelIndex + 1}`,
        weightKg,
        description: parcelIndex === 0 ? "HONEY, CHOCOLATE" : "honey; RAKHI",
        bagNumber: bag.bagNumber,
        valueMinor: (bagIndex * 2 + parcelIndex + 1) * 100
      });
      owner.weightKg += weightKg;
    });
  });
  consignments.forEach((consignment) => {
    consignment.declaredValueMinor = consignment.parcels
      .reduce((sum, parcel) => sum + parcel.valueMinor, 0);
  });
  const totalPhysicalParcels = bagDocuments.reduce((sum, bag) => sum + bag.totalPhysicalParcels, 0);
  const totalWeightKg = bagDocuments.reduce((sum, bag) => sum + bag.totalWeightKg, 0);

  return new OperationsManifest({
    manifestNumber: "SLC018",
    branchId: new mongoose.Types.ObjectId(),
    header: {
      destinationAgent: "M/S SWIFTLINE CARGO LTD",
      destinationCountryCode: "GB",
      destinationCountryName: "United Kingdom",
      flightNumber: "WY-242",
      departureDate: "2026-09-04",
      mawbNumber: "910-1882-6846",
      originIataCode: "DEL",
      destinationIataCode: "LHR",
      valueType: "LV"
    },
    status: "SEALED",
    totalBags: bagCount,
    totalConsignments: consignmentCount,
    totalPhysicalParcels,
    totalWeightKg,
    createdBy: new mongoose.Types.ObjectId(),
    sealedSnapshot: {
      version: 3,
      manifestNumber: "SLC018",
      originAddress: "M/S SWIFTLINE CARGO AND EXPRESS\nLOGISTICS PRIVATE LTD",
      header: {
        destinationAgent: "M/S SWIFTLINE CARGO LTD",
        destinationCountryCode: "GB",
        destinationCountryName: "United Kingdom",
        flightNumber: "WY-242",
        departureDate: "2026-09-04",
        mawbNumber: "910-1882-6846",
        originIataCode: "DEL",
        destinationIataCode: "LHR",
        valueType: "LV"
      },
      branch: { _id: new mongoose.Types.ObjectId(), name: "Delhi", code: "DEL" },
      totals: {
        totalBags: bagCount,
        totalConsignments: consignmentCount,
        totalPhysicalParcels,
        totalWeightKg
      },
      bags: bagDocuments,
      consignments,
      sealedAt: "2026-09-04T10:00:00.000Z"
    }
  });
}

type MutableSealedSnapshot = {
  consignments: Array<{
    declaredValueMinor: number;
    parcels: Array<{ valueMinor: number | null }>;
  }>;
};

describe("UK operations manifest entry rules", () => {
  it("uses non-overlapping bag bands and extends the final band", () => {
    assert.deepEqual(
      [1, 10, 11, 14, 15, 18, 19, 24, 25, 34, 35, 49, 50, 64, 65, 85, 86, 100]
        .map(ukManifestConfiguredEntryCount),
      [1, 10, 11, 11, 13, 13, 15, 15, 18, 18, 20, 20, 26, 26, 33, 33, 34, 39]
    );
  });

  it("caps entries at the available unique real consignments", () => {
    const entries = buildUkManifestEntries({
      manifestNumber: "SLC018",
      totalBags: 21,
      totalPhysicalParcels: 42,
      totalWeightKg: 632,
      bags: Array.from({ length: 21 }, (_, index) => ({
        sequence: index + 1,
        bagNumber: `SLC018${String(index + 1).padStart(2, "0")}`,
        pieces: 2,
        weightGrams: index < 2 ? 31_000 : 30_000
      })),
      consignments: Array.from({ length: 12 }, (_, index) => consignmentCandidate(index + 1))
    });

    assert.equal(entries.length, 12);
    assert.equal(new Set(entries.map((entry) => entry.consignment.consignmentNumber)).size, 12);
    assert.deepEqual(entries.map((entry) => entry.bags.length), [2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1]);
    assert.equal(entries.reduce((sum, entry) => sum + entry.pieces, 0), 42);
    assert.equal(entries.reduce((sum, entry) => sum + entry.weightKg, 0), 632);
  });

  it("enforces 32 kg generally and five parcels when UK packing requests the cap", () => {
    assert.equal(isOperationsBagWeightAllowed(32), true);
    assert.equal(isOperationsBagWeightAllowed(32.001), false);
    assert.equal(chooseOperationsBagForParcel([{
      id: "bag-1",
      sequence: 1,
      status: "OPEN",
      totalWeightKg: 10,
      totalPhysicalParcels: 5
    }], 1, { maxPhysicalParcels: UK_OPERATIONS_BAG_MAX_PIECES }), null);

    const base = {
      manifestNumber: "SLC018",
      totalBags: 1,
      consignments: [consignmentCandidate(1)]
    };
    assert.throws(() => buildUkManifestEntries({
      ...base,
      totalPhysicalParcels: 6,
      totalWeightKg: 10,
      bags: [{ sequence: 1, bagNumber: "SLC01801", pieces: 6, weightGrams: 10_000 }]
    }), /between 1 and 5 parcels/);
    assert.throws(() => buildUkManifestEntries({
      ...base,
      totalPhysicalParcels: 1,
      totalWeightKg: 32.001,
      bags: [{ sequence: 1, bagNumber: "SLC01801", pieces: 1, weightGrams: 32_001 }]
    }), /exceeds the 32 kg bag limit/);
  });

  it("deduplicates combined parcel contents without losing distinct items", () => {
    assert.deepEqual(
      uniqueUkDescriptionItems(["HONEY, CHOCOLATE", "honey; RAKHI", "Chocolate\nCLOTHING"]),
      ["HONEY", "CHOCOLATE", "RAKHI", "CLOTHING"]
    );
  });
});

describe("CFL UK workbook", () => {
  it("removes unused template entry rows below the final UK entry", async () => {
    const bytes = await buildOperationsManifestUkExcel(
      ukManifestFixture({ bagCount: 3, consignmentCount: 5 }),
      { gbpToInr: 100 }
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("CFL Manifest Template");
    assert.ok(sheet);
    for (const row of [46, 56, 150]) {
      for (let column = 2; column <= 12; column += 1) {
        assert.equal(Object.keys(sheet.getCell(row, column).border ?? {}).length, 0);
      }
    }
  });

  it("preserves totals, converts values to GBP, and displays consecutive UK bag numbers", async () => {
    const sourceManifest = ukManifestFixture();
    const bytes = await buildOperationsManifestUkExcel(sourceManifest, { gbpToInr: 100 });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("CFL Manifest Template");
    assert.ok(sheet);
    assert.equal(sheet.getCell("B2").value, "Courier Manifest");
    // The supplied CFL workbook contains two placements of its single embedded image.
    assert.equal(sheet.getImages().length, 2);
    assert.deepEqual(
      Array.from({ length: 11 }, (_, index) => sheet.getCell(15, index + 2).value),
      ["S. No", "Consignment No. *", "Pieces *", "Weight (kg) *", "Consignor *", "Consignee *", "Description *", "Value *", "Currency *", "Bag No*", "Service Info"]
    );
    assert.equal(sheet.getCell("F3").value, "From *");
    assert.equal(sheet.getCell("G3").value, "To *");
    assert.equal(sheet.getCell("J3").value, "SLC018");
    assert.equal(sheet.getCell("J10").value, 21);
    assert.equal(sheet.getCell("J11").value, 632);

    const entryRows = Array.from({ length: 15 }, (_, index) => 16 + index * 10);
    const consignments = entryRows.map((row) => String(sheet.getCell(row, 3).value ?? ""));
    const bagReferences = entryRows.flatMap((row) => String(sheet.getCell(row, 11).value ?? "")
      .split(",").filter(Boolean));
    assert.equal(new Set(consignments).size, 15);
    assert.equal(new Set(bagReferences).size, 21);
    assert.deepEqual(bagReferences.map(Number).sort((left, right) => left - right),
      Array.from({ length: 21 }, (_, index) => index + 1));
    assert.equal(entryRows.reduce((sum, row) => sum + Number(sheet.getCell(row, 4).value), 0), 42);
    assert.equal(entryRows.reduce((sum, row) => sum + Number(sheet.getCell(row, 5).value), 0), 632);
    entryRows.forEach((row) => {
      const bags = String(sheet.getCell(row, 11).value).split(",").map(Number);
      const expectedGbp = bags.reduce((sum, bag) => sum + (4 * bag - 1), 0) / 100;
      assert.equal(sheet.getCell(row, 9).value, expectedGbp);
      assert.equal(sheet.getCell(row, 10).value, "GBP");
      assert.equal(sheet.getCell(row, 12).value, "EXP");
      const descriptions = Array.from({ length: 10 }, (_, offset) => String(sheet.getCell(row + offset, 8).value ?? ""))
        .join(" ").toUpperCase();
      assert.equal(descriptions.match(/HONEY/g)?.length, 1);
      assert.equal(descriptions.match(/CHOCOLATE/g)?.length, 1);
      assert.equal(descriptions.match(/RAKHI/g)?.length, 1);
    });
    assert.equal(entryRows.reduce((sum, row) => sum + Number(sheet.getCell(row, 9).value), 0), 9.03);
    assert.match(String(sheet.getCell(16, 11).value), /^\d+,\d+$/);
    assert.equal(sheet.getCell("B156").value, 15, "the entry block must extend beyond the demo template rows");
  });

  it("preserves legacy consignment totals when parcel-level values are absent", async () => {
    const sourceManifest = ukManifestFixture({ bagCount: 3, consignmentCount: 5 });
    const snapshot = sourceManifest.sealedSnapshot as unknown as MutableSealedSnapshot;
    snapshot.consignments.forEach((consignment) => {
      consignment.parcels.forEach((parcel) => { parcel.valueMinor = null; });
    });
    const bytes = await buildOperationsManifestUkExcel(sourceManifest, { gbpToInr: 100 });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("CFL Manifest Template");
    assert.ok(sheet);
    assert.equal([16, 26, 36]
      .reduce((sum, row) => sum + Math.round(Number(sheet.getCell(row, 9).value) * 100), 0), 21);
  });

  it("refuses an export when parcel values do not reconcile with source consignments", async () => {
    const sourceManifest = ukManifestFixture({ bagCount: 3, consignmentCount: 5 });
    const snapshot = sourceManifest.sealedSnapshot as unknown as MutableSealedSnapshot;
    snapshot.consignments[0]!.declaredValueMinor += 1;
    await assert.rejects(
      buildOperationsManifestUkExcel(sourceManifest, { gbpToInr: 100 }),
      /parcel values do not match the sealed consignment values/
    );
  });

  it("rounds INR minor units to GBP minor units", () => {
    assert.equal(convertInrMinorToGbpMinor(130_000, 117.5), 1_106);
    assert.equal(convertInrMinorToGbpMinor(100_000, 117.5), 851);
  });

  it("reconciles entry pennies to the exactly converted manifest total", () => {
    const values = reconcileGbpMinorValues([100, 100, 100], 6);
    assert.deepEqual(values, [17, 17, 16]);
    assert.equal(values.reduce((sum, value) => sum + value, 0), convertInrMinorToGbpMinor(300, 6));
  });

  it("uses the required UK filename", () => {
    assert.equal(ukOperationsManifestFilename("slc018"), "SLC018UKMANIFEST.xlsx");
  });
});
