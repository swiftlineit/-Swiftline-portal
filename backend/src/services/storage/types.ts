import type { Readable } from "stream";

/**
 * The contract both storage drivers implement.
 *
 * Kept deliberately small. Every method a caller could reach for is a method
 * that has to behave identically on local disk and on S3, and the two have very
 * different primitives — so anything that cannot be expressed simply on both
 * belongs in the caller instead.
 */
export interface StorageDriver {
  readonly name: "local" | "s3";

  /** Stores bytes at `key`, overwriting nothing: keys are UUID-based and unique. */
  putObject(input: PutObjectInput): Promise<StoredObject>;

  /** Opens a read stream for server-side streaming to an authorised client. */
  getObjectStream(key: string): Promise<Readable>;

  /** Reads the whole object. For small documents that need hashing or parsing. */
  getObjectBuffer(key: string): Promise<Buffer>;

  /** Removes an object. Succeeds silently when the object is already gone. */
  deleteObject(key: string): Promise<void>;

  /** True when the object exists. Used by orphan checks and health probes. */
  objectExists(key: string): Promise<boolean>;

  /**
   * A time-limited URL the browser can fetch directly.
   *
   * The local driver cannot produce one and returns null, which is why callers
   * must always have a streaming fallback. Anything sensitive should use the
   * stream regardless: a signed URL stays valid until it expires, even if it is
   * forwarded out of the session that created it.
   */
  getSignedDownloadUrl(input: SignedUrlInput): Promise<string | null>;
}

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
  /**
   * Sent to S3 as object metadata and echoed back on download. Never used to
   * build the key — the key's filename is always a server-generated UUID.
   */
  originalName?: string;
}

export interface StoredObject {
  key: string;
  size: number;
  /** Hex SHA-256 of the stored bytes, for integrity checks and duplicate detection. */
  checksumSha256: string;
  contentType: string;
  storedAt: Date;
}

export interface SignedUrlInput {
  key: string;
  /** Filename the browser should save as. Sanitised by the driver. */
  filename?: string;
  /** Overrides the configured default TTL. Capped by the driver. */
  expiresInSeconds?: number;
  /** `attachment` forces a download; `inline` lets the browser render it. */
  disposition?: "inline" | "attachment";
}

/** Thrown when a key does not exist, so callers can map it to a 404. */
export class StorageObjectNotFoundError extends Error {
  readonly key: string;

  constructor(key: string) {
    super("Stored document was not found.");
    this.name = "StorageObjectNotFoundError";
    this.key = key;
  }
}
