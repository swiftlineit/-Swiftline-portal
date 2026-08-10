import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { maxClaimDocumentBytes } from "../services/claims/claimDocument.service.js";

/**
 * Buffers a claim document in memory rather than writing it to disk.
 *
 * Claim evidence goes straight to storage: a disk write would only create a
 * temporary file to clean up, and a failed upload would leave it behind. At
 * 10 MB with one file per request the memory cost is bounded.
 *
 * This was the first upload in the portal to work this way; every other one has
 * since followed, through the shared factory in `memoryUpload.ts`. This file
 * stays hand-written only because its size limit is owned by the claims service.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxClaimDocumentBytes, files: 1 },
  fileFilter: (_request, file, callback) => {
    // A first pass only. The declared type is whatever the client chose to send,
    // so the real check is the byte-signature validation in the service.
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) return callback(null, true);
    callback(new Error("Evidence must be a PDF, JPG, PNG, or WebP file."));
  }
}).single("document");

export function claimDocumentUpload(request: Request, response: Response, next: NextFunction) {
  upload(request, response, (error: unknown) => {
    if (!error) return next();

    const message =
      error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
        ? "Each document must be 10 MB or smaller."
        : error instanceof multer.MulterError && error.code === "LIMIT_FILE_COUNT"
          ? "Upload one document at a time."
          : error instanceof Error
            ? error.message
            : "Document upload failed.";

    return response.status(400).json({ success: false, message });
  });
}
