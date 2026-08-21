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
import { storageKeyFromLegacyPath } from "../services/storage/legacyKeys.js";
import { objectExists } from "../services/storage/storage.service.js";

const apply = process.argv.includes("--apply");

/**
 * Whether a key actually lands on a file the storage driver can read.
 *
 * This is the check the first version of this script got wrong: it verified
 * that the *old* path still had a file rather than that the *new* key resolved
 * to one, so it reported success while writing keys that pointed at nothing.
 *
 * Asked of the storage driver rather than the local disk, so the answer is
 * right under S3 as well. A local-only check reports every key missing when the
 * files live in a bucket, which would make this unrunnable in production.
 */
function resolvesToFile(key: string) {
  return objectExists(key);
}

type Target = {
  collection: string;
  /** How the storage rows sit inside each document of this collection. */
  shape: "flat" | "array" | "map";
  /** Field holding the rows. Unused for "flat", where the document is the row. */
  field?: string;
};

const targets: Target[] = [
  { collection: "podrevisions", shape: "array", field: "evidence" },
  { collection: "pickupproofs", shape: "flat" },
  // Business KYC uploads carry the same pre-storage-service rows. Two things
  // break on an affected account: its documents cannot be shown, because the
  // read path resolves storageKey; and the account cannot be saved at all,
  // because storageKey is required and saving revalidates the whole document-
  // which is what took down credit approval.
  { collection: "businessaccounts", shape: "map", field: "documents" }
];

/** The rows inside one document, paired with the path to write each one back to. */
function rowsOf(document: Record<string, unknown>, target: Target) {
  if (target.shape === "flat") return [{ row: document, path: "storageKey" }];

  const container = document[target.field!];
  if (target.shape === "array") {
    const rows = Array.isArray(container) ? container : [];
    return rows.map((row, index) => ({
      row: row as Record<string, unknown>,
      path: `${target.field}.${index}.storageKey`
    }));
  }

  const entries = container && typeof container === "object" ? Object.entries(container) : [];
  return entries
    .filter(([, row]) => row && typeof row === "object")
    .map(([key, row]) => ({
      row: row as Record<string, unknown>,
      path: `${target.field}.${key}.storageKey`
    }));
}

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
      // Only the keys that change are written, each at its own path, so a row
      // this script does not touch is left byte-for-byte as it was.
      const updates: Record<string, string> = {};

      for (const { row, path } of rowsOf(document as Record<string, unknown>, target)) {
        const currentKey = typeof row.storageKey === "string" ? row.storageKey : "";
        // A key that already reads a real file is left alone. One that does
        // not is repaired, which is what makes this safe to re-run over the
        // wrong keys the first version of this script wrote.
        if (currentKey && (await resolvesToFile(currentKey))) { alreadyKeyed += 1; continue; }

        const legacy = typeof row.path === "string" ? row.path : "";
        const key = legacy ? storageKeyFromLegacyPath(legacy) : null;
        if (!key) {
          unconvertible += 1;
          console.log(`  ${target.collection}: cannot derive a key from ${legacy || "(no path)"}`);
          continue;
        }
        if (!(await resolvesToFile(key))) {
          // Reported and not written: a key pointing at nothing is no better
          // than the broken pointer it would replace.
          missingFile += 1;
          console.log(`  ${target.collection}: no stored file for ${key}`);
          continue;
        }
        converted += 1;
        updates[path] = key;
        console.log(`  ${target.collection}: ${currentKey ? `repaired ${currentKey} -> ` : ""}${key}`);
      }

      if (Object.keys(updates).length && apply) {
        await collection.updateOne({ _id: document._id }, { $set: updates });
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
