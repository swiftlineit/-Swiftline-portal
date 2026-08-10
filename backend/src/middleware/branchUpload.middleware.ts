import { createMemoryUpload } from "./memoryUpload.js";

export const branchUpload = createMemoryUpload({
  field: [
    { name: "images", maxCount: 5 },
    { name: "document", maxCount: 1 }
  ],
  maxBytes: 5 * 1024 * 1024,
  maxFiles: 8,
  accept: {
    images: ["image/jpeg", "image/png", "image/gif", "image/webp"],
    document: ["application/pdf", "image/jpeg", "image/png"]
  },
  messages: {
    tooLarge: "Each file must be 5 MB or smaller.",
    tooMany: "Too many files were uploaded.",
    unexpectedField: "Unexpected upload field.",
    wrongType: (field) => field === "images"
      ? "Only JPG, JPEG, PNG, GIF, and WebP images are supported"
      : "Only PDF, JPG, JPEG, and PNG files are supported for documents",
    failed: "File upload failed."
  }
});
