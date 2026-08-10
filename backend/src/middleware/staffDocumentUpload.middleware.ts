import { createMemoryUpload } from "./memoryUpload.js";

const documentTypes = ["application/pdf", "image/jpeg", "image/png"];
const profileImageTypes = ["image/jpeg", "image/png", "image/webp"];

// Field names mirror the staff document types on the user model: `aadhaar` is
// mandatory and is enforced by the controller, the other two are optional.
export const staffDocumentUpload = createMemoryUpload({
  field: [
    { name: "aadhaar", maxCount: 1 },
    { name: "pan", maxCount: 1 },
    { name: "other", maxCount: 1 },
    { name: "profileImage", maxCount: 1 }
  ],
  maxBytes: 5 * 1024 * 1024,
  maxFiles: 4,
  accept: {
    aadhaar: documentTypes,
    pan: documentTypes,
    other: documentTypes,
    profileImage: profileImageTypes
  },
  messages: {
    // The 3 MB profile-image limit is enforced by the controller rather than
    // here, because multer applies one size limit across every field.
    tooLarge: (field) => field === "profileImage"
      ? "The profile image must be 3 MB or smaller."
      : "Each document must be 5 MB or smaller.",
    tooMany: "Too many documents were uploaded.",
    unexpectedField: "Unexpected upload field. Upload only the profile image and supported staff documents.",
    wrongType: (field) => field === "profileImage"
      ? "Choose a JPG, PNG, or WebP profile image."
      : "Only PDF, JPG, JPEG, and PNG files are supported",
    failed: "Document upload failed."
  }
});
