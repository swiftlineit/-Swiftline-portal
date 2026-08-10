import { createMemoryUpload } from "./memoryUpload.js";

export const pickupProofUpload = createMemoryUpload({
  field: "proof",
  maxBytes: 5 * 1024 * 1024,
  accept: ["image/jpeg", "image/png", "image/webp"],
  messages: {
    tooLarge: "The proof image must be 5 MB or smaller.",
    wrongType: "Proof must be a JPG, PNG, or WebP image.",
    failed: "Proof upload failed."
  }
});
