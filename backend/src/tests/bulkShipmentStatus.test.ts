import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { statusUpdateBlockReason } from "../services/bulkShipmentStatus.service.js";

describe("bulk shipment status blocking", () => {
  it("skips a draft with no booking", () => {
    assert.deepEqual(statusUpdateBlockReason({
      shipmentExists: false,
      cancellationStatus: undefined,
      onHold: false,
      missingPrerequisites: [],
      needsChargeVerification: false,
      chargeVerified: false,
      status: "PARCEL_COLLECTED"
    }), { reason: "Shipment is not booked." });
  });

  it("skips a cancelled shipment and names whether the cancellation completed", () => {
    assert.deepEqual(statusUpdateBlockReason({
      shipmentExists: true,
      cancellationStatus: "COMPLETED",
      onHold: false,
      missingPrerequisites: [],
      needsChargeVerification: false,
      chargeVerified: false,
      status: "FLIGHT_ASSIGNED"
    }), { reason: "Shipment has been cancelled and its progress cannot be updated." });

    assert.deepEqual(statusUpdateBlockReason({
      shipmentExists: true,
      cancellationStatus: "REQUESTED",
      onHold: false,
      missingPrerequisites: [],
      needsChargeVerification: false,
      chargeVerified: false,
      status: "FLIGHT_ASSIGNED"
    }), { reason: "Resolve the pending shipment cancellation before updating shipment progress." });
  });

  it("skips a shipment that is on hold", () => {
    assert.deepEqual(statusUpdateBlockReason({
      shipmentExists: true,
      cancellationStatus: undefined,
      onHold: true,
      missingPrerequisites: [],
      needsChargeVerification: false,
      chargeVerified: false,
      status: "FLIGHT_ASSIGNED"
    }), { reason: "Release the shipment before updating its status." });
  });

  it("skips a jump past unrecorded steps and returns the missing ones", () => {
    assert.deepEqual(statusUpdateBlockReason({
      shipmentExists: true,
      cancellationStatus: undefined,
      onHold: false,
      missingPrerequisites: ["PARCEL_COLLECTED", "WAREHOUSE_SCAN_IN", "EXPORT_CUSTOMS_CLEARED"],
      needsChargeVerification: false,
      chargeVerified: false,
      status: "FLIGHT_ASSIGNED"
    }), {
      reason: "Flight Assigned cannot be recorded yet. Parcel Collected, Warehouse Scan In "
        + "and Export Customs Cleared are still outstanding- shipment progress must be "
        + "recorded in order.",
      missingStatuses: ["PARCEL_COLLECTED", "WAREHOUSE_SCAN_IN", "EXPORT_CUSTOMS_CLEARED"]
    });
  });

  it("gates Warehouse Scan In on a verified charge", () => {
    assert.deepEqual(statusUpdateBlockReason({
      shipmentExists: true,
      cancellationStatus: undefined,
      onHold: false,
      missingPrerequisites: [],
      needsChargeVerification: true,
      chargeVerified: false,
      status: "WAREHOUSE_SCAN_IN"
    }), { reason: "Verify the final shipment weight and charge before Warehouse Scan In." });

    assert.equal(statusUpdateBlockReason({
      shipmentExists: true,
      cancellationStatus: undefined,
      onHold: false,
      missingPrerequisites: [],
      needsChargeVerification: true,
      chargeVerified: true,
      status: "WAREHOUSE_SCAN_IN"
    }), null);
  });

  it("lets a shipment through when every gate is clear", () => {
    assert.equal(statusUpdateBlockReason({
      shipmentExists: true,
      cancellationStatus: undefined,
      onHold: false,
      missingPrerequisites: [],
      needsChargeVerification: false,
      chargeVerified: false,
      status: "FLIGHT_DEPARTED"
    }), null);
  });
});