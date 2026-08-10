import crypto from "crypto";
import type { Response } from "express";
import { env } from "../../config/env.js";
import { localStorageDriver } from "./localDriver.js";
import { s3StorageDriver } from "./s3Driver.js";
import { StorageObjectNotFoundError } from "./types.js";
import type { PutObjectInput, SignedUrlInput, StorageDriver, StoredObject } from "./types.js";

/**
 * The portal's single entry point for stored documents.
 *
 * Callers never learn which driver is active. That is the whole point: moving a
 * module from local disk to S3 becomes a configuration change plus a backfill,
 * with no change to the code that uploads or reads.
 *
 * Records must persist the returned `key` and nothing else — never an absolute
 * path, never a URL. A row holding an absolute path is tied to one server's
 * filesystem forever, which is exactly the problem the POD evidence rows have
 * and why they need a backfill before that module can move.
 */

function driver(): StorageDriver {
  return env.STORAGE_DRIVER === "s3" ? s3StorageDriver : localStorageDriver;
}

/** Which driver is serving requests. For health endpoints and diagnostics. */
export function activeStorageDriver() {
  return driver().name;
}

export async function putObject(input: PutObjectInput): Promise<StoredObject> {
  return driver().putObject(input);
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  return driver().getObjectBuffer(key);
}

export async function deleteObject(key: string): Promise<void> {
  return driver().deleteObject(key);
}

export async function objectExists(key: string): Promise<boolean> {
  return driver().objectExists(key);
}

export async function getSignedDownloadUrl(input: SignedUrlInput): Promise<string | null> {
  return driver().getSignedDownloadUrl(input);
}

/**
 * Streams a stored document to an already-authorised response.
 *
 * The caller is responsible for authorisation — this function has no way to
 * know who is asking, and deliberately does not try to guess.
 *
 * Streaming rather than redirecting to a signed URL is the right default for
 * anything sensitive. A signed URL remains valid for its whole TTL wherever it
 * travels, so one forwarded in an email or captured in a browser history is
 * readable by whoever holds it. A streamed response dies with the session.
 */
export async function streamObjectToResponse(input: {
  response: Response;
  key: string;
  contentType: string;
  filename: string;
  disposition?: "inline" | "attachment";
}) {
  const stream = await driver().getObjectStream(input.key);

  const filename = input.filename.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 200) || "document";
  input.response.setHeader("Content-Type", input.contentType);
  input.response.setHeader(
    "Content-Disposition",
    `${input.disposition ?? "attachment"}; filename="${filename}"`
  );
  // Claim evidence and bank proofs must not linger in a shared or browser cache.
  input.response.setHeader("Cache-Control", "private, no-store");
  input.response.setHeader("X-Content-Type-Options", "nosniff");

  return new Promise<void>((resolve, reject) => {
    stream.on("error", (error) => {
      // Once bytes are flowing the status line is already sent, so the only
      // honest thing left is to break the connection rather than append an
      // error body to a partial document.
      if (!input.response.headersSent) reject(error);
      else {
        input.response.destroy(error);
        resolve();
      }
    });
    stream.on("end", resolve);
    stream.pipe(input.response);
  });
}

/** Hex SHA-256, for integrity checks and duplicate detection before storing. */
export function checksumOf(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export { StorageObjectNotFoundError };
export * from "./keys.js";
