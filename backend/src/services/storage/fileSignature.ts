/**
 * Magic-byte validation for uploaded documents.
 *
 * A declared MIME type is whatever the client chose to send, so every upload is
 * checked against the bytes that actually arrived. This used to be done per
 * controller by opening the file multer had written and reading its first few
 * bytes; now that uploads are buffered in memory on their way to S3, there is no
 * file to open and the check is a pure function over the buffer.
 */

type SignatureTest = (buffer: Buffer) => boolean;

const isPdf: SignatureTest = (buffer) => buffer.subarray(0, 5).toString("latin1") === "%PDF-";

const isJpeg: SignatureTest = (buffer) =>
  buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

const isPng: SignatureTest = (buffer) =>
  buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

const isWebp: SignatureTest = (buffer) =>
  buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
  buffer.subarray(8, 12).toString("latin1") === "WEBP";

// XLSX is a ZIP container, so the signature check can only confirm that much.
// The real validation is the workbook parse the invoice controller already does.
const isZip: SignatureTest = (buffer) =>
  buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07);

const signaturesByMimeType: Record<string, SignatureTest> = {
  "application/pdf": isPdf,
  "image/jpeg": isJpeg,
  "image/png": isPng,
  "image/webp": isWebp,
  "image/gif": (buffer) => buffer.subarray(0, 3).toString("latin1") === "GIF",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": isZip,
  "application/octet-stream": isZip
};

/** True when the bytes match the type the client declared for them. */
export function matchesDeclaredType(buffer: Buffer, mimeType: string) {
  const test = signaturesByMimeType[mimeType];
  return test ? test(buffer) : false;
}

/**
 * True when the bytes are a PDF, JPEG, or PNG — the set every KYC and staff
 * document field accepts, regardless of which of the three was declared.
 *
 * Deliberately looser than `matchesDeclaredType`: a browser mislabelling a JPEG
 * as `image/png` is a nuisance, not an attack, and the three formats are
 * interchangeable everywhere this is used.
 */
export function isSupportedDocument(buffer: Buffer) {
  return isPdf(buffer) || isJpeg(buffer) || isPng(buffer);
}

/** As above, for the image-only fields: JPEG, PNG, or WebP. */
export function isSupportedImage(buffer: Buffer) {
  return isJpeg(buffer) || isPng(buffer) || isWebp(buffer);
}
