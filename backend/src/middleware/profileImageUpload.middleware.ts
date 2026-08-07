import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";

export const profileImageRoot = path.resolve(process.cwd(), "private_uploads", "profile-images");
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxImageSizeBytes = 3 * 1024 * 1024;

fs.mkdirSync(profileImageRoot, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_request, _file, callback) => callback(null, profileImageRoot),
    filename: (_request, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
    }
  }),
  limits: { fileSize: maxImageSizeBytes, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error("Choose a JPG, PNG, or WebP profile image."));
      return;
    }
    callback(null, true);
  }
}).single("profileImage");

export function profileImageUpload(request: Request, response: Response, next: NextFunction) {
  upload(request, response, (error: unknown) => {
    if (!error) return next();
    const message = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE"
      ? "The profile image must be 3 MB or smaller."
      : error instanceof Error ? error.message : "The profile image could not be uploaded.";
    return response.status(400).json({ success: false, message });
  });
}
