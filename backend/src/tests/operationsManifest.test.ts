import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import mongoose from "mongoose";
import { OperationsManifest } from "../models/operationsManifest.model.js";
import { OperationsManifestConsignment } from "../models/operationsManifestConsignment.model.js";
import { OperationsManifestCounter } from "../models/operationsManifestCounter.model.js";
import { OperationsManifestScan } from "../models/operationsManifestScan.model.js";
import { OperationsManifestScanSession } from "../models/operationsManifestScanSession.model.js";
import { operationsBranchIds } from "../middleware/operationsBranchAccess.middleware.js";
import { normalizePortalRole } from "../utils/portalRole.js";
import {
  buildOperationsManifestExcel,
  buildOperationsManifestPdf,
  buildManifestDispatchIssues,
  buildManifestDispatchTrackingEvent,
  allocateOperationsManifestNumber,
  calculateScannedParcelWeight,
  chooseOperationsBagForParcel,
  formatOperationsBagNumber,
  formatOperationsManifestNumber,
  isOperationsBagWeightAllowed,
  OPERATIONS_MANIFEST_ORIGIN_ADDRESS,
  shouldReactivateTrailingOperationsBag,
  summarizeBagComposition,
  summarizeManifestDestinations
} from "../services/operationsManifest.service.js";

describe("operations manifest dispatch readiness", () => {
  const firstDraftId = new mongoose.Types.ObjectId();
  const secondDraftId = new mongoose.Types.ObjectId();
  const readyStatuses = [
    "WAREHOUSE_SCAN_IN",
    "ORIGIN_HUB_PROCESSED",
    "READY_FOR_EXPORT"
  ];
  const eventsFor = (shipmentDraftId: mongoose.Types.ObjectId, statuses: string[]) =>
    statuses.map((status, index) => ({ shipmentDraftId, status, eventAt: new Date(2026, 7, 22, 8, index) }));

  it("creates only the dispatch tracking milestone and carries no manifest IATA", () => {
    const event = buildManifestDispatchTrackingEvent({
      shipmentDraftId: firstDraftId,
      dpdShipmentId: new mongoose.Types.ObjectId(),
      manifestId: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
      dispatchedAt: new Date("2026-08-22T08:00:00.000Z")
    });

    assert.equal(event.status, "ORIGIN_HUB_DISPATCHED");
    assert.equal(event.location, "");
    assert.equal("gatewayCode" in event, false);
  });

  it("allows dispatch when every packed shipment has completed the origin steps", () => {
    assert.deepEqual(buildManifestDispatchIssues({
      consignments: [
        { shipmentDraftId: firstDraftId, consignmentNumber: "SLC-READY-01" },
        { shipmentDraftId: secondDraftId, consignmentNumber: "SLC-READY-02" }
      ],
      events: [
        ...eventsFor(firstDraftId, readyStatuses),
        ...eventsFor(secondDraftId, readyStatuses)
      ]
    }), []);
  });

  it("blocks the entire dispatch and names each shipment with missing milestones", () => {
    const issues = buildManifestDispatchIssues({
      consignments: [
        { shipmentDraftId: firstDraftId, consignmentNumber: "SLC-READY-01" },
        { shipmentDraftId: secondDraftId, consignmentNumber: "SLC-GAP-02" }
      ],
      events: [
        ...eventsFor(firstDraftId, readyStatuses),
        ...eventsFor(secondDraftId, ["WAREHOUSE_SCAN_IN"])
      ]
    });
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.reference, "SLC-GAP-02");
    assert.deepEqual(issues[0]?.missingStatuses, ["ORIGIN_HUB_PROCESSED", "READY_FOR_EXPORT"]);
  });

  it("blocks held and cancelled consignments before manifest mutation", () => {
    const issues = buildManifestDispatchIssues({
      consignments: [
        { shipmentDraftId: firstDraftId, consignmentNumber: "SLC-HOLD-01" },
        { shipmentDraftId: secondDraftId, consignmentNumber: "SLC-CANCEL-02" }
      ],
      events: [
        ...eventsFor(firstDraftId, readyStatuses),
        { shipmentDraftId: firstDraftId, status: "ON_HOLD", eventAt: new Date(2026, 7, 22, 9) },
        ...eventsFor(secondDraftId, readyStatuses)
      ],
      cancellations: [{ shipmentDraftId: secondDraftId, status: "COMPLETED" }]
    });
    assert.match(issues.find((issue) => issue.reference === "SLC-HOLD-01")?.reason ?? "", /on hold/);
    assert.match(issues.find((issue) => issue.reference === "SLC-CANCEL-02")?.reason ?? "", /cancelled/);
  });

  it("also blocks a cancellation recorded only in shipment event history", () => {
    const issues = buildManifestDispatchIssues({
      consignments: [{ shipmentDraftId: firstDraftId, consignmentNumber: "SLC-CANCEL-EVENT" }],
      events: [
        ...eventsFor(firstDraftId, readyStatuses),
        { shipmentDraftId: firstDraftId, status: "SHIPMENT_CANCELLED", eventAt: new Date(2026, 7, 22, 10) }
      ]
    });
    assert.match(issues[0]?.reason ?? "", /cancelled/);
  });
});

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

