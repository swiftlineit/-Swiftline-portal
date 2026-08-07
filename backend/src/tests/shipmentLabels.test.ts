import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  formatSwiftlineParcelNumber,
  formatSwiftlineTrackingNumber,
  resolveStationCode
} from "../services/swiftlineTracking.service.js";
import {
  renderSimulatedDpdLabelPdf,
  renderSwiftlineLabelPdf,
  type ShipmentLabelData
} from "../services/shipmentLabelPdf.service.js";
import {
  bookingSnapshotToLabelData,
  buildRevisedShipmentSnapshot,
  buildShipmentBookingSnapshot,
  snapshotDeclaredGoodsValueMinor,
  serializeShipmentBookingConfirmation
} from "../services/shipmentBookingSnapshot.service.js";

function labelData(parcelNumber: string): ShipmentLabelData {
  return {
    swiftlineTrackingNumber: "SLCDEL200726001",
    parcelNumber,
    parcelIndex: 0,
    parcelCount: 1,
    weightKg: 12.5,
    serviceCode: "DPD_CLASSIC",
    shipmentReference: "SHIP-TEST-0001",
    generatedAt: new Date("2026-07-20T06:30:00.000Z"),
    consignee: {
      name: "Prime Minister & First Lord Of The Treasury",
      contactName: "Aman Negi J",
      addressLines: ["10 Downing Street", "London", "Greater London"],
      postcode: "SW1A 2AA",
      countryCode: "GB",
      countryName: "United Kingdom"
    },
    sender: {
      name: "Swiftline Cargo and Express Logistics Pvt. Ltd.",
      branchCode: "DEL-001",
      addressLines: ["New Delhi", "India"],
      phone: "+91 9999999999"
    }
  };
}

describe("shipment label numbering", () => {
  test("formats the approved Swiftline tracking number in India time", () => {
    const trackingNumber = formatSwiftlineTrackingNumber({
      stationCode: "DEL",
      date: new Date("2026-07-20T06:30:00.000Z"),
      sequence: 1
    });

    assert.equal(trackingNumber, "SLCDEL200726001");
    assert.equal(resolveStationCode(undefined, "DEL-001"), "DEL");
    assert.equal(formatSwiftlineTrackingNumber({
      stationCode: "DEL",
      date: new Date("2026-07-20T06:30:00.000Z"),
      sequence: 1000
    }), "SLCDEL2007261000");
  });

  test("uses stable piece suffixes for one or multiple parcels", () => {
    const trackingNumber = "SLCDEL200726001";
    assert.equal(formatSwiftlineParcelNumber(trackingNumber, 0), `${trackingNumber}-01`);
    assert.equal(formatSwiftlineParcelNumber(trackingNumber, 1), `${trackingNumber}-02`);
  });
});

// A PDF declares its page size in the MediaBox, which is the only part of the
// file readable without decompressing the content stream.
function readPageSize(pdf: Buffer): number[] {
  const mediaBox = /MediaBox\s*\[([^\]]+)\]/.exec(pdf.toString("latin1"));

  assert.ok(mediaBox?.[1], "label PDF should declare a page size");

  return mediaBox[1].trim().split(/\s+/).map(Number);
}

describe("shipment label PDFs", () => {
  test("renders the internal label on label stock, not an A6 sheet", async () => {
    const pdf = await renderSwiftlineLabelPdf(labelData("SLCDEL200726001-01"));
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    assert.ok(pdf.length > 2_000);

    // The page is sized to its content: a barcode and the parcel number. The
    // old A6 page (283 x 425 pt) was mostly blank, which wasted label stock and
    // left the barcode small on the roll.
    const mediaBox = /MediaBox\s*\[([^\]]+)\]/.exec(pdf.toString("latin1"));
    assert.ok(mediaBox, "label PDF should declare a page size");

    const [, , pageWidth, pageHeight] = readPageSize(pdf);
    assert.equal(pageWidth, 200);
    assert.equal(pageHeight, 84);
  });

  test("shrinks the parcel number rather than wrapping or clipping it", async () => {
    // Parcel numbers vary in length; a wrapped or truncated one is unreadable
    // next to the barcode it labels, so the whole thing must stay on one line.
    const long = await renderSwiftlineLabelPdf(labelData("SLCGURGAON01082600199-1234"));
    const short = await renderSwiftlineLabelPdf(labelData("SLC-01"));

    for (const pdf of [long, short]) {
      const [, , pageWidth, pageHeight] = readPageSize(pdf);

      // Length must not change the label's footprint.
      assert.equal(pageWidth, 200);
      assert.equal(pageHeight, 84);
    }
  });

  test("renders a non-empty simulated DPD PDF", async () => {
    const pdf = await renderSimulatedDpdLabelPdf(labelData("DPDTESTDL2007202600000101"));
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    assert.ok(pdf.length > 2_000);
  });
});

