import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { Claim } from "../models/claim.model.js";

/**
 * Replaces the stale claim-number index.
 *
 * `claimNumber` was first declared `unique: true, sparse: true`. Sparse only
 * skips documents where the field is *absent*, and a draft carries an explicit
 * `claimNumber: null`- so every draft collided with every other draft on the
 * null value, and the second draft anywhere in the system failed to save.
 *
 * The model now declares a partial unique index filtered on the field actually
 * being a string. Mongoose builds new indexes but never drops superseded ones,
 * so any database created before that change still carries the old index and
 * still rejects a second draft. This removes it.
 *
 * Safe to run more than once.
 */
async function migrateClaimIndexes() {
  await connectDatabase();

  try {
    const indexes = await Claim.collection.indexes();

    // Anything keyed on claimNumber without a partial filter is a leftover:
    // either the original sparse unique index, or a plain one from an earlier
    // field-level declaration. Both block the partial index, which wants the
    // same auto-generated name.
    const stale = indexes.filter(
      (index) =>
        !index.partialFilterExpression &&
        Object.keys(index.key).length === 1 &&
        index.key.claimNumber === 1
    );

    for (const index of stale) {
      if (!index.name) continue;
      await Claim.collection.dropIndex(index.name);
      console.log(`Dropped stale index ${index.name}.`);
    }

    if (stale.length === 0) {
      console.log("No stale claimNumber index found- nothing to drop.");
    }

    // Builds whatever the model declares and is missing, including the partial
    // unique index that replaces what was just dropped.
    await Claim.syncIndexes();
    console.log("Claim indexes are in step with the model.");

    const drafts = await Claim.collection.countDocuments({ claimNumber: null });
    if (drafts > 1) {
      console.log(
        `${drafts} draft claims now coexist. Before this migration only one could.`
      );
    }
  } finally {
    await mongoose.disconnect();
  }
}

migrateClaimIndexes().catch((error) => {
  console.error("Claim index migration failed.", error);
  process.exitCode = 1;
});
