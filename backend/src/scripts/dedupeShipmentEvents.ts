// Removes the duplicate timeline rows left behind by mixed-stage bulk updates.
//
// A bulk update used to accept a selection spanning several stages. Pushing a
// booked parcel and an already-collected one both to Parcel Collected advanced
// the first correctly and wrote the second a second, identical row for a scan
// that never happened twice. The customer saw the same stage listed twice on
// their tracker. `bulkSelectionBlockReason` now refuses those selections, but
// the rows already written are still on the shipments.
//
// Only statuses that can occur once in a shipment's life are considered- the
// operational ladder plus the booking event. ON_HOLD and RELEASED_FROM_HOLD are
// deliberately excluded: a shipment can genuinely be held, released and held
// again, and those repeats are real history.
//
// Within a group the EARLIEST event is kept. That is the scan that actually
// happened; the later row is the one the bad batch invented.
//
// A later row is only removable when nothing a human typed would be lost with
// it- its note must be exactly the standard line for the status, and it must
// not carry a location the kept event lacks. Anything else is reported for
// review and left alone. Operators' own words are never deleted by a script.
//
// AuditLog is not touched. That an operator ran the action is a true record and
// stays; what is removed is the false claim to the customer that the parcel was
// scanned twice.
//
// Dry run by default; pass --apply to delete. Safe to re-run.
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import {
  ShipmentEvent,
  shipmentOperationalStatusValues,
  type ShipmentEventStatus
} from "../models/shipmentEvent.model.js";
import { isRemovableDuplicate } from "../services/shipmentEventDedupe.service.js";

const singleOccurrenceStatuses: ShipmentEventStatus[] = [
  "SHIPMENT_BOOKED",
  ...shipmentOperationalStatusValues
];

const apply = process.argv.includes("--apply");

type GroupedEvent = {
  _id: mongoose.Types.ObjectId;
  shipmentDraftId: mongoose.Types.ObjectId;
  status: ShipmentEventStatus;
  note: string;
  location: string;
  eventAt: Date;
  createdAt: Date;
};

async function dedupeShipmentEvents() {
  await connectDatabase();
  const summary = { groups: 0, duplicates: 0, removable: 0, deleted: 0, needsReview: 0 };

  try {
    const events = await ShipmentEvent.find({ status: { $in: singleOccurrenceStatuses } })
      .select("shipmentDraftId status note location eventAt createdAt")
      .sort({ shipmentDraftId: 1, status: 1, eventAt: 1, createdAt: 1, _id: 1 })
      .lean<GroupedEvent[]>()
      .exec();

    const groups = new Map<string, GroupedEvent[]>();
    for (const event of events) {
      const key = `${String(event.shipmentDraftId)}:${event.status}`;
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }

    const duplicated = [...groups.values()]
      .map((group) => ({ kept: group[0], laterRows: group.slice(1) }))
      .filter((group): group is { kept: GroupedEvent; laterRows: GroupedEvent[] } =>
        Boolean(group.kept) && group.laterRows.length > 0);
    if (!duplicated.length) {
      console.log("No duplicate shipment events found.", summary);
      return;
    }

    // Named by tracking number in the report, so the rows can be checked on the
    // tracker before anything is deleted.
    const draftIds = [...new Set(duplicated.map((group) => group.kept.shipmentDraftId))];
    const shipments = await DpdShipment.find({ shipmentDraftId: { $in: draftIds } })
      .select("shipmentDraftId swiftlineTrackingNumber")
      .lean()
      .exec();
    const trackingByDraft = new Map(
      shipments.map((shipment) => [String(shipment.shipmentDraftId), shipment.swiftlineTrackingNumber || ""])
    );

    const removableIds: mongoose.Types.ObjectId[] = [];

    for (const group of duplicated) {
      const { kept, laterRows } = group;
      const reference = trackingByDraft.get(String(kept.shipmentDraftId))
        || `draft ${String(kept.shipmentDraftId)}`;

      summary.groups += 1;
      summary.duplicates += laterRows.length;

      for (const duplicate of laterRows) {
        if (isRemovableDuplicate(duplicate, kept)) {
          summary.removable += 1;
          removableIds.push(duplicate._id);
          console.log(
            `${apply ? "remove" : "would remove"}  ${reference}  ${duplicate.status}  `
            + `${duplicate.eventAt.toISOString()} (keeping ${kept.eventAt.toISOString()})`
          );
          continue;
        }

        summary.needsReview += 1;
        console.log(
          `review      ${reference}  ${duplicate.status}  ${duplicate.eventAt.toISOString()}  `
          + `note="${duplicate.note}" location="${duplicate.location}"`
        );
      }
    }

    if (apply && removableIds.length) {
      const result = await ShipmentEvent.deleteMany({ _id: { $in: removableIds } });
      summary.deleted = result.deletedCount ?? 0;
    }

    console.log(apply ? "Shipment event dedupe applied." : "Shipment event dedupe (dry run).", summary);
    if (!apply) console.log("Re-run with --apply to delete the rows marked 'would remove'.");
    if (summary.needsReview) {
      console.log(
        `${summary.needsReview} row(s) carry an operator note or a location of their own and were left alone. `
        + "Check those on the tracker and remove them by hand if they are wrong."
      );
    }
  } finally {
    await mongoose.disconnect();
  }
}

dedupeShipmentEvents().catch((error) => {
  console.error("Shipment event dedupe failed.", error);
  process.exitCode = 1;
});
