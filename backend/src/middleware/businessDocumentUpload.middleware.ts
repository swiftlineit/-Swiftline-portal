import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";

const privateUploadRoot = path.resolve(process.cwd(), "private_uploads", "business-accounts");
const allowedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const maxDocumentSizeBytes = 5 * 1024 * 1024;

fs.mkdirSync(privateUploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, privateUploadRoot);
  },
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${crypto.randomUUID()}${extension}`;
    callback(null, safeName);
  }
});

const uploadBusinessDocuments = multer({
  storage,
  limits: {
    fileSize: maxDocumentSizeBytes,
    files: 8
  },
  fileFilter: (_request, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error("Only PDF, JPG, JPEG, and PNG files are supported"));
      return;
    }

    callback(null, true);
  }
}).fields([
  { name: "aadhaarCard", maxCount: 1 },
  { name: "panCard", maxCount: 1 },
  { name: "adCertificate", maxCount: 1 },
  { name: "msmeCertificate", maxCount: 1 },
  { name: "tanCertificate", maxCount: 1 },
  { name: "otherCertificate", maxCount: 1 },
  { name: "gstCertificate", maxCount: 1 },
  { name: "iecCertificate", maxCount: 1 }
]);

// Remove any files multer already persisted before the request was rejected,
// so a failed upload never leaves orphaned documents on disk.
async function removePersistedUploads(request: Request) {
  const grouped = request.files as Record<string, Express.Multer.File[]> | undefined;
  if (!grouped) return;

  const paths = Object.values(grouped)
    .flat()
    .map((file) => file?.path)
    .filter((filePath): filePath is string => Boolean(filePath));

  await Promise.all(paths.map((filePath) => fs.promises.unlink(filePath).catch(() => undefined)));
}

function resolveUploadErrorMessage(error: unknown): string {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case "LIMIT_FILE_SIZE":
        return "Each document must be 5 MB or smaller.";
      case "LIMIT_FILE_COUNT":
        return "Too many documents were uploaded.";
      case "LIMIT_UNEXPECTED_FILE":
        return "Unexpected upload field. Only the provided document fields are allowed.";
      default:
        return error.message || "Document upload failed.";
    }
  }

  return error instanceof Error ? error.message : "Document upload failed.";
}

// Wrap the multer middleware so file-size, file-count, and file-type failures
// return a 400 with an actionable message instead of surfacing as a generic 500.
export function businessDocumentUpload(request: Request, response: Response, next: NextFunction) {
  uploadBusinessDocuments(request, response, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    void removePersistedUploads(request).finally(() => {
      response.status(400).json({ success: false, message: resolveUploadErrorMessage(error) });
    });
  });
}
