import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";

/**
 * Removes database constraints left by the retired invoice-upload feature.
 * Historical records are preserved when present. The old collection is dropped
 * only when both it and the old draft linkage are empty.
 */
async function removeLegacyInvoiceUpload() {
  await connectDatabase();

  try {
    const database = mongoose.connection.db;
    if (!database) throw new Error("Database connection is not available.");

    const legacyCollectionExists = (await database
      .listCollections({ name: "invoiceuploads" }, { nameOnly: true })
      .toArray()).length > 0;
    const legacyDocuments = legacyCollectionExists
      ? await database.collection("invoiceuploads").countDocuments()
      : 0;
    const linkedDrafts = await ShipmentDraft.collection.countDocuments({
      invoiceUploadId: { $exists: true }
    });
    const indexes = await ShipmentDraft.collection.indexes();
    const legacyIndexes = indexes.filter((index) => index.key.invoiceUploadId === 1);
    for (const index of legacyIndexes) {
      if (index.name) await ShipmentDraft.collection.dropIndex(index.name);
    }

    const safeToDropCollection = legacyCollectionExists
      && legacyDocuments === 0
      && linkedDrafts === 0;
    if (safeToDropCollection) {
      await database.dropCollection("invoiceuploads");
    }

    await ShipmentDraft.createIndexes();
    console.log(
      `Legacy invoice upload constraint removed: ${legacyIndexes.length} index(es); `
      + `${legacyDocuments} upload record(s) and ${linkedDrafts} linked draft(s) preserved; `
      + `collection ${safeToDropCollection ? "dropped" : legacyCollectionExists ? "preserved" : "already absent"}.`
    );
  } finally {
    await mongoose.disconnect();
  }
}

removeLegacyInvoiceUpload().catch((error) => {
  console.error("Legacy invoice upload migration failed.", error);
  process.exitCode = 1;
});
