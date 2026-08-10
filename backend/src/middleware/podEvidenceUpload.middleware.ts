import { createMemoryUpload } from "./memoryUpload.js";

export const podEvidenceUpload = createMemoryUpload({
  field: "evidence",
  maxBytes: 10 * 1024 * 1024,
  accept: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  messages: {
    tooLarge: "Evidence must be 10 MB or smaller.",
    wrongType: "Evidence must be a JPG, PNG, WebP, or PDF file.",
    failed: "Evidence upload failed."
  }
});
