import path from "path";
import { createMemoryUpload } from "./memoryUpload.js";
import { shipmentImportLimits } from "../services/shipmentImport/shipmentImportContract.js";

export const shipmentImportUpload = createMemoryUpload({
  field: [{ name: "shipmentFiles", maxCount: shipmentImportLimits.filesPerBatch }],
  maxBytes: 5 * 1024 * 1024,
  maxFiles: shipmentImportLimits.filesPerBatch,
  accept: {
    shipmentFiles: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream"
    ]
  },
  validate: (file) => path.extname(file.originalname).toLowerCase() === ".xlsx"
    ? null
    : "Only .xlsx shipment import templates are supported.",
  messages: {
    tooLarge: "Each shipment workbook must be 5 MB or smaller.",
    tooMany: `Upload no more than ${shipmentImportLimits.filesPerBatch} shipment workbooks at once.`,
    unexpectedField: "Upload shipment workbooks using the shipmentFiles field.",
    wrongType: "Only .xlsx shipment import templates are supported.",
    failed: "Shipment import upload failed."
  }
});
