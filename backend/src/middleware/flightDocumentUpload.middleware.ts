import multer from "multer";

const storage = multer.memoryStorage();

export const flightDocumentUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter(_request, file, callback) {
    const allowed = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream"
    ];
    if (allowed.includes(file.mimetype)) callback(null, true);
    else callback(new Error("Only PDF, JPG, PNG, WebP, GIF or XLSX files are allowed."));
  }
});
