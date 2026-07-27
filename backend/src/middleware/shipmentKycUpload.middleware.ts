import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";

const privateUploadRoot = path.resolve(process.cwd(), "private_uploads", "shipment-kyc");
const allowedMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const maxDocumentSizeBytes = 5 * 1024 * 1024;

fs.mkdirSync(privateUploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, privateUploadRoot);
  },
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  }
});

const uploadKycDocument = multer({
  storage,
  limits: {
    fileSize: maxDocumentSizeBytes,
    files: 1
  },
  fileFilter: (_request, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error("Only PDF, JPG, JPEG, and PNG files are supported"));
      return;
    }

    callback(null, true);
  }
}).single("document");

function resolveUploadErrorMessage(error: unknown): string {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case "LIMIT_FILE_SIZE":
        return "Each KYC document must be 5 MB or smaller.";
      case "LIMIT_FILE_COUNT":
        return "Upload one KYC document at a time.";
      case "LIMIT_UNEXPECTED_FILE":
        return "Unexpected upload field. Send the file as \"document\".";
      default:
        return error.message || "KYC document upload failed.";
    }
  }

  return error instanceof Error ? error.message : "KYC document upload failed.";
}

// Wrap multer so file-size, file-count, and file-type failures return an
// actionable 400 instead of surfacing as a generic 500.
export function shipmentKycUpload(request: Request, response: Response, next: NextFunction) {
  uploadKycDocument(request, response, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    const uploadedPath = request.file?.path;
    const cleanup = uploadedPath
      ? fs.promises.unlink(uploadedPath).catch(() => undefined)
      : Promise.resolve();

    void cleanup.finally(() => {
      response.status(400).json({ success: false, message: resolveUploadErrorMessage(error) });
    });
  });
}
