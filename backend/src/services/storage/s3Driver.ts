import crypto from "crypto";
import type { Readable } from "stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env.js";
import { assertValidStorageKey } from "./keys.js";
import { StorageObjectNotFoundError } from "./types.js";
import type { PutObjectInput, SignedUrlInput, StorageDriver, StoredObject } from "./types.js";

/**
 * Stores documents in S3.
 *
 * Credentials are shared with SES: on EC2/ECS both are omitted so the SDK falls
 * back to the instance role, which is why the credential block below is
 * conditional rather than always supplied.
 */

let cachedClient: S3Client | null = null;

function client() {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: env.S3_REGION ?? env.AWS_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}),
    ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY
          }
        }
      : {})
  });
  return cachedClient;
}

function bucket() {
  // env.ts refuses to boot without this when the driver is "s3", so reaching
  // here with it unset means the driver was constructed directly in a test.
  if (!env.S3_BUCKET) throw new Error("S3_BUCKET is not configured.");
  return env.S3_BUCKET;
}

/** Applies the optional environment prefix that lets one bucket serve two environments. */
function prefixed(key: string) {
  assertValidStorageKey(key);
  return env.S3_KEY_PREFIX ? `${env.S3_KEY_PREFIX.replace(/\/+$/, "")}/${key}` : key;
}

function isNotFound(error: unknown) {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

/**
 * Strips characters that would break the Content-Disposition header.
 *
 * A quote or newline in a filename would let the stored metadata inject
 * additional header directives, so anything outside a conservative set is
 * replaced rather than escaped.
 */
function safeFilename(filename: string) {
  return filename.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 200) || "document";
}

export const s3StorageDriver: StorageDriver = {
  name: "s3",

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const checksumSha256 = crypto.createHash("sha256").update(input.body).digest("hex");

    await client().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: prefixed(input.key),
        Body: input.body,
        ContentType: input.contentType,
        // Explicit even though the bucket sets it as a default: a bucket policy
        // change should not be able to silently start storing these unencrypted.
        ServerSideEncryption: "AES256",
        // Round-trips for support and for the migration backfill to verify
        // against. The key's filename stays a UUID regardless.
        Metadata: input.originalName
          ? { "original-name": encodeURIComponent(input.originalName) }
          : undefined
      })
    );

    return {
      key: input.key,
      size: input.body.length,
      checksumSha256,
      contentType: input.contentType,
      storedAt: new Date()
    };
  },

  async getObjectStream(key: string): Promise<Readable> {
    try {
      const result = await client().send(
        new GetObjectCommand({ Bucket: bucket(), Key: prefixed(key) })
      );
      if (!result.Body) throw new StorageObjectNotFoundError(key);
      return result.Body as Readable;
    } catch (error) {
      if (isNotFound(error)) throw new StorageObjectNotFoundError(key);
      throw error;
    }
  },

  async getObjectBuffer(key: string): Promise<Buffer> {
    try {
      const result = await client().send(
        new GetObjectCommand({ Bucket: bucket(), Key: prefixed(key) })
      );
      if (!result.Body) throw new StorageObjectNotFoundError(key);
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      if (isNotFound(error)) throw new StorageObjectNotFoundError(key);
      throw error;
    }
  },

  async deleteObject(key: string): Promise<void> {
    // S3 treats deleting a missing key as success, which matches the local
    // driver's behaviour. With bucket versioning on, this writes a delete marker
    // rather than destroying the object — the property the retention and legal
    // hold rules depend on.
    await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: prefixed(key) }));
  },

  async objectExists(key: string): Promise<boolean> {
    try {
      await client().send(new HeadObjectCommand({ Bucket: bucket(), Key: prefixed(key) }));
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  },

  async getSignedDownloadUrl(input: SignedUrlInput): Promise<string | null> {
    const filename = input.filename ? safeFilename(input.filename) : null;
    const disposition = input.disposition ?? "attachment";

    return getSignedUrl(
      client(),
      new GetObjectCommand({
        Bucket: bucket(),
        Key: prefixed(input.key),
        ...(filename
          ? { ResponseContentDisposition: `${disposition}; filename="${filename}"` }
          : {})
      }),
      {
        // Capped at the configured default: a caller asking for a longer link
        // than policy allows gets policy, not what it asked for.
        expiresIn: Math.min(
          input.expiresInSeconds ?? env.S3_SIGNED_URL_TTL_SECONDS,
          env.S3_SIGNED_URL_TTL_SECONDS
        )
      }
    );
  }
};
