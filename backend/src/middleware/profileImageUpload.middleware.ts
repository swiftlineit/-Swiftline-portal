import { createMemoryUpload } from "./memoryUpload.js";

export const maxProfileImageBytes = 3 * 1024 * 1024;

export const profileImageUpload = createMemoryUpload({
  field: "profileImage",
  maxBytes: maxProfileImageBytes,
  accept: ["image/jpeg", "image/png", "image/webp"],
  messages: {
    tooLarge: "The profile image must be 3 MB or smaller.",
    wrongType: "Choose a JPG, PNG, or WebP profile image.",
    failed: "The profile image could not be uploaded."
  }
});
