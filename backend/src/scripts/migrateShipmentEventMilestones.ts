// Backfills canonical milestone keys and creates the unique milestone index.
//
// Dry-run by default. Pass --apply during deployment after reviewing the
// summary. Historical duplicate rows are preserved and deliberately left
// without a key; the existing dedupe script remains the reviewed cleanup path.
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import {
  ShipmentEvent,
  shipmentMilestoneKey,
  type ShipmentEventStatus
} from "../models/shipmentEvent.model.js";

const apply = process.argv.includes("--apply");

type ExistingEvent = {
  _id: mongoose.Types.ObjectId;
  shipmentDraftId: mongoose.Types.ObjectId;
  status: ShipmentEventStatus;
  milestoneKey?: string;
};

async function migrateShipmentEventMilestones() {
  // A dry run must stay read-only. The application normally lets Mongoose sync
  // schema indexes on connect, but this migration creates its index explicitly
  // only after the data has been prepared in --apply mode.
  mongoose.set("autoIndex", false);
  await connectDatabase();
  try {
    const events = await ShipmentEvent.find({
      status: {
        $in: [
          "SHIPMENT_BOOKED",
          "PARCEL_COLLECTED",
          "WAREHOUSE_SCAN_IN",
          "ORIGIN_HUB_PROCESSED",
          "READY_FOR_EXPORT",
          "EXPORT_CUSTOMS_CLEARED",
          "FLIGHT_ASSIGNED",
          "ORIGIN_HUB_DISPATCHED",
          "FLIGHT_DEPARTED",
          "DESTINATION_ARRIVED",
          "IMPORT_CUSTOMS_CLEARANCE",
          "IMPORT_CUSTOMS_CLEARED",
          "DELIVERY_PARTNER_TRANSFERRED",
          "DELIVERY_HUB_ARRIVED",
          "OUT_FOR_DELIVERY",
          "DELIVERED"
        ]
      }
    }).select("shipmentDraftId status milestoneKey").lean<ExistingEvent[]>().exec();

    const groups = new Map<string, ExistingEvent[]>();
    for (const event of events) {
      const key = shipmentMilestoneKey(event.status);
      if (!key) continue;
      const groupKey = `${String(event.shipmentDraftId)}:${key}`;
      groups.set(groupKey, [...(groups.get(groupKey) ?? []), event]);
    }

    const unique = [...groups.values()].filter((group) => group.length === 1);
    const duplicates = [...groups.values()].filter((group) => group.length > 1);
    const summary = {
      eligibleEvents: events.length,
      uniqueMilestones: unique.length,
      duplicateMilestoneGroups: duplicates.length,
      duplicateEventsPreserved: duplicates.reduce((total, group) => total + group.length, 0),
      applied: apply
    };

    console.log("Shipment milestone migration.", summary);
    for (const group of duplicates.slice(0, 20)) {
      const first = group[0];
      console.log(
        `review  draft ${String(first?.shipmentDraftId)}  ${shipmentMilestoneKey(first?.status)}  `
        + `${group.length} historical events preserved`
      );
    }
    if (duplicates.length > 20) console.log(`${duplicates.length - 20} more duplicate group(s) omitted.`);

    if (!apply) {
      console.log("Dry run only. Re-run with --apply to backfill keys and create the unique index.");
      return;
    }

    const operations: mongoose.AnyBulkWriteOperation[] = [];
    for (const group of unique) {
      const event = group[0];
      if (!event) continue;
      operations.push({
        updateOne: {
          filter: { _id: event._id },
          update: { $set: { milestoneKey: shipmentMilestoneKey(event.status) } }
        }
      });
    }
    // A duplicate group cannot safely own one unique key until Operations has
    // reviewed which event is genuine. Removing only this derived field keeps
    // every historical event and every operator-entered detail unchanged.
    for (const group of duplicates) {
      operations.push({
        updateMany: {
          filter: { _id: { $in: group.map((event) => event._id) } },
          update: { $unset: { milestoneKey: "" } }
        }
      });
    }
    if (operations.length) await ShipmentEvent.bulkWrite(operations, { ordered: false });

    const indexName = await ShipmentEvent.collection.createIndex(
      { shipmentDraftId: 1, milestoneKey: 1 },
      {
        unique: true,
        name: "uniq_shipment_customer_milestone",
        partialFilterExpression: { milestoneKey: { $type: "string", $gt: "" } }
      }
    );
    console.log(`Shipment milestone migration applied. Index: ${indexName}.`);
  } finally {
    await mongoose.disconnect();
  }
}

migrateShipmentEventMilestones().catch((error) => {
  console.error("Shipment milestone migration failed.", error);
  process.exitCode = 1;
});
