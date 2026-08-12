import { createMemoryUpload } from "./memoryUpload.js";
import { maxSupportingDocumentBytes } from "../services/shipmentSupportingDocument.service.js";

/**
 * Buffers one post-booking supporting document in memory on its way to storage.
 * Uses the shared factory; only the field name and the size limit differ.
 */
export const shipmentSupportingDocumentUpload = createMemoryUpload({
  field: "document",
  maxBytes: maxSupportingDocumentBytes,
  accept: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
  messages: {
    tooLarge: "Each document must be 10 MB or smaller.",
    wrongType: "Upload a PDF, JPG, PNG or WebP file."
  }
});
