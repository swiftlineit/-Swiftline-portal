import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";

/** Backfills soft-deletion fields before synchronizing current draft indexes. */
async function migrateShipmentDraftIndexes() {
  await connectDatabase();
  try {
    const backfilled = await ShipmentDraft.collection.updateMany(
      { deletedAt: { $exists: false } },
      { $set: { deletedAt: null, deletedBy: null } }
    );
    console.log(`Backfilled ${backfilled.modifiedCount} draft(s) with deletedAt: null.`);

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
