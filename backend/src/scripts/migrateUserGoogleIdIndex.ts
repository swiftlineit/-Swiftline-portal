import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { User } from "../models/user.model.js";

/**
 * Replaces the legacy `unique + sparse` googleId index with a partial index that
 * only covers string values.
 *
 * A sparse index skips documents that omit the field, but the schema stores an
 * explicit `googleId: null` for every password-based user. The old index treated
 * that null as a real value, so only one such user could exist: any later save
 * (including the profile change-password handler, which re-saves the user
 * document) failed with a duplicate-key error.
 */
async function migrateUserGoogleIdIndex() {
  await connectDatabase();
  try {
    const indexes = await User.collection.indexes();
    const legacyIndex = indexes.find((index) => (
      index.name === "googleId_1"
      && index.sparse === true
      && !index.partialFilterExpression
    ));

    if (legacyIndex?.name) {
      await User.collection.dropIndex(legacyIndex.name);
      console.log("Dropped the legacy sparse googleId index.");
    }

    await User.createIndexes();
    console.log("User indexes are up to date.");
  } finally {
    await mongoose.disconnect();
  }
}

migrateUserGoogleIdIndex().catch((error) => {
  console.error("User googleId index migration failed.", error);
  process.exitCode = 1;
});
