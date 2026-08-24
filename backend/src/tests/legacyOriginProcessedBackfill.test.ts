import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessLegacyOriginProcessedBackfill,
  isLegacyOriginProcessedAwb,
  LEGACY_ORIGIN_PROCESSED_AWBS
} from "../services/legacyOriginProcessedBackfill.service.js";

const approvedAwb = "SLCDEL200826018";
const validLegacyEvents = [
  {
    id: "warehouse",
    status: "WAREHOUSE_SCAN_IN",
    milestoneKey: "WAREHOUSE_SCAN_IN",
    eventAt: "2026-08-21T05:53:00.000Z"
  },
  {
    id: "ready",
    status: "EXPORT_CUSTOMS_CLEARED",
    eventAt: "2026-08-21T20:07:00.000Z"
  },
  {
    id: "arrival",
    status: "DESTINATION_ARRIVED",
    milestoneKey: "DESTINATION_ARRIVED",
    eventAt: "2026-08-22T19:58:00.000Z"
  }
];

describe("legacy origin-processing production backfill", () => {
  it("contains exactly the reviewed 70 unique production AWBs", () => {
    assert.equal(LEGACY_ORIGIN_PROCESSED_AWBS.length, 70);
    assert.equal(new Set(LEGACY_ORIGIN_PROCESSED_AWBS).size, 70);
    assert.equal(isLegacyOriginProcessedAwb(approvedAwb), true);
  });

  it("rejects every shipment outside the explicit allowlist", () => {
    const assessment = assessLegacyOriginProcessedBackfill("SLCDEL240826999", validLegacyEvents);
    assert.deepEqual(assessment, { outcome: "NOT_ALLOWLISTED" });
  });

  it("derives a timestamp strictly between confirmed warehouse and export events", () => {
    const assessment = assessLegacyOriginProcessedBackfill(approvedAwb, validLegacyEvents);
    assert.equal(assessment.outcome, "ELIGIBLE");
    if (assessment.outcome !== "ELIGIBLE") return;

    const lower = new Date(assessment.lower.eventAt).getTime();
    const upper = new Date(assessment.upper.eventAt).getTime();
    assert.ok(assessment.eventAt.getTime() > lower);
    assert.ok(assessment.eventAt.getTime() < upper);
    assert.equal(
      assessment.eventAt.getTime(),
      lower + Math.floor((upper - lower) / 2)
    );
  });

  it("is idempotent when the canonical status already exists", () => {
    const assessment = assessLegacyOriginProcessedBackfill(approvedAwb, [
      ...validLegacyEvents,
      {
        id: "processed",
        status: "ORIGIN_HUB_PROCESSED",
        milestoneKey: "ORIGIN_HUB_PROCESSED",
        eventAt: "2026-08-21T13:00:00.000Z"
      }
    ]);
    assert.deepEqual(assessment, { outcome: "ALREADY_PRESENT" });
  });

  it("also respects an existing canonical milestone key", () => {
    const assessment = assessLegacyOriginProcessedBackfill(approvedAwb, [
      ...validLegacyEvents,
      {
        id: "legacy-proof",
        status: "FLIGHT_ASSIGNED",
        milestoneKey: "ORIGIN_HUB_PROCESSED",
        eventAt: "2026-08-21T13:00:00.000Z"
      }
    ]);
    assert.deepEqual(assessment, { outcome: "ALREADY_PRESENT" });
  });

  it("refuses to infer processing without destination-arrival evidence", () => {
    const assessment = assessLegacyOriginProcessedBackfill(
      approvedAwb,
      validLegacyEvents.filter((event) => event.status !== "DESTINATION_ARRIVED")
    );
    assert.deepEqual(assessment, { outcome: "MISSING_DESTINATION_ARRIVAL" });
  });

  it("refuses invalid event dates instead of guessing", () => {
    const assessment = assessLegacyOriginProcessedBackfill(approvedAwb, [
      ...validLegacyEvents,
      { id: "invalid", status: "FLIGHT_DEPARTED", eventAt: "not-a-date" }
    ]);
    assert.deepEqual(assessment, { outcome: "INVALID_EVENT_DATES" });
  });
});
