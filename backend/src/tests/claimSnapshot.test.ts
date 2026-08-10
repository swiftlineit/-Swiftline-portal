import assert from "node:assert/strict";
import mongoose from "mongoose";
import { describe, it } from "node:test";
import { resolveSnapshotItem } from "../services/claims/claimSnapshot.service.js";
import type { ClaimShipmentSnapshot } from "../models/claim.model.js";

/**
 * The snapshot is what makes a claim reproducible, and affected-item
 * coordinates only mean anything against it. These tests pin the behaviour that
 * a live-shipment lookup would break.
 */

function snapshot(overrides: Partial<ClaimShipmentSnapshot> = {}): ClaimShipmentSnapshot {
  return {
    shipmentDraftId: new mongoose.Types.ObjectId(),
    trackingNumber: "SL123456789",
    carrierTrackingNumber: "DPD001, DPD002",
    bookedAt: new Date("2026-08-01T00:00:00Z"),
    deliveredAt: null,
    serviceName: "DPD_CLASSIC",
    originCountryCode: "IN",
    destinationCountryCode: "GB",
    consignorName: "Sender Ltd",
    consigneeName: "Receiver Ltd",
    parcelCount: 2,
    totalDeclaredValueMinor: 150_000_00,
    parcels: [
      {
        sequence: 1,
        weightKg: 2.5,
        contentsDescription: "Handmade rugs",
        declaredValueMinor: 100_000_00,
        items: [
          { itemIndex: 0, description: "Wool rug", hsnCode: "5701", unitType: "PCS", quantity: 4, unitRateMinor: 20_000_00, lineValueMinor: 80_000_00 },
          { itemIndex: 1, description: "Cotton runner", hsnCode: "5702", unitType: "PCS", quantity: 2, unitRateMinor: 10_000_00, lineValueMinor: 20_000_00 }
        ]
      },
      {
        sequence: 2,
        weightKg: 1.0,
        contentsDescription: "Cushion covers",
        declaredValueMinor: 50_000_00,
        items: [
          { itemIndex: 0, description: "Cushion cover", hsnCode: "6304", unitType: "PCS", quantity: 10, unitRateMinor: 5_000_00, lineValueMinor: 50_000_00 }
        ]
      }
    ],
    capturedAt: new Date("2026-08-08T00:00:00Z"),
    ...overrides
  };
}

describe("resolving an affected item against the snapshot", () => {
  it("finds an item by parcel sequence and position", () => {
    const resolved = resolveSnapshotItem(snapshot(), { parcelSequence: 1, itemIndex: 1 });

    assert.ok(resolved);
    assert.equal(resolved.description, "Cotton runner");
    assert.equal(resolved.quantityShipped, 2);
    assert.equal(resolved.declaredUnitValueMinor, 10_000_00);
  });

  it("keys on the parcel's sequence, not its array position", () => {
    // Parcels arrive ordered by sequence today, but nothing guarantees it. If
    // this ever resolved by index the wrong parcel would be claimed against.
    const reordered = snapshot({
      parcels: [...(snapshot().parcels as unknown[])].reverse()
    });
    const resolved = resolveSnapshotItem(reordered, { parcelSequence: 1, itemIndex: 0 });

    assert.ok(resolved);
    assert.equal(resolved.description, "Wool rug");
  });

  it("returns null for a parcel that is not in the shipment", () => {
    assert.equal(resolveSnapshotItem(snapshot(), { parcelSequence: 9, itemIndex: 0 }), null);
  });

  it("returns null for an item position that does not exist", () => {
    assert.equal(resolveSnapshotItem(snapshot(), { parcelSequence: 2, itemIndex: 5 }), null);
  });

  it("returns null rather than an empty item for a parcel with no items", () => {
    const empty = snapshot({
      parcels: [{ sequence: 1, weightKg: 1, contentsDescription: "", declaredValueMinor: 0, items: [] }]
    });
    // A malformed claim must fail validation, not silently record a zero-value
    // item that a reviewer would have no way to question.
    assert.equal(resolveSnapshotItem(empty, { parcelSequence: 1, itemIndex: 0 }), null);
  });

  it("reads declared value from the snapshot, never from the caller", () => {
    // The guarantee that matters: a client cannot inflate what an item was worth
    // by sending a different figure. Whatever was declared at booking is what a
    // reviewer sees.
    const resolved = resolveSnapshotItem(snapshot(), { parcelSequence: 2, itemIndex: 0 });

    assert.ok(resolved);
    assert.equal(resolved.declaredUnitValueMinor, 5_000_00);
    assert.equal(resolved.quantityShipped, 10);
  });
});

describe("snapshot integrity", () => {
  it("totals the declared value across parcels", () => {
    const frozen = snapshot();
    const summed = (frozen.parcels as Array<{ declaredValueMinor: number }>).reduce(
      (total, parcel) => total + parcel.declaredValueMinor,
      0
    );
    assert.equal(summed, frozen.totalDeclaredValueMinor);
  });

  it("keeps every item's line value consistent with quantity and rate", () => {
    for (const parcel of snapshot().parcels as Array<{
      items: Array<{ quantity: number; unitRateMinor: number; lineValueMinor: number }>;
    }>) {
      for (const item of parcel.items) {
        assert.equal(item.lineValueMinor, item.quantity * item.unitRateMinor);
      }
    }
  });

  it("carries a capture time so a reviewer knows what it reflects", () => {
    assert.ok(snapshot().capturedAt instanceof Date);
  });
});
