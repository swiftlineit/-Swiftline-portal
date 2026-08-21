// READ ONLY. Reports duplicate tracking rows on whichever database it is
// pointed at. There is no write path in this file- no update, no delete, no
// save- so it is safe to run against production.
//
// Kept separate from dedupeShipmentEvents.ts, which can delete. That one should
// never be aimed at production without reading this report first.
//
// The connection string is read from a file named by INSPECT_URI_FILE rather
// than an argument or an inline env var, so a production credential does not
// land in shell history or a process listing.
//
// Atlas mongodb+srv:// URIs need a resolver that answers SRV queries; the local
// one refuses them, so DNS is pointed at a public server before connecting.
import dns from "node:dns";
import fs from "node:fs";
import mongoose from "mongoose";
import {
  ShipmentEvent,
  shipmentOperationalStatusValues,
  type ShipmentEventStatus
} from "../models/shipmentEvent.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { AuditLog } from "../models/auditLog.model.js";
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

function readUri(): string {
  const file = process.env.INSPECT_URI_FILE;
  if (!file) throw new Error("Set INSPECT_URI_FILE to a file containing the connection string.");
  const uri = fs.readFileSync(file, "utf8").trim();
  if (!uri) throw new Error("The connection string file is empty.");
  return uri;
}

function describeTarget(uri: string): string {
  const host = uri.replace(/^mongodb(\+srv)?:\/\/[^@]*@/, "").split("/")[0] ?? "";
  return host.split(",")[0] ?? "";
}

async function inspect() {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
  const uri = readUri();

  console.log(`Connecting READ ONLY to ${describeTarget(uri)}`);
  await mongoose.connect(uri, { family: 4 });

  try {
    const totals = {
      shipmentEvents: await ShipmentEvent.estimatedDocumentCount(),
      bookedShipments: await DpdShipment.estimatedDocumentCount()
    };
    console.log("Collection sizes:", totals);

    const events = await ShipmentEvent.find({ status: { $in: singleOccurrenceStatuses } })
      .select("shipmentDraftId status note location eventAt createdAt")
      .sort({ shipmentDraftId: 1, status: 1, eventAt: 1, createdAt: 1, _id: 1 })
      .lean<Row[]>()
      .exec();

    const groups = new Map<string, Row[]>();
    for (const event of events) {
      const key = `${String(event.shipmentDraftId)}:${event.status}`;
      groups.set(key, [...(groups.get(key) ?? []), event]);
    }

    const duplicated = [...groups.values()]
      .map((group) => ({ kept: group[0], laterRows: group.slice(1) }))
      .filter((group): group is { kept: Row; laterRows: Row[] } =>
        Boolean(group.kept) && group.laterRows.length > 0);

    const summary = { affectedShipments: 0, groups: 0, duplicates: 0, removable: 0, needsReview: 0 };

    if (!duplicated.length) {
      console.log("No duplicate tracking rows on this database.", summary);
      return;
    }

    const draftIds = [...new Set(duplicated.map((group) => group.kept.shipmentDraftId))];
    summary.affectedShipments = draftIds.length;

    const shipments = await DpdShipment.find({ shipmentDraftId: { $in: draftIds } })
      .select("shipmentDraftId swiftlineTrackingNumber")
      .lean()
      .exec();
    const trackingByDraft = new Map(
      shipments.map((s) => [String(s.shipmentDraftId), s.swiftlineTrackingNumber || ""])
    );
    const shipmentIdByDraft = new Map(shipments.map((s) => [String(s.shipmentDraftId), String(s._id)]));

    // Confirms the cause rather than assuming it: a bulk-written duplicate has
    // a matching audit row stamped source BULK.
    const bulkAudits = await AuditLog.find({
      action: "SHIPMENT_STATUS_UPDATED",
      entityId: { $in: shipments.map((s) => s._id) },
      "metadata.source": "BULK"
    }).select("entityId").lean().exec();
    const bulkCountByShipment = new Map<string, number>();
    for (const audit of bulkAudits) {
      const key = String(audit.entityId);
      bulkCountByShipment.set(key, (bulkCountByShipment.get(key) ?? 0) + 1);
    }

    for (const { kept, laterRows } of duplicated) {
      const draftKey = String(kept.shipmentDraftId);
      const reference = trackingByDraft.get(draftKey) || `draft ${draftKey}`;
      const bulkCount = bulkCountByShipment.get(shipmentIdByDraft.get(draftKey) ?? "") ?? 0;

      summary.groups += 1;
      summary.duplicates += laterRows.length;

      console.log(`\n${reference}  ${kept.status}  (${laterRows.length + 1} rows, ${bulkCount} bulk audit entries)`);
      console.log(`  keep    ${kept.eventAt.toISOString()}  note="${kept.note}" location="${kept.location}"`);

      for (const duplicate of laterRows) {
        const removable = isRemovableDuplicate(duplicate, kept);
        if (removable) summary.removable += 1;
        else summary.needsReview += 1;
        console.log(
          `  ${removable ? "remove" : "REVIEW"}  ${duplicate.eventAt.toISOString()}  `
          + `note="${duplicate.note}" location="${duplicate.location}"`
        );
      }
    }

    console.log("\nRead-only inspection complete. Nothing was modified.", summary);
  } finally {
    await mongoose.disconnect();
  }
}

inspect().catch((error) => {
  console.error("Inspection failed.", error);
  process.exitCode = 1;
});
