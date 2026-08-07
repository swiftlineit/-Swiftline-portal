import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";

export const podEvidenceRoot = path.resolve(process.cwd(), "private_uploads", "pod-evidence");
fs.mkdirSync(podEvidenceRoot, { recursive: true });

const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, podEvidenceRoot),
    filename: (_request, file, callback) => callback(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => allowed.has(file.mimetype) ? callback(null, true) : callback(new Error("Evidence must be a JPG, PNG, WebP, or PDF file."))
}).single("evidence");

export function podEvidenceUpload(request: Request, response: Response, next: NextFunction) {
  upload(request, response, (error: unknown) => {
    if (!error) return next();
    const message = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE" ? "Evidence must be 10 MB or smaller." : error instanceof Error ? error.message : "Evidence upload failed.";
    return response.status(400).json({ success: false, message });
  });
}
