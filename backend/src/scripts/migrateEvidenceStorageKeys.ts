/**
 * Moves POD evidence and pickup proofs onto storage keys.
 *
 * These rows were written before `storage.service.ts` existed, when the model
 * held an absolute filesystem path — the very thing the current schema comment
 * says was removed because it tied every file to one server's disk. The schema
 * was changed; the stored documents never were.
 *
 * The consequence is live, not theoretical: every reader resolves
 * `storageKey`, which is undefined on these rows, so viewing existing POD
 * evidence or pickup proof in the portal fails today.
 *
 * The file itself is left exactly where it is. Only the pointer is rewritten,
 * from an absolute path to the module-relative key the storage service
 * understands, which is why this is safe to run against live data — nothing is
 * copied, moved or deleted.
 *
 * Dry run (default):
 *   npx tsx src/scripts/migrateEvidenceStorageKeys.ts
 * Apply:
 *   npx tsx src/scripts/migrateEvidenceStorageKeys.ts --apply
 *
 * Safe to run more than once: rows that already carry a key are skipped.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { existsSync } from "node:fs";

const apply = process.argv.includes("--apply");

/**
 * The storage-relative key for a legacy absolute path.
 *
 * Keys are `<module>/<...>/<file>`, and the legacy paths end
 * `private_uploads/<module-folder>/<file>`. The filename is preserved so the
 * file on disk still answers to its key.
 */
function keyFromLegacyPath(path: string, moduleFolder: string, module: string) {
  const normalized = path.replace(/\\/g, "/");
  const marker = `/${moduleFolder}/`;
  const index = normalized.lastIndexOf(marker);
  if (index === -1) return null;
  const remainder = normalized.slice(index + marker.length);
  // Reject anything that would not survive assertValidStorageKey.
  if (!remainder || remainder.includes("//") || remainder.split("/").some((part) => part === "." || part === "..")) return null;
  return `${module}/${remainder}`;
}

type Target = {
  collection: string;
  /** Where the files sit under private_uploads. */
  moduleFolder: string;
  /** The storage module prefix the key must carry. */
  module: string;
  /** Dotted path to the array of evidence rows, or null for a flat document. */
  arrayField: string | null;
};

const targets: Target[] = [
  { collection: "podrevisions", moduleFolder: "pod-evidence", module: "pod", arrayField: "evidence" },
  { collection: "pickupproofs", moduleFolder: "pickup-proofs", module: "pickup", arrayField: null }
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
        if (row.storageKey) { alreadyKeyed += 1; return row; }
        const legacy = typeof row.path === "string" ? row.path : "";
        const key = legacy ? keyFromLegacyPath(legacy, target.moduleFolder, target.module) : null;
        if (!key) {
          unconvertible += 1;
          console.log(`  ${target.collection}: cannot derive a key from ${legacy || "(no path)"}`);
          return row;
        }
        // Reported, not skipped: the pointer is still worth fixing so the row
        // stops erroring, and a genuinely absent file is its own problem.
        if (!existsSync(legacy)) {
          missingFile += 1;
          console.log(`  ${target.collection}: file absent on disk for ${key}`);
        }
        converted += 1;
        changed = true;
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

  console.log(`\nalready on storage keys : ${alreadyKeyed}`);
  console.log(`convertible             : ${converted}${apply ? " (written)" : " (would be written)"}`);
  console.log(`file absent on disk     : ${missingFile}`);
  console.log(`could not derive a key  : ${unconvertible}`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
