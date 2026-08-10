import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import fs from "fs/promises";
import path from "path";
import {
  assertValidStorageKey,
  branchKycKey,
  businessAccountKycKey,
  claimDocumentKey,
  claimPrefix,
  podEvidenceKey,
  safeExtension,
  shipmentKycKey
} from "../services/storage/keys.js";
import { localStorageDriver } from "../services/storage/localDriver.js";
import { StorageObjectNotFoundError } from "../services/storage/types.js";

/**
 * These run against the local driver only. The S3 driver is exercised by the
 * migration verification described in S3_INTEGRATION_PLAN.md, because a
 * meaningful test of it needs a real bucket rather than a mock that would only
 * assert we call the SDK the way we already believe we call it.
 */

async function store(key: string, contents: string) {
  return localStorageDriver.putObject({
    key,
    body: Buffer.from(contents),
    contentType: "text/plain"
  });
}

after(async () => {
  // Every test writes under this one claim id, so removing the tree covers all
  // of them. `maxRetries` is not optional on Windows: a synced folder can still
  // hold a briefly-closed handle and reject the unlink with EPERM.
  await fs.rm(path.resolve(process.cwd(), "private_uploads", "claims", "test-claim"), {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
});

describe("storage keys", () => {
  it("puts every claim document under one prefix", () => {
    const evidence = claimDocumentKey({
      claimId: "claim123",
      documentType: "evidence",
      originalName: "damage.jpg"
    });
    const proof = claimDocumentKey({
      claimId: "claim123",
      documentType: "payment-proof",
      originalName: "utr.pdf"
    });

    assert.ok(evidence.startsWith(claimPrefix("claim123")));
    assert.ok(proof.startsWith(claimPrefix("claim123")));
    assert.ok(evidence.startsWith("claims/claim123/evidence/"));
    assert.ok(proof.startsWith("claims/claim123/payment-proof/"));
  });

  it("never reuses the client's filename", () => {
    const key = claimDocumentKey({
      claimId: "claim123",
      documentType: "evidence",
      originalName: "my holiday photo.jpg"
    });

    assert.ok(!key.includes("holiday"));
    assert.ok(key.endsWith(".jpg"));
  });

  it("generates a distinct key for the same filename twice", () => {
    const input = { claimId: "claim123", documentType: "evidence" as const, originalName: "a.png" };
    assert.notEqual(claimDocumentKey(input), claimDocumentKey(input));
  });

  it("strips traversal and double extensions from the filename", () => {
    const key = claimDocumentKey({
      claimId: "claim123",
      documentType: "evidence",
      originalName: "../../../etc/passwd.php.jpg"
    });

    assert.ok(!key.includes(".."));
    assert.ok(!key.includes("passwd"));
    assert.ok(!key.includes(".php"));
    assert.equal(key.split("/").length, 4);
  });

  it("falls back to a neutral extension for types we do not allow", () => {
    assert.equal(safeExtension("payload.exe"), "bin");
    assert.equal(safeExtension("script.sh"), "bin");
    assert.equal(safeExtension("no-extension"), "bin");
    assert.equal(safeExtension("scan.PDF"), "pdf");
  });

  it("uses forward slashes so keys are portable off Windows", () => {
    for (const key of [
      businessAccountKycKey("acct1", "kyc.pdf"),
      branchKycKey("branch1", "kyc.pdf"),
      shipmentKycKey("ship1", "kyc.pdf"),
      podEvidenceKey("assign1", "photo.jpg")
    ]) {
      assert.ok(!key.includes("\\"), `${key} contains a backslash`);
      assert.ok(key.includes("/"));
    }
  });

  it("rejects keys that could escape the storage root", () => {
    for (const key of ["", "/leading", "a//b", "../secret", "a/../../b", "a/./b", "back\\slash"]) {
      assert.throws(() => assertValidStorageKey(key), /invalid/i, `accepted ${JSON.stringify(key)}`);
    }
  });

  it("accepts the keys the builders produce", () => {
    assert.doesNotThrow(() =>
      assertValidStorageKey(
        claimDocumentKey({ claimId: "c1", documentType: "evidence", originalName: "a.jpg" })
      )
    );
  });
});

describe("local storage driver", () => {
  it("stores and reads back the same bytes", async () => {
    const key = claimDocumentKey({
      claimId: "test-claim",
      documentType: "evidence",
      originalName: "note.pdf"
    });
    const stored = await store(key, "claim evidence");

    assert.equal(stored.key, key);
    assert.equal(stored.size, Buffer.from("claim evidence").length);
    assert.equal((await localStorageDriver.getObjectBuffer(key)).toString(), "claim evidence");
  });

  it("reports the checksum of the stored bytes", async () => {
    const key = claimDocumentKey({
      claimId: "test-claim",
      documentType: "evidence",
      originalName: "hash.pdf"
    });
    const stored = await store(key, "hash me");

    // Recomputed from the file rather than trusted from the return value, so a
    // driver that reported a hash of the wrong buffer would fail here.
    const roundTripped = await localStorageDriver.getObjectBuffer(key);
    const { createHash } = await import("crypto");
    assert.equal(stored.checksumSha256, createHash("sha256").update(roundTripped).digest("hex"));
  });

  it("refuses to overwrite an existing key", async () => {
    const key = claimDocumentKey({
      claimId: "test-claim",
      documentType: "evidence",
      originalName: "once.pdf"
    });
    await store(key, "first");

    await assert.rejects(() => store(key, "second"));
    assert.equal((await localStorageDriver.getObjectBuffer(key)).toString(), "first");
  });

  it("raises a typed error for a missing object", async () => {
    await assert.rejects(
      () => localStorageDriver.getObjectBuffer("claims/test-claim/evidence/missing.pdf"),
      StorageObjectNotFoundError
    );
  });

  it("treats deleting a missing object as success", async () => {
    await assert.doesNotReject(() =>
      localStorageDriver.deleteObject("claims/test-claim/evidence/never-existed.pdf")
    );
  });

  it("reports existence correctly either side of a delete", async () => {
    const key = claimDocumentKey({
      claimId: "test-claim",
      documentType: "evidence",
      originalName: "gone.pdf"
    });
    await store(key, "here");

    assert.equal(await localStorageDriver.objectExists(key), true);
    await localStorageDriver.deleteObject(key);
    assert.equal(await localStorageDriver.objectExists(key), false);
  });

  it("has no signed URL to offer", async () => {
    assert.equal(await localStorageDriver.getSignedDownloadUrl({ key: "claims/a/evidence/b.pdf" }), null);
  });

  it("refuses to read outside the storage root", async () => {
    await assert.rejects(() => localStorageDriver.getObjectBuffer("../../../etc/passwd"), /invalid/i);
  });
});