describe("immutable multi-parcel booking snapshot", () => {
  test("keeps charges, references, weights and one label identity per parcel aligned", () => {
    const draft = {
      serviceType: "COURIER",
      consigneeEnteredAddress: {
        companyName: "Example Retail Ltd",
        contactName: "Asha Patel",
        countryCode: "GB",
        countryName: "United Kingdom",
        postcode: "SW1A 2AA",
        addressLine1: "10 Downing Street",
        townOrCity: "London",
        county: "Greater London"
      },
      consigneeValidatedAddress: null,
      parcelList: [
        { sequence: 1, weightKg: 7, lengthCm: 30, widthCm: 20, heightCm: 10, shipmentContentType: "PARCEL", items: [{ description: "Clothing", hsnCode: "62034200", unitType: "Pkt", quantity: 2, unitRate: 150 }], contentsDescription: "Clothing", shipmentReference1: "BOX-A" },
        { sequence: 2, weightKg: 11, lengthCm: 40, widthCm: 30, heightCm: 20, shipmentContentType: "PARCEL", items: [{ description: "Shoes", hsnCode: "64039900", unitType: "Pair", quantity: 3, unitRate: 200 }], contentsDescription: "Shoes", shipmentReference1: "BOX-B" }
      ]
    };
    const snapshot = buildShipmentBookingSnapshot({
      draft: draft as never,
      invoiceUpload: { invoiceNumber: "INV-1001", shipmentReference: "SHIP-1001" } as never,
      account: { _id: "account", accountId: "BA-1001", contact: {}, company: {} } as never,
      branch: {
        _id: "branch",
        name: "Swiftline Delhi",
        code: "DEL-001",
        gstin: "09BIQPK8904E1ZW",
        baseCurrency: "INR",
        address: { address: "New Delhi", city: "Delhi", countryName: "India" },
        contact: { phone: "+91 9999999999" }
      } as never,
      pricing: {
        parcels: [
          { sequence: 1, actualWeightKg: 7, volumetricWeightKg: 1.2, chargeableWeightKg: 7, rateCardId: "rate-1", rateFromKg: 5.01, rateToKg: 10, chargesPerKg: 200, maxBoxKg: 25, baseAmount: 1400, exceedsMaxBoxKg: false },
          { sequence: 2, actualWeightKg: 11, volumetricWeightKg: 4.8, chargeableWeightKg: 11, rateCardId: "rate-2", rateFromKg: 10.01, rateToKg: 20, chargesPerKg: 180, maxBoxKg: 25, baseAmount: 1980, exceedsMaxBoxKg: false }
        ],
        freightAmount: 3380,
        fuelSurchargeAmount: 0,
        remoteAreaAmount: 0,
        remoteAreaApplied: false,
        csbType: "CSB_IV" as const,
        csbClearanceAmount: 0,
        handlingAmount: 0,
        insuranceAmount: 0,
        insuranceApplied: false,
        declaredGoodsValue: 0,
        discountAmount: 0,
        baseAmount: 3380,
        gstAmount: 608.4,
        totalAmount: 3988.4,
        missingRate: false,
        exceedsMaxBoxKg: false,
        gstRate: 0.18,
        lines: [],
        pricingBasis: { rateCardIds: [], routeChargesUpdatedAt: null }
      },
      serviceCode: "DPD_CLASSIC",
      bookedAt: new Date("2026-07-20T06:30:00.000Z"),
       swiftlineTrackingNumber: "SLCDEL200726001",
       carrierShipmentId: "TEST-SLCDEL200726001",
       carrierTransactionId: "SIM-SLCDEL200726001",
      carrierParcelNumbers: ["DPD-BOX-1", "DPD-BOX-2"],
      providerMode: "SIMULATED",
      advanceAmountMinor: 100000,
      creditAmountMinor: 298840
    });

    const mutableFirstParcel = draft.parcelList[0];
    assert.ok(mutableFirstParcel);
    mutableFirstParcel.weightKg = 99;
    assert.equal(snapshot.parcels[0]?.actualWeightKg, 7);
    assert.deepEqual(snapshot.parcels.map((parcel) => parcel.swiftlineParcelNumber), [
      "SLCDEL200726001-01",
      "SLCDEL200726001-02"
    ]);
    assert.deepEqual(snapshot.parcels.map((parcel) => parcel.items?.[0]?.unitType), ["Pkt", "Pair"]);
    assert.deepEqual(snapshot.parcels.map((parcel) => parcel.declaredGoodsValueMinor), [30_000, 60_000]);
    assert.equal(snapshotDeclaredGoodsValueMinor(snapshot), 90_000);

    const firstDpdLabel = bookingSnapshotToLabelData(snapshot, 0, "DPD");
    const secondSwiftlineLabel = bookingSnapshotToLabelData(snapshot, 1, "SWIFTLINE");
    assert.equal(firstDpdLabel.parcelNumber, "DPD-BOX-1");
    assert.equal(firstDpdLabel.consignee.contactName, "Asha Patel");
    assert.equal(firstDpdLabel.customerReference, "BOX-A");
    assert.equal(firstDpdLabel.weightKg, 7);
    assert.equal(secondSwiftlineLabel.parcelNumber, "SLCDEL200726001-02");
    assert.equal(secondSwiftlineLabel.customerReference, "BOX-B");
    assert.equal(secondSwiftlineLabel.weightKg, 11);

    assert.deepEqual(serializeShipmentBookingConfirmation(snapshot), {
      swiftlineTrackingNumber: "SLCDEL200726001",
      carrierShipmentId: "TEST-SLCDEL200726001",
      providerMode: "SIMULATED",
      shipmentReference: "SHIP-1001",
      customerReference: "BOX-A",
      serviceType: "COURIER",
      serviceCode: "DPD_CLASSIC",
      parcelCount: 2,
      totalActualWeightKg: 18,
      baseAmountMinor: 338000,
      gstAmountMinor: 60840,
      totalAmountMinor: 398840,
      advanceAmountMinor: 100000,
      creditAmountMinor: 298840
    });

    const revisedSnapshot = buildRevisedShipmentSnapshot({
      previousSnapshot: snapshot,
      draft: {
        ...draft,
        serviceType: "CARGO",
        parcelList: [
          { ...draft.parcelList[0], weightKg: 8, shipmentReference1: "BOX-A-UPDATED" },
          { ...draft.parcelList[1], weightKg: 12 }
        ]
      } as never,
      pricing: {
        ...snapshot.pricing,
        baseAmount: 3600,
        gstAmount: 648,
        totalAmount: 4248
      },
      advanceAmountMinor: 120000,
      creditAmountMinor: 304800
    });

    assert.equal(snapshot.service.type, "COURIER");
    assert.equal(snapshot.parcels[0]?.actualWeightKg, 7);
    assert.equal(revisedSnapshot.service.type, "CARGO");
    assert.equal(revisedSnapshot.parcels[0]?.actualWeightKg, 8);
    assert.equal(revisedSnapshot.parcels[0]?.reference, "BOX-A-UPDATED");
    assert.equal(revisedSnapshot.parcels[0]?.carrierParcelNumber, "DPD-BOX-1");
    assert.equal(revisedSnapshot.parcels[0]?.declaredGoodsValueMinor, 30_000);
    assert.equal(revisedSnapshot.payment.totalAmountMinor, 424800);
    assert.equal(revisedSnapshot.payment.advanceAmountMinor, 120000);
    assert.equal(revisedSnapshot.payment.creditAmountMinor, 304800);
  });
});
