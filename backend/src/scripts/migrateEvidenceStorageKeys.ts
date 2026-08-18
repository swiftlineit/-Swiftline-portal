/**
 * Moves POD evidence and pickup proofs onto storage keys.
 *
 * These rows were written before `storage.service.ts` existed, when the model
 * held an absolute filesystem path- the very thing the current schema comment
 * says was removed because it tied every file to one server's disk. The schema
 * was changed; the stored documents never were.
 *
 * The consequence is live, not theoretical: every reader resolves
 * `storageKey`, which is undefined on these rows, so viewing existing POD
 * evidence or pickup proof in the portal fails today.
 *
 * The file itself is left exactly where it is. Only the pointer is rewritten,
 * from an absolute path to the key the storage service understands, which is
 * why this is safe to run against live data- nothing is copied, moved or
 * deleted.
 *
 * Dry run (default):
 *   npx tsx src/scripts/migrateEvidenceStorageKeys.ts
 * Apply:
 *   npx tsx src/scripts/migrateEvidenceStorageKeys.ts --apply
 *
 * Safe to run more than once, and safe to run over the keys an earlier version
 * of this script got wrong: a key is left alone only when it resolves to a file
 * that exists, and repaired otherwise. Nothing is written for a key that would
 * point at nothing.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { storageKeyFromLegacyPath } from "../services/storage/legacyKeys.js";

const apply = process.argv.includes("--apply");

/**
 * Whether a key actually lands on a file the storage driver can read.
 *
 * This is the check the first version of this script got wrong: it verified
 * that the *old* path still had a file rather than that the *new* key resolved
 * to one, so it reported success while writing keys that pointed at nothing.
 */
function resolvesToFile(key: string) {
  return existsSync(join(process.cwd(), "private_uploads", key));
}

type Target = {
  collection: string;
  /** Dotted path to the array of evidence rows, or null for a flat document. */
  arrayField: string | null;
};

const targets: Target[] = [
  { collection: "podrevisions", arrayField: "evidence" },
  { collection: "pickupproofs", arrayField: null }
];

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set. Run this from portal/backend.");
    process.exit(1);
  }

  await mongoose.connect(uri, { family: 4 });
  console.log(`Connected to "${mongoose.connection.name}"`);
  console.log(apply ? "Mode: APPLY\n" : "Mode: DRY RUN (pass --apply to write)\n");

  let converted = 0;
  let missingFile = 0;
  let unconvertible = 0;
  let alreadyKeyed = 0;

  for (const target of targets) {
    const collection = mongoose.connection.collection(target.collection);
    const documents = await collection.find({}).toArray();

    for (const document of documents) {
      const rows = target.arrayField
        ? (document[target.arrayField] as Array<Record<string, unknown>> | undefined) ?? []
        : [document as Record<string, unknown>];

      let changed = false;
      const updated = rows.map((row) => {
        const currentKey = typeof row.storageKey === "string" ? row.storageKey : "";
        // A key that already reads a real file is left alone. One that does
        // not is repaired, which is what makes this safe to re-run over the
        // wrong keys the first version of this script wrote.
        if (currentKey && resolvesToFile(currentKey)) { alreadyKeyed += 1; return row; }

        const legacy = typeof row.path === "string" ? row.path : "";
        const key = legacy ? storageKeyFromLegacyPath(legacy) : null;
        if (!key) {
          unconvertible += 1;
          console.log(`  ${target.collection}: cannot derive a key from ${legacy || "(no path)"}`);
          return row;
        }
        if (!resolvesToFile(key)) {
          // Reported and not written: a key pointing at nothing is no better
          // than the broken pointer it would replace.
          missingFile += 1;
          console.log(`  ${target.collection}: no file at private_uploads/${key}`);
          return row;
        }
        converted += 1;
        changed = true;
        console.log(`  ${target.collection}: ${currentKey ? `repaired ${currentKey} -> ` : ""}${key}`);
        return { ...row, storageKey: key };
      });

      if (changed && apply) {
        await collection.updateOne(
          { _id: document._id },
          { $set: target.arrayField ? { [target.arrayField]: updated } : { storageKey: updated[0]?.storageKey } }
        );
      }
    }
  }

  console.log(`\nalready resolving to a file: ${alreadyKeyed}`);
  console.log(`convertible             : ${converted}${apply ? " (written)" : " (would be written)"}`);
  console.log(`no file at derived key    : ${missingFile}`);
  console.log(`could not derive a key  : ${unconvertible}`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
