import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import fs from "fs/promises";
import path from "path";
import { resolveEvidenceKey, storageKeyFromLegacyPath } from "../services/storage/legacyKeys.js";
import { localStorageDriver } from "../services/storage/localDriver.js";

/**
 * Covers the reason POD evidence stopped being viewable: rows written before
 * storage keys existed, and rows an early version of the backfill keyed under a
 * prefix that does not exist.
 *
 * Runs against the local driver and the real filesystem, because the whole
 * question is whether a key lands on a file — which a mock cannot answer.
 */

const root = path.resolve(process.cwd(), "private_uploads");
const folder = "legacy-keys-test";

async function storeFixture(name: string) {
  const key = `${folder}/${name}`;
  await localStorageDriver.putObject({
    key,
    body: Buffer.from("evidence"),
    contentType: "image/png"
  });
  return { key, absolutePath: path.join(root, folder, name) };
}

after(async () => {
  await fs.rm(path.join(root, folder), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("storageKeyFromLegacyPath", () => {
  it("takes the path after the storage root, not the module prefix", () => {
    const key = storageKeyFromLegacyPath("/var/www/app/private_uploads/pod-evidence/abc.png");
    assert.equal(key, "pod-evidence/abc.png");
  });

  it("handles Windows separators", () => {
    const key = storageKeyFromLegacyPath("C:\\app\\private_uploads\\pickup-proofs\\a.png");
    assert.equal(key, "pickup-proofs/a.png");
  });

  it("refuses a path that would escape the storage root", () => {
    assert.equal(storageKeyFromLegacyPath("/app/private_uploads/../../etc/passwd"), null);
  });

  it("refuses a path that is not under the storage root at all", () => {
    assert.equal(storageKeyFromLegacyPath("/somewhere/else/abc.png"), null);
  });

  it("refuses an empty remainder", () => {
    assert.equal(storageKeyFromLegacyPath("/app/private_uploads/"), null);
  });
});

describe("resolveEvidenceKey", () => {
  it("uses the stored key when it reads a real file", async () => {
    const { key } = await storeFixture("stored.png");
    assert.equal(await resolveEvidenceKey({ storageKey: key }), key);
  });

  it("falls back to the legacy path when there is no stored key", async () => {
    const { key, absolutePath } = await storeFixture("legacy-only.png");
    assert.equal(await resolveEvidenceKey({ path: absolutePath }), key);
  });

  it("falls back when the stored key points at nothing", async () => {
    // The exact shape the first backfill produced: a plausible-looking key
    // under a prefix that was never created.
    const { key, absolutePath } = await storeFixture("wrongly-keyed.png");
    const resolved = await resolveEvidenceKey({
      storageKey: "pod/wrongly-keyed.png",
      path: absolutePath
    });
    assert.equal(resolved, key);
  });

  it("returns null when neither candidate resolves", async () => {
    const resolved = await resolveEvidenceKey({
      storageKey: "pod/missing.png",
      path: path.join(root, folder, "never-written.png")
    });
    assert.equal(resolved, null);
  });

  it("returns null rather than throwing on a traversal key", async () => {
    assert.equal(await resolveEvidenceKey({ storageKey: "../../etc/passwd" }), null);
  });

  it("returns null for a row with neither field", async () => {
    assert.equal(await resolveEvidenceKey({}), null);
  });
});
