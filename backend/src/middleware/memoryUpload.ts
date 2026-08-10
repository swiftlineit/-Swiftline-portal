import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";

/**
 * Builds an upload middleware that buffers files in memory.
 *
 * Every upload in the portal now goes to the storage service rather than to
 * local disk, so writing to disk first would only create a temporary file to
 * clean up — and a request that failed after the write would leave it behind.
 * That cleanup logic was duplicated in every upload middleware and in most of
 * the controllers behind them; buffering removes the need for all of it, since
 * a rejected request simply drops the buffer.
 *
 * Memory is bounded by `maxBytes * maxFiles` per in-flight request, which at the
 * portal's limits (5–10 MB, at most eight files) is a cost worth paying for not
 * having orphaned files on a shared disk.
 */

interface MemoryUploadOptions {
  /** A field name for a single file, or a multer field list for several. */
  field: string | multer.Field[];
  maxBytes: number;
  maxFiles?: number;
  /** Accepted MIME types — one list for every field, or one list per field. */
  accept: readonly string[] | Record<string, readonly string[]>;
  /** Rejection copy. Each falls back to a generic equivalent. */
  messages?: {
    tooLarge?: string | ((field: string | undefined) => string);
    tooMany?: string;
    unexpectedField?: string;
    wrongType?: string | ((field: string) => string);
    failed?: string;
  };
  /** Runs before the MIME check, for filters a type list cannot express. */
  validate?: (file: Express.Multer.File) => string | null;
}

function acceptedFor(accept: MemoryUploadOptions["accept"], fieldname: string) {
  return Array.isArray(accept) ? accept : (accept as Record<string, readonly string[]>)[fieldname] ?? [];
}

function resolve<T>(value: string | ((argument: T) => string) | undefined, argument: T, fallback: string) {
  if (typeof value === "function") return value(argument);
  return value ?? fallback;
}

export function createMemoryUpload(options: MemoryUploadOptions): RequestHandler {
  const messages = options.messages ?? {};

  const handler = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: options.maxBytes, files: options.maxFiles ?? 1 },
    fileFilter: (_request, file, callback) => {
      const rejection = options.validate?.(file);
      if (rejection) return callback(new Error(rejection));

      if (!acceptedFor(options.accept, file.fieldname).includes(file.mimetype)) {
        return callback(
          new Error(resolve(messages.wrongType, file.fieldname, "That file type is not supported."))
        );
      }

      callback(null, true);
    }
  });

  const run = typeof options.field === "string"
    ? handler.single(options.field)
    : handler.fields(options.field);

  return function memoryUploadMiddleware(request: Request, response: Response, next: NextFunction) {
    run(request, response, (error: unknown) => {
      if (!error) return next();

      // Surfaced as a 400 with actionable copy rather than as a generic 500,
      // because every one of these is something the client can correct.
      const message =
        error instanceof multer.MulterError
          ? error.code === "LIMIT_FILE_SIZE"
            ? resolve(messages.tooLarge, error.field, "The file is too large.")
            : error.code === "LIMIT_FILE_COUNT"
              ? messages.tooMany ?? "Too many files were uploaded."
              : error.code === "LIMIT_UNEXPECTED_FILE"
                ? messages.unexpectedField ?? "Unexpected upload field."
                : error.message || messages.failed || "File upload failed."
          : error instanceof Error
            ? error.message
            : messages.failed ?? "File upload failed.";

      return response.status(400).json({ success: false, message });
    });
  };
}
