import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";

const privateUploadRoot = path.resolve(process.cwd(), "private_uploads", "invoices");
const allowedMimeTypes = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream"
]);
const maxInvoiceSizeBytes = 5 * 1024 * 1024;

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

export const invoiceUpload = multer({
  storage,
  limits: {
    fileSize: maxInvoiceSizeBytes,
    files: 1
  },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();

    if (extension !== ".xlsx" || !allowedMimeTypes.has(file.mimetype)) {
      callback(new Error("Only .xlsx invoice templates are supported"));
      return;
    }

    callback(null, true);
  }
}).single("invoiceFile");
