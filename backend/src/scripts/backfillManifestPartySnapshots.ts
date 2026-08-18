// R7 backfill: adds structured consignor/consignee `party` fields to operations
// manifests sealed before EDI support existed, so their EDI export stops 409-ing.
// Parties are re-derived from each shipment's still-present booking snapshot; nothing
// else in the sealed snapshot is touched. Aadhaar is never written here- the EDI
// reads it live. Safe to re-run: manifests already carrying parties are skipped.
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { OperationsManifest } from "../models/operationsManifest.model.js";
import { buildManifestParties } from "../services/shipmentManifest.service.js";
import { readShipmentBookingSnapshot } from "../services/shipmentBookingSnapshot.service.js";

type SealedConsignment = {
  dpdShipmentId?: unknown;
  consignorSnapshot?: Record<string, unknown>;
  consigneeSnapshot?: Record<string, unknown>;
};

async function backfillManifestPartySnapshots() {
  await connectDatabase();
  const summary = { manifests: 0, updated: 0, consignments: 0, filled: 0, skippedNoSnapshot: 0 };
  try {
    const manifests = await OperationsManifest.find({ status: { $in: ["SEALED", "DISPATCHED"] } }).exec();
    for (const manifest of manifests) {
      summary.manifests += 1;
      const snapshot = manifest.sealedSnapshot as Record<string, unknown> | undefined;
      const consignments = Array.isArray(snapshot?.consignments) ? snapshot!.consignments as SealedConsignment[] : [];
      if (!consignments.length) continue;

      let changed = false;
      for (const consignment of consignments) {
        summary.consignments += 1;
        const hasParty = consignment.consignorSnapshot?.party && consignment.consigneeSnapshot?.party;
        if (hasParty) continue;

        const shipment = consignment.dpdShipmentId
          ? await DpdShipment.findById(consignment.dpdShipmentId).lean().exec()
          : null;
        const booking = shipment
          ? readShipmentBookingSnapshot(shipment.currentShipmentSnapshot) ?? readShipmentBookingSnapshot(shipment.bookingSnapshot)
          : null;
        if (!booking) { summary.skippedNoSnapshot += 1; continue; }

        const parties = buildManifestParties(booking);
        consignment.consignorSnapshot = { ...(consignment.consignorSnapshot ?? {}), party: parties.consignor };
        consignment.consigneeSnapshot = { ...(consignment.consigneeSnapshot ?? {}), party: parties.consignee };
        summary.filled += 1;
        changed = true;
      }

      if (changed) {
        snapshot!.version = 2;
        manifest.markModified("sealedSnapshot");
        await manifest.save();
        summary.updated += 1;
      }
    }
    console.log("Manifest party backfill complete.", summary);
  } finally {
    await mongoose.disconnect();
  }
}

backfillManifestPartySnapshots().catch((error) => {
  console.error("Manifest party backfill failed.", error);
  process.exitCode = 1;
});
