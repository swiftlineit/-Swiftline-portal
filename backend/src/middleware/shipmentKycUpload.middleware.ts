import { createMemoryUpload } from "./memoryUpload.js";

export const shipmentKycUpload = createMemoryUpload({
  field: "document",
  maxBytes: 5 * 1024 * 1024,
  accept: ["application/pdf", "image/jpeg", "image/png"],
  messages: {
    tooLarge: "Each KYC document must be 5 MB or smaller.",
    tooMany: "Upload one KYC document at a time.",
    unexpectedField: "Unexpected upload field. Send the file as \"document\".",
    wrongType: "Only PDF, JPG, JPEG, and PNG files are supported",
    failed: "KYC document upload failed."
  }
});
