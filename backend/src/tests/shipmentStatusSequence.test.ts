import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allowedOperationalStatuses,
  describeAlreadyRecorded,
  describeEventDateProblem,
  describeMissingPrerequisites,
  findMissingPrerequisites,
  formatShipmentEventLabel,
  isOperationalStatus
} from "../services/shipmentStatusSequence.service.js";
import { ShipmentEvent, shipmentOperationalStatusValues } from "../models/shipmentEvent.model.js";

/** A shipment that has been booked but never scanned. */
const justBooked = ["SHIPMENT_BOOKED"];

describe("shipment status sequence", () => {
  it("defines a database uniqueness boundary for customer milestones", () => {
    const indexes = ShipmentEvent.schema.indexes() as Array<[
      Record<string, number>,
      { name?: string; unique?: boolean }
    ]>;
    const milestoneIndex = indexes.find(([, options]) =>
      options.name === "uniq_shipment_customer_milestone"
    );
    assert.ok(milestoneIndex);
    assert.equal(milestoneIndex[1].unique, true);
    assert.deepEqual(milestoneIndex[0], { shipmentDraftId: 1, milestoneKey: 1 });
  });

  it("lets a booked shipment record collection or enter directly at the hub", () => {
    assert.deepEqual(findMissingPrerequisites("PARCEL_COLLECTED", justBooked), []);
    assert.deepEqual(allowedOperationalStatuses(justBooked), ["PARCEL_COLLECTED", "WAREHOUSE_SCAN_IN"]);
  });

  it("blocks a jump past unrecorded steps and names every one of them", () => {
    assert.deepEqual(
      findMissingPrerequisites("READY_FOR_EXPORT", justBooked),
      ["WAREHOUSE_SCAN_IN", "ORIGIN_HUB_PROCESSED"]
    );
  });

  /**
   * The case the "every earlier step" rule was chosen for. A next-only rule
   * would leave this shipment stranded, because the step after its latest event
   * is ORIGIN_HUB_DISPATCHED and the genuine gaps could never be filled.
   */
  it("lets a shipment booked before the rule fill its gaps", () => {
    const withGap = ["SHIPMENT_BOOKED", "PARCEL_COLLECTED", "READY_FOR_EXPORT"];

    // The earliest gap opens first; the rest of the ladder stays shut behind it,
    // so a backfill is walked in the same order the parcel travelled.
    assert.deepEqual(findMissingPrerequisites("WAREHOUSE_SCAN_IN", withGap), []);
    assert.deepEqual(allowedOperationalStatuses(withGap), ["WAREHOUSE_SCAN_IN"]);
    assert.deepEqual(
      findMissingPrerequisites("ORIGIN_HUB_PROCESSED", withGap),
      ["WAREHOUSE_SCAN_IN"]
    );
    assert.deepEqual(
      findMissingPrerequisites("ORIGIN_HUB_DISPATCHED", withGap),
      ["WAREHOUSE_SCAN_IN", "ORIGIN_HUB_PROCESSED"]
    );
  });

  it("removes an already recorded milestone from the staff choices", () => {
    const collected = ["SHIPMENT_BOOKED", "PARCEL_COLLECTED"];
    assert.deepEqual(findMissingPrerequisites("PARCEL_COLLECTED", collected), []);
    assert.deepEqual(allowedOperationalStatuses(collected), ["WAREHOUSE_SCAN_IN"]);
    assert.match(describeAlreadyRecorded("PARCEL_COLLECTED"), /already recorded/);
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

    assert.deepEqual(allowedOperationalStatuses(recorded), []);
  });

  it("says nothing about statuses that are not on the ladder", () => {
    for (const offLadder of ["ON_HOLD", "RELEASED_FROM_HOLD", "SHIPMENT_CANCELLED", "IN_TRANSIT", "LOST"]) {
      assert.equal(isOperationalStatus(offLadder), false);
      assert.deepEqual(findMissingPrerequisites(offLadder, []), []);
    }
  });

  it("reads as a sentence for one missing step and for several", () => {
    assert.equal(
      describeMissingPrerequisites("ORIGIN_HUB_PROCESSED", ["WAREHOUSE_SCAN_IN"]),
      "Origin Hub Processed cannot be recorded yet. Warehouse Scan In is still outstanding- "
        + "shipment progress must be recorded in order."
    );
    assert.equal(
      describeMissingPrerequisites("READY_FOR_EXPORT", [
        "WAREHOUSE_SCAN_IN",
        "ORIGIN_HUB_PROCESSED"
      ]),
      "Ready For Export cannot be recorded yet. Warehouse Scan In and Origin Hub Processed "
        + "are still outstanding- shipment progress must be recorded in order."
    );
  });

  it("titles a status the way the timeline shows it", () => {
    assert.equal(formatShipmentEventLabel("IMPORT_CUSTOMS_CLEARANCE"), "Import Customs Clearance");
    assert.equal(formatShipmentEventLabel(""), "Shipment Created");
    assert.equal(formatShipmentEventLabel(null), "Shipment Created");
  });

  it("accepts historical export and flight events as aliases for the new flow", () => {
    const historical = [
      "SHIPMENT_BOOKED",
      "PARCEL_COLLECTED",
      "WAREHOUSE_SCAN_IN",
      "ORIGIN_HUB_PROCESSED",
      "EXPORT_CUSTOMS_CLEARED",
      "FLIGHT_DEPARTED"
    ];
    assert.deepEqual(findMissingPrerequisites("DESTINATION_ARRIVED", historical), []);
  });

  it("blocks out-for-delivery and delivered when partner milestones are missing", () => {
    const throughCustoms = [
      "WAREHOUSE_SCAN_IN",
      "ORIGIN_HUB_PROCESSED",
      "READY_FOR_EXPORT",
      "ORIGIN_HUB_DISPATCHED",
      "DESTINATION_ARRIVED",
      "IMPORT_CUSTOMS_CLEARANCE",
      "IMPORT_CUSTOMS_CLEARED"
    ];
    assert.deepEqual(findMissingPrerequisites("OUT_FOR_DELIVERY", throughCustoms), [
      "DELIVERY_PARTNER_TRANSFERRED",
      "DELIVERY_HUB_ARRIVED"
    ]);
    assert.deepEqual(findMissingPrerequisites("DELIVERED", [...throughCustoms, "DELIVERY_PARTNER_TRANSFERRED"]), [
      "DELIVERY_HUB_ARRIVED",
      "OUT_FOR_DELIVERY"
    ]);
  });
});

