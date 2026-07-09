import crypto from "crypto";
import fs from "fs";
import path from "path";
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

export const businessDocumentUpload = multer({
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
