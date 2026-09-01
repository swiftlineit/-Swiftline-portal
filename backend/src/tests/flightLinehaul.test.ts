import assert from "node:assert/strict";
import test from "node:test";
import {
  flightAllocationParcelDetails,
  remainingFlightAllocationTotals
} from "../services/flightLinehaul.service.js";

function bookingSnapshot() {
  return {
    version: 1,
    source: { invoiceNumber: "INV-1", shipmentReference: "REF-1" },
    tracking: {
      swiftlineTrackingNumber: "SLC001",
      carrierShipmentId: "DPD-1",
      carrierTransactionId: "TX-1"
    },
    payment: { currency: "INR", totalAmountMinor: 100, advanceAmountMinor: 100, creditAmountMinor: 0 },
    parcels: [
      { sequence: 1, swiftlineParcelNumber: "PKG-1", carrierParcelNumber: "C-1", actualWeightKg: 2 },
      { sequence: 2, swiftlineParcelNumber: "PKG-2", carrierParcelNumber: "C-2", actualWeightKg: 5 }
    ],
    pricing: {
      parcels: [
        { sequence: 1, actualWeightKg: 2, volumetricWeightKg: 3, chargeableWeightKg: 3 },
        { sequence: 2, actualWeightKg: 5, volumetricWeightKg: 2, chargeableWeightKg: 5 }
      ]
    }
  };
}

test("flight allocation exposes actual, volumetric and chargeable weight per parcel", () => {
  assert.deepEqual(flightAllocationParcelDetails(bookingSnapshot()), [
    { parcelNumber: "PKG-1", actualWeightKg: 2, volumetricWeightKg: 3, chargeableWeightKg: 3 },
    { parcelNumber: "PKG-2", actualWeightKg: 5, volumetricWeightKg: 2, chargeableWeightKg: 5 }
  ]);
});

test("remaining flight totals exclude only the selected offloaded parcels", () => {
  const parcels = flightAllocationParcelDetails(bookingSnapshot());
  assert.deepEqual(remainingFlightAllocationTotals(parcels, ["PKG-2"]), {
    actualWeightKg: 5,
    volumetricWeightKg: 2,
    chargeableWeightKg: 5,
    pieces: 1
  });
  assert.deepEqual(remainingFlightAllocationTotals(parcels, []), {
    actualWeightKg: 0,
    volumetricWeightKg: 0,
    chargeableWeightKg: 0,
    pieces: 0
  });
});

test("chargeable weight falls back to the greater physical measure when absent", () => {
  const snapshot = bookingSnapshot() as { pricing: { parcels: Array<Record<string, unknown>> } };
  delete snapshot.pricing.parcels[0]!.chargeableWeightKg;
  assert.equal(flightAllocationParcelDetails(snapshot)[0]?.chargeableWeightKg, 3);
});