/** Three boxes of one shipment: 20 kg and 5 kg in bag 01, 19 kg in bag 02. */
function sealedMultiParcelManifest() {
  const manifest = sealedManifest();
  const snapshot = manifest.sealedSnapshot as Record<string, unknown>;
  const bagOne = new mongoose.Types.ObjectId();
  const bagTwo = new mongoose.Types.ObjectId();
  snapshot.bags = [{ _id: bagOne, bagNumber: "SLC00101" }, { _id: bagTwo, bagNumber: "SLC00102" }];
  snapshot.totals = { totalBags: 2, totalConsignments: 1, totalPhysicalParcels: 3, totalWeightKg: 44 };
  const consignments = snapshot.consignments as Array<Record<string, unknown>>;
  const first = consignments[0];
  if (first) {
    first.bagId = bagOne;
    first.weightKg = 44;
    first.description = "Clothing, Footwear, Books";
    first.parcels = [
      { parcelNumber: "SLDL22072026000001P01", weightKg: 20, description: "Clothing", bagNumber: "SLC00101" },
      { parcelNumber: "SLDL22072026000001P02", weightKg: 19, description: "Footwear", bagNumber: "SLC00102" },
      { parcelNumber: "SLDL22072026000001P03", weightKg: 5, description: "Books", bagNumber: "SLC00101" }
    ];
  }
  return manifest;
}

async function manifestSheetRows(manifest: InstanceType<typeof OperationsManifest>) {
  const workbook = new ExcelJS.Workbook();
  const bytes = await buildOperationsManifestExcel(manifest);
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const sheet = workbook.getWorksheet("Manifest");
  assert.ok(sheet);
  return sheet;
}

