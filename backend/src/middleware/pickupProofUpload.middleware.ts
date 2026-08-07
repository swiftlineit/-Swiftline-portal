import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";

export const pickupProofRoot = path.resolve(process.cwd(), "private_uploads", "pickup-proofs");
fs.mkdirSync(pickupProofRoot, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, pickupProofRoot),
    filename: (_request, file, callback) => callback(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) return callback(new Error("Proof must be a JPG, PNG, or WebP image."));
    callback(null, true);
  }
}).single("proof");

export function pickupProofUpload(request: Request, response: Response, next: NextFunction) {
  upload(request, response, (error: unknown) => {
    if (!error) return next();
    const message = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
      ? "The proof image must be 5 MB or smaller."
      : error instanceof Error ? error.message : "Proof upload failed.";
    return response.status(400).json({ success: false, message });
  });
}
