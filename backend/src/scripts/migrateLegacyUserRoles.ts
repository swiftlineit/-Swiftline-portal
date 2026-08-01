import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { legacyRoleReplacements, User } from "../models/user.model.js";

/**
 * Rewrites retired role names to the ones the product uses today:
 * `staff` -> `operations` and `accounts` -> `finance`.
 *
 * Reads already normalize through `normalizePortalRole`, and writes go through
 * the schema setter, so this migration is not required for correctness — it
 * exists so stored data matches the code and so role filters written directly
 * against the collection (reports, ad-hoc queries) do not miss users.
 *
 * Safe to re-run: documents already holding a current role are not matched.
 */
async function migrateLegacyUserRoles() {
  await connectDatabase();
  try {
    for (const [legacyRole, currentRole] of Object.entries(legacyRoleReplacements)) {
      // updateMany bypasses the schema setter, so the replacement is written
      // explicitly rather than relying on a save() round-trip per document.
      const result = await User.collection.updateMany(
        { role: legacyRole },
        { $set: { role: currentRole } }
      );

      console.log(`Role "${legacyRole}" -> "${currentRole}": ${result.modifiedCount} user(s) updated.`);
    }

    const remaining = await User.collection.countDocuments({
      role: { $in: Object.keys(legacyRoleReplacements) }
    });

    console.log(remaining === 0
      ? "No legacy roles remain."
      : `${remaining} user(s) still hold a legacy role. Re-run the migration.`);
  } finally {
    await mongoose.disconnect();
  }
}

migrateLegacyUserRoles().catch((error) => {
  console.error("Legacy user role migration failed.", error);
  process.exitCode = 1;
});
