// READ ONLY. Simulates the duplicate cleanup in memory and reports every
// difference it would make beyond removing the repeated row itself.
//
// "It only deletes duplicates" is not on its own a safety argument: other parts
// of the portal read these rows, and several of them read the NEWEST event
// rather than the earliest. This checks the invariants that actually matter
// before a single document is touched on production.
//
// No write path exists in this file.
import dns from "node:dns";
import fs from "node:fs";
import mongoose from "mongoose";
import {
  ShipmentEvent,
  shipmentOperationalStatusValues,
  type ShipmentEventStatus
} from "../models/shipmentEvent.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { isRemovableDuplicate } from "../services/shipmentEventDedupe.service.js";

const singleOccurrenceStatuses: ShipmentEventStatus[] = [
  "SHIPMENT_BOOKED",
  ...shipmentOperationalStatusValues
];

type Row = {
  _id: mongoose.Types.ObjectId;
  shipmentDraftId: mongoose.Types.ObjectId;
  status: ShipmentEventStatus;
  note: string;
  location: string;
  eventAt: Date;
  createdAt: Date;
};

const newestFirst = (a: Row, b: Row) =>
  b.eventAt.getTime() - a.eventAt.getTime() || b.createdAt.getTime() - a.createdAt.getTime();

async function verify() {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
  const file = process.env.INSPECT_URI_FILE;
  if (!file) throw new Error("Set INSPECT_URI_FILE to a file containing the connection string.");
  const uri = fs.readFileSync(file, "utf8").trim();

  const host = uri.replace(/^mongodb(\+srv)?:\/\/[^@]*@/, "").split("/")[0];
  console.log(`Connecting READ ONLY to ${host}`);
  await mongoose.connect(uri, { family: 4 });

  try {
    // Work out what would be deleted, by exactly the rule the cleanup uses.
    const candidates = await ShipmentEvent.find({ status: { $in: singleOccurrenceStatuses } })
      .select("shipmentDraftId status note location eventAt createdAt")
      .sort({ shipmentDraftId: 1, status: 1, eventAt: 1, createdAt: 1, _id: 1 })
      .lean<Row[]>()
      .exec();

    const groups = new Map<string, Row[]>();
    for (const event of candidates) {
      const key = `${String(event.shipmentDraftId)}:${event.status}`;
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }

    const doomed = new Set<string>();
    const statusCounts = new Map<string, number>();
    for (const group of groups.values()) {
      const kept = group[0];
      if (!kept || group.length < 2) continue;
      for (const duplicate of group.slice(1)) {
        if (!isRemovableDuplicate(duplicate, kept)) continue;
        doomed.add(String(duplicate._id));
        statusCounts.set(duplicate.status, (statusCounts.get(duplicate.status) ?? 0) + 1);
      }
    }

    console.log("\nRows that would be deleted, by status:", Object.fromEntries(statusCounts));

    // Compare before and after across EVERY event on the affected shipments,
    // not only the rows being removed.
    const affected = [...new Set(
      candidates.filter((row) => doomed.has(String(row._id))).map((row) => String(row.shipmentDraftId))
    )];
    const affectedIds = affected.map((id) => new mongoose.Types.ObjectId(id));

    const allEvents = await ShipmentEvent.find({ shipmentDraftId: { $in: affectedIds } })
      .select("shipmentDraftId status note location eventAt createdAt")
      .lean<Row[]>()
      .exec();

    const shipments = await DpdShipment.find({ shipmentDraftId: { $in: affectedIds } })
      .select("shipmentDraftId swiftlineTrackingNumber")
      .lean()
      .exec();
    const trackingByDraft = new Map(
      shipments.map((s) => [String(s.shipmentDraftId), s.swiftlineTrackingNumber || ""])
    );

    const byDraft = new Map<string, Row[]>();
    for (const event of allEvents) {
      const key = String(event.shipmentDraftId);
      byDraft.set(key, [...(byDraft.get(key) ?? []), event]);
    }

    const findings = {
      shipmentsChecked: byDraft.size,
      statusLost: 0,
      earliestOccurrenceMoved: 0,
      currentStatusChanged: 0,
      latestDeliveredMoved: 0,
      shipmentLeftWithNoEvents: 0
    };

    for (const [draftId, before] of byDraft) {
      const after = before.filter((row) => !doomed.has(String(row._id)));
      const reference = trackingByDraft.get(draftId) || `draft ${draftId}`;

      // A: no journey step may disappear entirely.
      const beforeStatuses = new Set(before.map((row) => row.status));
      const afterStatuses = new Set(after.map((row) => row.status));
      const lost = [...beforeStatuses].filter((status) => !afterStatuses.has(status));
      if (lost.length) {
        findings.statusLost += 1;
        console.log(`  LOST STATUS    ${reference}: ${lost.join(", ")}`);
      }

      // B: the first time each status happened must not move- claim filing
      // deadlines are computed from the earliest PARCEL_COLLECTED.
      for (const status of beforeStatuses) {
        const rowsAfter = after.filter((row) => row.status === status);
        if (!rowsAfter.length) continue;
        const earliestBefore = Math.min(
          ...before.filter((row) => row.status === status).map((row) => row.eventAt.getTime())
        );
        const earliestAfter = Math.min(...rowsAfter.map((row) => row.eventAt.getTime()));
        if (earliestBefore !== earliestAfter) {
          findings.earliestOccurrenceMoved += 1;
          console.log(`  EARLIEST MOVED ${reference} ${status}: `
            + `${new Date(earliestBefore).toISOString()} -> ${new Date(earliestAfter).toISOString()}`);
        }
      }

      // C: the newest event drives the list column and the tracker headline.
      const currentBefore = [...before].sort(newestFirst)[0];
      const currentAfter = [...after].sort(newestFirst)[0];
      if (!currentAfter) {
        findings.shipmentLeftWithNoEvents += 1;
        console.log(`  NO EVENTS LEFT ${reference}`);
      } else if (currentBefore && currentBefore.status !== currentAfter.status) {
        findings.currentStatusChanged += 1;
        console.log(`  CURRENT STATUS ${reference}: ${currentBefore.status} -> ${currentAfter.status}`);
      }

      // D: claim eligibility reads the LATEST delivered, not the earliest.
      const deliveredBefore = before.filter((row) => row.status === "DELIVERED").sort(newestFirst)[0];
      const deliveredAfter = after.filter((row) => row.status === "DELIVERED").sort(newestFirst)[0];
      if (deliveredBefore && deliveredAfter
        && deliveredBefore.eventAt.getTime() !== deliveredAfter.eventAt.getTime()) {
        findings.latestDeliveredMoved += 1;
        console.log(`  DELIVERED MOVED ${reference}: `
          + `${deliveredBefore.eventAt.toISOString()} -> ${deliveredAfter.eventAt.toISOString()}`);
      }
    }

    console.log("\nSimulation complete. Nothing was modified.", findings);

    const clean = findings.statusLost === 0
      && findings.earliestOccurrenceMoved === 0
      && findings.latestDeliveredMoved === 0
      && findings.shipmentLeftWithNoEvents === 0;

    console.log(clean
      ? "SAFE: no journey step lost, no first-occurrence time moved, no delivery time moved."
      : "STOP: the cleanup would change something beyond the duplicate row. Do not apply.");

    if (findings.currentStatusChanged) {
      console.log(`${findings.currentStatusChanged} shipment(s) would show a different CURRENT status- `
        + "expected only where a stale duplicate is masking real later progress.");
    }
  } finally {
    await mongoose.disconnect();
  }
}

verify().catch((error) => {
  console.error("Verification failed.", error);
  process.exitCode = 1;
});
