import crypto from "crypto";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import type { Readable } from "stream";
import { assertValidStorageKey } from "./keys.js";
import { StorageObjectNotFoundError } from "./types.js";
import type { PutObjectInput, SignedUrlInput, StorageDriver, StoredObject } from "./types.js";

/**
 * Stores documents under `private_uploads/`, matching where the portal's
 * existing uploads already live.
 *
 * This driver is the default and stays the default until a bucket is configured.
 * It is also what the test suite runs against, so it has to behave identically
 * to the S3 driver for everything except signed URLs, which it cannot provide.
 */

const storageRoot = path.resolve(process.cwd(), "private_uploads");

/**
 * Resolves a key to an absolute path, refusing anything that escapes the root.
 *
 * `assertValidStorageKey` already rejects `..` segments; this second check
 * catches whatever a future key builder might introduce, because the cost of
 * being wrong here is an arbitrary file read.
 */
function resolvePath(key: string) {
  assertValidStorageKey(key);
  const resolved = path.resolve(storageRoot, key);
  if (resolved !== storageRoot && !resolved.startsWith(`${storageRoot}${path.sep}`)) {
    throw new Error("Storage key is invalid.");
  }
  return resolved;
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

export const localStorageDriver: StorageDriver = {
  name: "local",

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const absolutePath = resolvePath(input.key);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    // "wx" fails rather than overwrites. Keys carry a UUID so a collision means
    // something is wrong upstream, and silently replacing a stored document is
    // the worst available outcome.
    await fs.writeFile(absolutePath, input.body, { flag: "wx" });

    return {
      key: input.key,
      size: input.body.length,
      checksumSha256: crypto.createHash("sha256").update(input.body).digest("hex"),
      contentType: input.contentType,
      storedAt: new Date()
    };
  },

  async getObjectStream(key: string): Promise<Readable> {
    const absolutePath = resolvePath(key);
    // Checked before opening so a missing file surfaces as a rejected promise
    // the caller can map to a 404, rather than as a stream "error" event fired
    // after response headers have already been sent.
    await fs.access(absolutePath).catch(() => {
      throw new StorageObjectNotFoundError(key);
    });
    return createReadStream(absolutePath);
  },

  async getObjectBuffer(key: string): Promise<Buffer> {
    try {
      return await fs.readFile(resolvePath(key));
    } catch (error) {
      if (isMissing(error)) throw new StorageObjectNotFoundError(key);
      throw error;
    }
  },

  async deleteObject(key: string): Promise<void> {
    try {
      await fs.unlink(resolvePath(key));
    } catch (error) {
      // Deleting something already gone is the desired end state, not a failure.
      if (!isMissing(error)) throw error;
    }
  },

  async objectExists(key: string): Promise<boolean> {
    try {
      await fs.access(resolvePath(key));
      return true;
    } catch {
      return false;
    }
  },

  async getSignedDownloadUrl(_input: SignedUrlInput): Promise<string | null> {
    // Local disk has no origin a browser could fetch from directly. Callers fall
    // back to streaming through the API, which is what claim documents do on
    // both drivers anyway.
    return null;
  }
};
