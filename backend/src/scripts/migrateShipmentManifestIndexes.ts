import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { ShipmentManifest } from "../models/shipmentManifest.model.js";

async function migrateShipmentManifestIndexes() {
  await connectDatabase();
  try {
    const indexes = await ShipmentManifest.collection.indexes();
    const legacyIndex = indexes.find((index) => (
      index.name === "shipmentDraftIds_1"
      && Object.keys(index.key).length === 1
      && index.key.shipmentDraftIds === 1
    ));
    if (legacyIndex?.name) await ShipmentManifest.collection.dropIndex(legacyIndex.name);
    await ShipmentManifest.createIndexes();
    console.log("Shipment manifest indexes are up to date.");
  } finally {
    await mongoose.disconnect();
  }
}

migrateShipmentManifestIndexes().catch((error) => {
  console.error("Shipment manifest index migration failed.", error);
  process.exitCode = 1;
});
