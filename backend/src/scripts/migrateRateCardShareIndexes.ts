import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { RateCardShare } from "../models/rateCardShare.model.js";

/**
 * Drops the rate card share index that spanned `channels` and
 * `recipientAccounts`.
 *
 * MongoDB refuses to index two array fields in one compound key. The index
 * builds happily on an empty collection and then rejects the first insert that
 * populates both arrays with "cannot index parallel arrays", so a share sent to
 * a business account over any channel could never be saved.
 *
 * Mongoose creates missing indexes on boot but never removes stale ones, so
 * correcting the schema is not enough- the old key has to be dropped here.
 */
async function migrateRateCardShareIndexes() {
  await connectDatabase();
  try {
    const indexes = await RateCardShare.collection.indexes();
    const parallelIndex = indexes.find((index) => index.key && "channels" in index.key && "recipientAccounts.businessAccountId" in index.key);

    if (parallelIndex?.name) {
      await RateCardShare.collection.dropIndex(parallelIndex.name);
      console.log(`Dropped the parallel-array index ${parallelIndex.name}.`);
    } else {
      console.log("No parallel-array index found; nothing to drop.");
    }

    await RateCardShare.createIndexes();
    console.log("Rate card share indexes are up to date.");
  } finally {
    await mongoose.disconnect();
  }
}

migrateRateCardShareIndexes().catch((error) => {
  console.error("Rate card share index migration failed.", error);
  process.exitCode = 1;
});
