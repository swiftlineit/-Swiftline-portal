import path from "node:path";
import { createMemoryUpload } from "./memoryUpload.js";
import { addressBookImportLimits } from "../services/addressBookImport.service.js";

const acceptedExtensions = new Set([".csv", ".xlsx"]);

export const addressBookImportUpload = createMemoryUpload({
  field: "addressFile",
  maxBytes: addressBookImportLimits.maxBytes,
  accept: [
    "text/csv",
    "application/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream"
  ],
  validate: (file) => acceptedExtensions.has(path.extname(file.originalname).toLowerCase())
    ? null
    : "Only .csv and .xlsx address-book files are supported.",
  messages: {
    tooLarge: "The address-book file must be 5 MB or smaller.",
    unexpectedField: "Upload the address-book file using the addressFile field.",
    wrongType: "Only CSV and Excel address-book files are supported.",
    failed: "Address-book import upload failed."
  }
});