/**
 * The optional status date Operations may state instead of "now".
 *
 * Two limits, both about what the timeline reads like afterwards- see
 * describeEventDateProblem.
 */
describe("stated status date", () => {
  const now = new Date("2026-08-21T10:00:00.000Z");

  it("accepts a date between the last update and now", () => {
    assert.equal(
      describeEventDateProblem({
        eventAt: new Date("2026-08-20T09:00:00.000Z"),
        previousEventAt: new Date("2026-08-19T09:00:00.000Z"),
        now
      }),
      null
    );
  });

  it("accepts a shipment's first stated date, with nothing recorded before it", () => {
    assert.equal(
      describeEventDateProblem({ eventAt: new Date("2026-01-01T00:00:00.000Z"), previousEventAt: null, now }),
      null
    );
  });

  it("refuses a scan dated in the future", () => {
    const problem = describeEventDateProblem({ eventAt: new Date("2026-08-22T10:00:00.000Z"), now });
    assert.match(String(problem), /cannot be in the future/);
  });

  // Readers order on eventAt, so a date behind an existing event would show the
  // shipment standing at a stage it has already left.
  it("refuses a date earlier than the last recorded update, and names when that was", () => {
    const problem = describeEventDateProblem({
      eventAt: new Date("2026-08-18T09:00:00.000Z"),
      previousEventAt: new Date("2026-08-19T09:00:00.000Z"),
      now
    });
    assert.match(String(problem), /cannot be earlier than/);
    // Stated in the timezone the portal works in, not UTC.
    assert.match(String(problem), /19 Aug 2026/);
  });

  it("accepts a date exactly on the last recorded update", () => {
    const previousEventAt = new Date("2026-08-19T09:00:00.000Z");
    assert.equal(
      describeEventDateProblem({ eventAt: new Date(previousEventAt), previousEventAt, now }),
      null
    );
  });

  it("refuses a date that is not a date at all", () => {
    assert.equal(
      describeEventDateProblem({ eventAt: new Date("not a date"), now }),
      "Enter a valid status date."
    );
  });
});
