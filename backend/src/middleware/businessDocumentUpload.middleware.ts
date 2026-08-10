import { createMemoryUpload } from "./memoryUpload.js";

const documentFields = [
  "aadhaarCard",
  "panCard",
  "adCertificate",
  "msmeCertificate",
  "tanCertificate",
  "otherCertificate",
  "gstCertificate",
  "iecCertificate"
] as const;

export const businessDocumentUpload = createMemoryUpload({
  field: documentFields.map((name) => ({ name, maxCount: 1 })),
  maxBytes: 5 * 1024 * 1024,
  maxFiles: 8,
  accept: ["application/pdf", "image/jpeg", "image/png"],
  messages: {
    tooLarge: "Each document must be 5 MB or smaller.",
    tooMany: "Too many documents were uploaded.",
    unexpectedField: "Unexpected upload field. Only the provided document fields are allowed.",
    wrongType: "Only PDF, JPG, JPEG, and PNG files are supported",
    failed: "Document upload failed."
  }
});
