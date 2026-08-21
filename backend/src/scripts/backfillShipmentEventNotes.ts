// Rewrites tracking notes that describe the office instead of the parcel.
//
// Before the status copy lived in one place, a blank operator note was filled in
// by whichever screen sent the update- the bulk dialog wrote "Bulk status update
// by Swiftline Operations", the single-shipment form wrote "Live action updated
// by Swiftline Operations". Both strings were stored on the event and shown
// verbatim on the public tracker, the client portal and the staff timeline.
//
// Every affected row is replaced with the standard line for its status. Only
// these two exact strings are matched, so a note an operator actually typed is
// never touched. Whether the update was part of a batch stays recorded in
// AuditLog.metadata.source, which this does not modify.
//
// Dry run by default; pass --apply to write. Safe to re-run.
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { ShipmentEvent } from "../models/shipmentEvent.model.js";
import {
  defaultShipmentEventNote,
  legacyFilledNotes
} from "../services/shipmentEventCopy.service.js";

const apply = process.argv.includes("--apply");

async function backfillShipmentEventNotes() {
  await connectDatabase();
  const summary = { matched: 0, updated: 0, byStatus: {} as Record<string, number> };
  try {
    const events = await ShipmentEvent.find({ note: { $in: [...legacyFilledNotes] } })
      .select("status note")
      .lean()
      .exec();

    summary.matched = events.length;

    for (const event of events) {
      const note = defaultShipmentEventNote(event.status);
      summary.byStatus[event.status] = (summary.byStatus[event.status] ?? 0) + 1;
      if (!apply) continue;
      await ShipmentEvent.updateOne({ _id: event._id }, { $set: { note } });
      summary.updated += 1;
    }

    console.log(apply ? "Shipment event note backfill applied." : "Shipment event note backfill (dry run).", summary);
    if (!apply) console.log("Re-run with --apply to write these changes.");
  } finally {
    await mongoose.disconnect();
  }
}

backfillShipmentEventNotes().catch((error) => {
  console.error("Shipment event note backfill failed.", error);
  process.exitCode = 1;
});