describe("operations manifest safeguards", () => {
  // The export prints one row per parcel; each of those rows still counts as one piece.
  it("counts a consignment as a single piece regardless of how many boxes it holds", async () => {
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

  it("gives every parcel its own row, with its own weight, contents and bag number", async () => {
    const sheet = await manifestSheetRows(sealedMultiParcelManifest());
    const dataRows: Array<{ serial: unknown; weight: unknown; description: unknown; bag: unknown }> = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber <= 14) return;
      const serial = row.getCell(1).value;
      if (typeof serial === "number") {
        dataRows.push({ serial, weight: row.getCell(4).value, description: row.getCell(7).value, bag: row.getCell(10).value });
      }
    });

    assert.equal(dataRows.length, 3, "each of the three boxes needs its own row");
    assert.deepEqual(dataRows.map((row) => row.serial), [1, 2, 3]);
    assert.deepEqual(dataRows.map((row) => row.weight), [20, 19, 5]);
    // Each row describes only its own box, never the whole shipment.
    assert.deepEqual(dataRows.map((row) => row.description), ["Clothing", "Footwear", "Books"]);
    // The two boxes packed together must show the same bag number.
    assert.deepEqual(dataRows.map((row) => row.bag), ["SLC00101", "SLC00102", "SLC00101"]);
  });

  it("ends every parcel block on an empty line instead of a separator row", async () => {
    const sheet = await manifestSheetRows(sealedMultiParcelManifest());
    const serialRowNumbers: number[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber > 14 && typeof row.getCell(1).value === "number") serialRowNumbers.push(rowNumber);
    });

    assert.equal(serialRowNumbers.length, 3);
    const [first, second, third] = serialRowNumbers as [number, number, number];
    assert.equal(second - first, third - second, "parcel blocks must be evenly spaced");

    // The row closing each block carries no data in any column.
    for (const start of serialRowNumbers) {
      const closingRow = sheet.getRow(start + (second - first) - 1);
      for (let column = 1; column <= 11; column += 1) {
        const value = closingRow.getCell(column).value;
        assert.ok(value === null || value === undefined || value === "", `column ${column} must be blank on the closing line`);
      }
    }
  });

  it("splits one consignment across bags and charges each bag only its own parcels", () => {
    const bagOne = new mongoose.Types.ObjectId();
    const bagTwo = new mongoose.Types.ObjectId();
    const consignmentId = new mongoose.Types.ObjectId();
    const consignments = [{
      parcelWeightSnapshots: [
        { parcelNumber: "P01", weightKg: 20 },
        { parcelNumber: "P02", weightKg: 20 }
      ]
    }];
    // A 40 kg shipment cannot fit one 31 kg bag, but each 20 kg parcel fits its own.
    const composition = summarizeBagComposition([
      { bagId: bagOne, parcelNumber: "P01", consignmentId },
      { bagId: bagTwo, parcelNumber: "P02", consignmentId }
    ], consignments);

    assert.equal(composition.get(String(bagOne))?.weightKg, 20);
    assert.equal(composition.get(String(bagTwo))?.weightKg, 20);
    assert.equal(composition.get(String(bagOne))?.parcelCount, 1);
    assert.equal(composition.get(String(bagOne))?.consignmentIds.size, 1);
    assert.equal(isOperationsBagWeightAllowed(composition.get(String(bagOne))?.weightKg ?? 0), true);
  });

  it("rolls a parcel into a new bag instead of refusing it, unless the parcel alone is oversized", () => {
    const bagWeightKg = 30;
    const parcelWeightKg = 8;
    // The bag is full for this parcel, so packing must continue in a fresh bag.
    assert.equal(isOperationsBagWeightAllowed(bagWeightKg + parcelWeightKg), false);
    // The parcel itself fits a bag, so it is packed rather than rejected.
    assert.equal(isOperationsBagWeightAllowed(parcelWeightKg), true);
    // Only a parcel heavier than a whole bag can never be packed.
    assert.equal(isOperationsBagWeightAllowed(31.5), false);
  });

  it("automatically packs 10, 10, 20, 10 kg as Bag 01, 01, 02, 01", () => {
    const bags: Array<{ id: string; sequence: number; status: string; totalWeightKg: number }> = [
      { id: "bag-1", sequence: 1, status: "OPEN", totalWeightKg: 0 }
    ];
    const assignments = [10, 10, 20, 10].map((weight) => {
      let selected = chooseOperationsBagForParcel(bags, weight);
      if (!selected) {
        const next = { id: `bag-${bags.length + 1}`, sequence: bags.length + 1, status: "OPEN", totalWeightKg: 0 };
        bags.push(next);
        selected = next;
      }
      const bag = bags.find((item) => item.id === selected?.id);
      assert.ok(bag);
      bag.totalWeightKg += weight;
      return bag.sequence;
    });

    assert.deepEqual(assignments, [1, 1, 2, 1]);
    assert.deepEqual(bags.map((bag) => bag.totalWeightKg), [30, 20]);
  });

  it("keeps a shipment together before applying general best-fit", () => {
    const selected = chooseOperationsBagForParcel([
      { id: "bag-1", sequence: 1, status: "OPEN", totalWeightKg: 15, containsConsignment: false },
      { id: "bag-2", sequence: 2, status: "OPEN", totalWeightKg: 5, containsConsignment: true }
    ], 10);
    assert.equal(selected?.id, "bag-2");
  });

  it("reactivates only an empty cancelled trailing bag", () => {
    assert.equal(shouldReactivateTrailingOperationsBag("CANCELLED", false), true);
    assert.equal(shouldReactivateTrailingOperationsBag("CANCELLED", true), false);
    assert.equal(shouldReactivateTrailingOperationsBag("CLOSED", false), false);
  });

  it("summarizes mixed final countries without treating the MAWB route as a parcel restriction", () => {
    assert.deepEqual(summarizeManifestDestinations([
      { consigneeSnapshot: { party: { countryCode: "GB", countryName: "United Kingdom" } }, scannedParcelNumbers: ["GB-1", "GB-2"] },
      { consigneeSnapshot: { party: { countryCode: "PL", countryName: "Poland" } }, scannedParcelNumbers: ["PL-1"] }
    ]), [
      { countryCode: "PL", countryName: "Poland", consignments: 1, parcels: 1 },
      { countryCode: "GB", countryName: "United Kingdom", consignments: 1, parcels: 2 }
    ]);
  });

  it("counts every parcel packed into the same bag once, whatever consignment it belongs to", () => {
    const bagId = new mongoose.Types.ObjectId();
    const first = new mongoose.Types.ObjectId();
    const second = new mongoose.Types.ObjectId();
    const composition = summarizeBagComposition([
      { bagId, parcelNumber: "A01", consignmentId: first },
      { bagId, parcelNumber: "A02", consignmentId: first },
      { bagId, parcelNumber: "B01", consignmentId: second }
    ], [
      { parcelWeightSnapshots: [{ parcelNumber: "A01", weightKg: 5 }, { parcelNumber: "A02", weightKg: 5 }] },
      { parcelWeightSnapshots: [{ parcelNumber: "B01", weightKg: 6 }] }
    ]);

    assert.equal(composition.get(String(bagId))?.weightKg, 16);
    assert.equal(composition.get(String(bagId))?.parcelCount, 3);
    assert.equal(composition.get(String(bagId))?.consignmentIds.size, 2);
  });

  it("uses the flight sequence for bag numbering and adds only scanned parcel weight", async () => {
    // The bag number is the manifest number plus a two-digit bag suffix.
    assert.equal(formatOperationsManifestNumber(17), "SLC017");
    assert.equal(formatOperationsBagNumber("SLC012", 1), "SLC01201");
    assert.equal(formatOperationsBagNumber("SLC012", 12), "SLC01212");
    assert.equal(formatOperationsBagNumber("SLC017", 1), "SLC01701");
    const parcelWeights = [{ parcelNumber: "P01", weightKg: 5 }, { parcelNumber: "P02", weightKg: 5 }];
    assert.equal(calculateScannedParcelWeight({ scannedParcelNumbers: ["P01"], parcelWeightSnapshots: parcelWeights }), 5);
    assert.equal(calculateScannedParcelWeight({ scannedParcelNumbers: ["P01", "P02"], parcelWeightSnapshots: parcelWeights }), 10);

    assert.equal(isOperationsBagWeightAllowed(31), true);
    assert.equal(isOperationsBagWeightAllowed(31.001), false);
  });

  it("marks the counter update as an aggregation pipeline", async () => {
    const original = OperationsManifestCounter.findOneAndUpdate;
    let capturedOptions: { updatePipeline?: boolean } | undefined;
    (OperationsManifestCounter as any).findOneAndUpdate = (
      _filter: unknown,
      _update: unknown,
      options: { updatePipeline?: boolean },
    ) => {
      capturedOptions = options;
      return { exec: async () => ({ sequence: 17 }) };
    };

    try {
      assert.equal(await allocateOperationsManifestNumber(), "SLC017");
      assert.equal(capturedOptions?.updatePipeline, true);
    } finally {
      OperationsManifestCounter.findOneAndUpdate = original;
    }
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

  it("records camera scan provenance and protects active scanner sessions", async () => {
    const scan = new OperationsManifestScan({
      manifestId: new mongoose.Types.ObjectId(),
      bagId: new mongoose.Types.ObjectId(),
      parcelNumber: "SLDL22072026000001P01",
      scanRequestId: crypto.randomUUID(),
      status: "ACCEPTED",
      scanSource: "CAMERA",
      scanSessionId: new mongoose.Types.ObjectId(),
      message: "Parcel added.",
      scannedBy: new mongoose.Types.ObjectId()
    });
    await scan.validate();
    assert.equal(scan.scanSource, "CAMERA");

    const indexes = OperationsManifestScanSession.schema.indexes() as Array<[
      Record<string, number>,
      { unique?: boolean; partialFilterExpression?: Record<string, string>; expireAfterSeconds?: number }
    ]>;
    const activeSessionIndex = indexes.find(([, options]) => options.partialFilterExpression?.status === "ACTIVE");
    const purgeIndex = indexes.find(([fields]) => fields.purgeAt === 1);
    assert.equal(activeSessionIndex?.[1].unique, true);
    assert.deepEqual(activeSessionIndex?.[1].partialFilterExpression, { status: "ACTIVE" });
    assert.equal(purgeIndex?.[1].expireAfterSeconds, 0);
  });

  it("maps legacy roles to current ones and scopes operations users to assigned branches", () => {
    const firstBranch = new mongoose.Types.ObjectId();
    const secondBranch = new mongoose.Types.ObjectId();
    assert.equal(normalizePortalRole("staff"), "operations");
    assert.equal(normalizePortalRole("accounts"), "finance");
    assert.equal(normalizePortalRole("finance"), "finance");
    assert.deepEqual(operationsBranchIds({
      user: { _id: new mongoose.Types.ObjectId(), role: "operations", assignedBranches: [firstBranch, secondBranch] }
    } as never), [String(firstBranch), String(secondBranch)]);
    assert.equal(operationsBranchIds({
      user: { _id: new mongoose.Types.ObjectId(), role: "admin", assignedBranches: [] }
    } as never), null);
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

  it("renders the frozen Swiftline legal FROM block on v3 documents", async () => {
    const manifest = sealedManifest();
    const snapshot = manifest.sealedSnapshot as Record<string, unknown>;
    snapshot.version = 3;
    snapshot.originAddress = OPERATIONS_MANIFEST_ORIGIN_ADDRESS;
    const sheet = await manifestSheetRows(manifest);
    const values = sheet.getSheetValues().flat(3).filter(Boolean).join(" ");
    assert.match(values, /M\/S SWIFTLINE CARGO AND EXPRESS/);
    assert.match(values, /HARYANA-123401/);
  });
});
