import { createMemoryUpload } from "./memoryUpload.js";

export const dashboardBannerUpload = createMemoryUpload({
  field: "image",
  maxBytes: 8 * 1024 * 1024,
  accept: ["image/jpeg", "image/png", "image/webp"],
  messages: {
    tooLarge: "The banner image must be 8 MB or smaller.",
    unexpectedField: "Upload one banner image using the image field.",
    wrongType: "Choose a JPG, PNG, or WebP banner image.",
    failed: "Banner image upload failed."
  }
});
