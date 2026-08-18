import { objectExists } from "./storage.service.js";

/**
 * Reads documents whose rows predate the storage service.
 *
 * POD evidence and pickup proofs were written when the model held an absolute
 * filesystem path. The schema moved to a storage key; the stored documents never
 * did. `migrateEvidenceStorageKeys.ts` backfills them, but the read path cannot
 * depend on that having been run- against production it has not, and a customer
 * looking at a delivered shipment should not see "POD evidence file was not
 * found" because a maintenance script is outstanding.
 *
 * So this resolves at read time as well. The backfill is still worth running:
 * it makes the lookup a single field read instead of an existence probe, and it
 * is what finally lets these rows move to S3.
 */

/**
 * The storage key for a legacy absolute path.
 *
 * A key is resolved by the driver relative to the storage root, so the key is
 * the part of the path after `private_uploads/`- `pod-evidence/<file>`. It is
 * emphatically *not* built from `storageModules.pod`: that constant is where new
 * uploads go, and these files were written before it existed.
 *
 * Returns null for anything that would not survive `assertValidStorageKey`,
 * which matters because a `..` segment would escape the storage root.
 */
export function storageKeyFromLegacyPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const marker = "/private_uploads/";
  const index = normalized.lastIndexOf(marker);
  if (index === -1) return null;

  const remainder = normalized.slice(index + marker.length);
  const invalid =
    remainder.length === 0 ||
    remainder.startsWith("/") ||
    remainder.includes("//") ||
    remainder.split("/").some((segment) => segment === "." || segment === "..");

  return invalid ? null : remainder;
}

/**
 * The key that actually reads a file for an evidence or proof row.
 *
 * Tried in order: the stored key, then a key derived from the legacy path.
 * The stored key is probed rather than trusted because an earlier version of the
 * backfill wrote keys under the wrong prefix- those rows have a `storageKey`
 * that points at nothing, and preferring it blindly would keep them broken.
 *
 * Returns null when neither candidate resolves, so the caller can report a
 * missing file rather than stream a 404 body as if it were an image.
 */
export async function resolveEvidenceKey(row: {
  storageKey?: unknown;
  path?: unknown;
}): Promise<string | null> {
  const stored = typeof row.storageKey === "string" ? row.storageKey : "";
  if (stored && (await objectExists(stored))) return stored;

  const legacy = typeof row.path === "string" ? row.path : "";
  const derived = legacy ? storageKeyFromLegacyPath(legacy) : null;
  if (derived && (await objectExists(derived))) return derived;

  return null;
}
