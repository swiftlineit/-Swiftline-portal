import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";

const privateUploadRoot = path.resolve(process.cwd(), "private_uploads", "branches");

const allowedImageMimeTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const allowedDocumentMimeTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);

const maxFileSizeBytes = 5 * 1024 * 1024;

fs.mkdirSync(path.join(privateUploadRoot, "images"), { recursive: true });
fs.mkdirSync(path.join(privateUploadRoot, "documents"), { recursive: true });

const storage = multer.diskStorage({
  destination: (_request, file, callback) => {
    const subDir = file.fieldname === "images" ? "images" : "documents";
    callback(null, path.join(privateUploadRoot, subDir));
  },
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${crypto.randomUUID()}${extension}`;
    callback(null, safeName);
  }
});

const uploadBranchFiles = multer({
  storage,
  limits: {
    fileSize: maxFileSizeBytes,
    files: 8
  },
  fileFilter: (_request, file, callback) => {
    if (file.fieldname === "images") {
      if (!allowedImageMimeTypes.has(file.mimetype)) {
        callback(new Error("Only JPG, JPEG, PNG, GIF, and WebP images are supported"));
        return;
      }
    } else {
      if (!allowedDocumentMimeTypes.has(file.mimetype)) {
        callback(new Error("Only PDF, JPG, JPEG, and PNG files are supported for documents"));
        return;
      }
    }
    callback(null, true);
  }
}).fields([
  { name: "images", maxCount: 5 },
  { name: "document", maxCount: 1 }
]);

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
        return "Each file must be 5 MB or smaller.";
      case "LIMIT_FILE_COUNT":
        return "Too many files were uploaded.";
      case "LIMIT_UNEXPECTED_FILE":
        return "Unexpected upload field.";
      default:
        return error.message || "File upload failed.";
    }
  }

  return error instanceof Error ? error.message : "File upload failed.";
}

export function branchUpload(request: Request, response: Response, next: NextFunction) {
  uploadBranchFiles(request, response, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    void removePersistedUploads(request).finally(() => {
      response.status(400).json({ success: false, message: resolveUploadErrorMessage(error) });
    });
  });
}
