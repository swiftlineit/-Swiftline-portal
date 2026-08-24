import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bulkSelectionBlockReason,
  statusUpdateBlockReason
} from "../services/bulkShipmentStatus.service.js";

describe("bulk shipment status blocking", () => {
  it("skips a draft with no booking", () => {
    assert.deepEqual(statusUpdateBlockReason({
      shipmentExists: false,
      cancellationStatus: undefined,
      onHold: false,
      missingPrerequisites: [],
      status: "PARCEL_COLLECTED"
    }), { reason: "Shipment is not booked." });
  });

  it("skips a cancelled shipment and names whether the cancellation completed", () => {
    assert.deepEqual(statusUpdateBlockReason({
      shipmentExists: true,
      cancellationStatus: "COMPLETED",
      onHold: false,
      missingPrerequisites: [],
      status: "READY_FOR_EXPORT"
    }), { reason: "Shipment has been cancelled and its progress cannot be updated." });

    assert.deepEqual(statusUpdateBlockReason({
      shipmentExists: true,
      cancellationStatus: "REQUESTED",
      onHold: false,
      missingPrerequisites: [],
      status: "READY_FOR_EXPORT"
    }), { reason: "Resolve the pending shipment cancellation before updating shipment progress." });
  });

  it("skips a shipment that is on hold", () => {
    assert.deepEqual(statusUpdateBlockReason({
      shipmentExists: true,
      cancellationStatus: undefined,
      onHold: true,
      missingPrerequisites: [],
      status: "READY_FOR_EXPORT"
    }), { reason: "Release the shipment before updating its status." });
  });

  it("skips a jump past unrecorded steps and returns the missing ones", () => {
    assert.deepEqual(statusUpdateBlockReason({
      shipmentExists: true,
      cancellationStatus: undefined,
      onHold: false,
      missingPrerequisites: ["WAREHOUSE_SCAN_IN", "ORIGIN_HUB_PROCESSED"],
      status: "READY_FOR_EXPORT"
    }), {
      reason: "Ready For Export cannot be recorded yet. Warehouse Scan In and Origin Hub Processed "
        + "are still outstanding- shipment progress must be "
        + "recorded in order.",
      missingStatuses: ["WAREHOUSE_SCAN_IN", "ORIGIN_HUB_PROCESSED"]
    });
  });

  it("skips a milestone that was already recorded", () => {
    const recordedAt = new Date("2026-08-22T07:09:00.000Z");
    const blocked = statusUpdateBlockReason({
      shipmentExists: true,
      cancellationStatus: undefined,
      onHold: false,
      alreadyRecordedAt: recordedAt,
      missingPrerequisites: [],
      status: "PARCEL_COLLECTED"
    });
    assert.match(blocked?.reason ?? "", /already recorded/);
    assert.match(blocked?.reason ?? "", /Refresh the shipment/);
  });

  // Final weight verification is an optional correction, not a precondition, so
  // a parcel arriving at the hub is never held up waiting to be re-weighed.
  /**
   * One date is stated for the whole batch, but each shipment's own history
   * decides whether it can take it- a shipment already scanned later than the
   * stated time is skipped and told why, while the rest of the batch goes on.
   */
  it("skips a shipment whose own history rules out the stated date", () => {
    assert.deepEqual(statusUpdateBlockReason({
      shipmentExists: true,
      cancellationStatus: undefined,
      onHold: false,
      missingPrerequisites: [],
      eventDateProblem: "A status date cannot be in the future. "
        + "Leave it empty to record this update as happening now.",
      status: "READY_FOR_EXPORT"
    }), {
      reason: "A status date cannot be in the future. "
        + "Leave it empty to record this update as happening now."
    });
  });

  it("lets Warehouse Scan In through without a verified charge", () => {
    assert.equal(statusUpdateBlockReason({
      shipmentExists: true,
      cancellationStatus: undefined,
      onHold: false,
      missingPrerequisites: [],
      status: "WAREHOUSE_SCAN_IN"
    }), null);
  });

  it("lets a shipment through when every gate is clear", () => {
    assert.equal(statusUpdateBlockReason({
      shipmentExists: true,
      cancellationStatus: undefined,
      onHold: false,
      missingPrerequisites: [],
      status: "ORIGIN_HUB_DISPATCHED"
    }), null);
  });
});
describe("bulk selection blocking", () => {
  it("refuses a selection that spans two stages", () => {
    assert.equal(
      bulkSelectionBlockReason(["SHIPMENT_BOOKED", "PARCEL_COLLECTED"], "PARCEL_COLLECTED"),
      "A bulk update covers shipments that are all at the same stage. "
        + "This selection mixes Parcel Collected, Shipment Booked. "
        + "Narrow it to shipments that share one current status and update each group separately."
    );
  });

  it("names every stage the selection spans, not only the first two", () => {
    const reason = bulkSelectionBlockReason(
      ["SHIPMENT_BOOKED", "PARCEL_COLLECTED", "WAREHOUSE_SCAN_IN"],
      "READY_FOR_EXPORT"
    );
    assert.match(String(reason), /Parcel Collected, Shipment Booked, Warehouse Scan In/);
  });

  it("refuses a batch whose target is the stage every shipment already holds", () => {
    assert.equal(
      bulkSelectionBlockReason(["PARCEL_COLLECTED", "PARCEL_COLLECTED"], "PARCEL_COLLECTED"),
      "Every selected shipment is already at Parcel Collected. "
        + "Choose the stage they should move to next."
    );
  });

  it("allows one uniform stage moving forward", () => {
    assert.equal(bulkSelectionBlockReason(["SHIPMENT_BOOKED", "SHIPMENT_BOOKED"], "PARCEL_COLLECTED"), null);
    assert.equal(bulkSelectionBlockReason(["PARCEL_COLLECTED"], "WAREHOUSE_SCAN_IN"), null);
  });

  it("allows a selection with nothing bookable in it, leaving those as per-shipment skips", () => {
    assert.equal(bulkSelectionBlockReason([], "PARCEL_COLLECTED"), null);
  });
});
