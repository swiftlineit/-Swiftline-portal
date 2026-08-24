import path from "node:path";
import { createMemoryUpload } from "./memoryUpload.js";
import { rateCardImportLimits } from "../services/rateCardImport.service.js";

const acceptedExtensions = new Set([".csv", ".xls", ".xlsx"]);

export const rateCardImportUpload = createMemoryUpload({
  field: "rateFile",
  maxBytes: rateCardImportLimits.maxBytes,
  accept: [
    "text/csv",
    "application/csv",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream"
  ],
  validate: (file) => acceptedExtensions.has(path.extname(file.originalname).toLowerCase())
    ? null
    : "Only .csv, .xls and .xlsx rate lists are supported.",
  messages: {
    tooLarge: "The rate list must be 5 MB or smaller.",
    unexpectedField: "Upload the rate list using the rateFile field.",
    wrongType: "Only CSV and Excel rate lists are supported.",
    failed: "Rate list upload failed."
  }
});
