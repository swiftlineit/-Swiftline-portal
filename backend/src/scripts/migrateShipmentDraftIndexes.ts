import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";

/**
 * Moves shipment drafts onto soft deletion.
 *
 * `invoiceUploadId` used to carry a plain unique index, which would stop a
 * discarded invoice being uploaded again. It is replaced by a partial unique
 * index scoped to live drafts. Legacy drafts predate `deletedAt` entirely, so
 * they are backfilled to null first — a partial filter on `deletedAt: null`
 * cannot be relied on to pick up documents that lack the field.
 */
async function migrateShipmentDraftIndexes() {
  await connectDatabase();
  try {
    const backfilled = await ShipmentDraft.collection.updateMany(
      { deletedAt: { $exists: false } },
      { $set: { deletedAt: null, deletedBy: null } }
    );
    console.log(`Backfilled ${backfilled.modifiedCount} draft(s) with deletedAt: null.`);

    // Any index on this key that carries no partial filter is a leftover: either
    // the original plain unique index, or the non-unique one Mongoose used to
    // build from a field-level `index: true`. Both must go before the partial
    // index can be created, because it takes the same auto-generated name.
    const indexes = await ShipmentDraft.collection.indexes();
    const legacyIndex = indexes.find((index) => (
      !index.partialFilterExpression
      && Object.keys(index.key).length === 1
      && index.key.invoiceUploadId === 1
    ));
    if (legacyIndex?.name) {
      await ShipmentDraft.collection.dropIndex(legacyIndex.name);
      console.log(`Dropped legacy index ${legacyIndex.name}.`);
    }

    await ShipmentDraft.createIndexes();
    console.log("Shipment draft indexes are up to date.");
  } finally {
    await mongoose.disconnect();
  }
}

migrateShipmentDraftIndexes().catch((error) => {
  console.error("Shipment draft index migration failed.", error);
  process.exitCode = 1;
});
