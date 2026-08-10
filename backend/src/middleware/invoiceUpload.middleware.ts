import path from "path";
import { createMemoryUpload } from "./memoryUpload.js";

export const invoiceUpload = createMemoryUpload({
  field: "invoiceFile",
  maxBytes: 5 * 1024 * 1024,
  accept: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    // Some browsers send no useful type for a workbook picked from disk. The
    // extension check below and the workbook parse are what actually decide.
    "application/octet-stream"
  ],
  validate: (file) => path.extname(file.originalname).toLowerCase() === ".xlsx"
    ? null
    : "Only .xlsx invoice templates are supported",
  messages: {
    tooLarge: "The invoice file must be 5 MB or smaller.",
    tooMany: "Upload one invoice at a time.",
    wrongType: "Only .xlsx invoice templates are supported",
    failed: "Invoice upload failed."
  }
});
