import {
  checksumOf,
  creditAgreementKey,
  deleteObject,
  putObject
} from "./storage/storage.service.js";

/**
 * Credit agreement PDFs.
 *
 * This module was already key-based before the S3 migration- it stored a
 * `storageKey` and resolved it through one function- so converting it meant
 * rewriting that function rather than changing what callers persist.
 *
 * The agreement number is deliberately not part of the key. A key's filename is
 * always a server-generated UUID, which is what makes storing a regenerated or
 * countersigned copy safe: it writes a new object rather than overwriting one a
 * client may already have been sent.
 */
export async function saveCreditAgreementPdf(input: {
  agreementId: string;
  agreementNumber: string;
  buffer: Buffer;
  storedAt: Date;
  documentType?: "generated" | "signed";
}) {
  const documentType = input.documentType ?? "generated";
  const safeNumber = input.agreementNumber.replace(/[^A-Za-z0-9_-]/g, "-");
  const originalName = `${safeNumber}${documentType === "signed" ? "-signed" : ""}.pdf`;

  const storageKey = creditAgreementKey(input.agreementId);
  await putObject({
    key: storageKey,
    body: input.buffer,
    contentType: "application/pdf",
    originalName
  });

  return {
    storageKey,
    originalName,
    mimeType: "application/pdf" as const,
    size: input.buffer.length,
    checksumSha256: checksumOf(input.buffer),
    storedAt: input.storedAt
  };
}

export async function removeCreditAgreementPdf(storageKey: string) {
  await deleteObject(storageKey);
}
