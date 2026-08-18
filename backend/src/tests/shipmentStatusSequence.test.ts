import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowedOperationalStatuses,
  describeMissingPrerequisites,
  findMissingPrerequisites,
  formatShipmentEventLabel,
  isOperationalStatus
} from "../services/shipmentStatusSequence.service.js";
import { shipmentOperationalStatusValues } from "../models/shipmentEvent.model.js";

/** A shipment that has been booked but never scanned. */
const justBooked = ["SHIPMENT_BOOKED"];

describe("shipment status sequence", () => {
  it("lets a booked shipment take only the first rung", () => {
    assert.deepEqual(findMissingPrerequisites("PARCEL_COLLECTED", justBooked), []);
    assert.deepEqual(allowedOperationalStatuses(justBooked), ["PARCEL_COLLECTED"]);
  });

  it("blocks a jump past unrecorded steps and names every one of them", () => {
    assert.deepEqual(
      findMissingPrerequisites("FLIGHT_ASSIGNED", justBooked),
      ["PARCEL_COLLECTED", "WAREHOUSE_SCAN_IN", "EXPORT_CUSTOMS_CLEARED"]
    );
  });

  /**
   * The case the "every earlier step" rule was chosen for. A next-only rule
   * would leave this shipment stranded, because the step after its latest event
   * is FLIGHT_DEPARTED and the two genuine gaps could never be filled.
   */
  it("lets a shipment booked before the rule fill its gaps", () => {
    const withGap = ["SHIPMENT_BOOKED", "PARCEL_COLLECTED", "FLIGHT_ASSIGNED"];

    // The earliest gap opens first; the rest of the ladder stays shut behind it,
    // so a backfill is walked in the same order the parcel travelled.
    assert.deepEqual(findMissingPrerequisites("WAREHOUSE_SCAN_IN", withGap), []);
    assert.deepEqual(allowedOperationalStatuses(withGap), ["PARCEL_COLLECTED", "WAREHOUSE_SCAN_IN"]);
    assert.deepEqual(
      findMissingPrerequisites("EXPORT_CUSTOMS_CLEARED", withGap),
      ["WAREHOUSE_SCAN_IN"]
    );
    assert.deepEqual(
      findMissingPrerequisites("FLIGHT_DEPARTED", withGap),
      ["WAREHOUSE_SCAN_IN", "EXPORT_CUSTOMS_CLEARED"]
    );
  });

  it("still allows a status that is already recorded, so a repeat scan is not lost", () => {
    const collected = ["SHIPMENT_BOOKED", "PARCEL_COLLECTED"];
    assert.deepEqual(findMissingPrerequisites("PARCEL_COLLECTED", collected), []);
  });

  it("clears every rung once the whole ladder is walked in order", () => {
    const recorded: string[] = ["SHIPMENT_BOOKED"];

    for (const status of shipmentOperationalStatusValues) {
      assert.deepEqual(
        findMissingPrerequisites(status, recorded),
        [],
        `${status} should be reachable once everything before it is recorded`
      );
      recorded.push(status);
    }

    assert.deepEqual(allowedOperationalStatuses(recorded), [...shipmentOperationalStatusValues]);
  });

  it("says nothing about statuses that are not on the ladder", () => {
    for (const offLadder of ["ON_HOLD", "RELEASED_FROM_HOLD", "SHIPMENT_CANCELLED", "IN_TRANSIT", "LOST"]) {
      assert.equal(isOperationalStatus(offLadder), false);
      assert.deepEqual(findMissingPrerequisites(offLadder, []), []);
    }
  });

  it("reads as a sentence for one missing step and for several", () => {
    assert.equal(
      describeMissingPrerequisites("WAREHOUSE_SCAN_IN", ["PARCEL_COLLECTED"]),
      "Warehouse Scan In cannot be recorded yet. Parcel Collected is still outstanding- "
        + "shipment progress must be recorded in order."
    );
    assert.equal(
      describeMissingPrerequisites("FLIGHT_ASSIGNED", [
        "PARCEL_COLLECTED",
        "WAREHOUSE_SCAN_IN",
        "EXPORT_CUSTOMS_CLEARED"
      ]),
      "Flight Assigned cannot be recorded yet. Parcel Collected, Warehouse Scan In and "
        + "Export Customs Cleared are still outstanding- shipment progress must be recorded in order."
    );
  });

  it("titles a status the way the timeline shows it", () => {
    assert.equal(formatShipmentEventLabel("IMPORT_CUSTOMS_CLEARANCE"), "Import Customs Clearance");
    assert.equal(formatShipmentEventLabel(""), "Shipment Created");
    assert.equal(formatShipmentEventLabel(null), "Shipment Created");
  });
});
