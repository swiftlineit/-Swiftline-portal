import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

const defaultPrivateRoot = path.resolve(process.cwd(), "private_uploads");

function privateRoot(root?: string) {
  return path.resolve(root ?? defaultPrivateRoot);
}

export async function saveCreditAgreementPdf(input: {
  agreementId: string;
  agreementNumber: string;
  buffer: Buffer;
  storedAt: Date;
  storageRoot?: string;
  documentType?: "generated" | "signed";
}) {
  const root = privateRoot(input.storageRoot);
  const directory = path.join(root, "credit-agreements");
  await fs.mkdir(directory, { recursive: true });
  const safeNumber = input.agreementNumber.replace(/[^A-Za-z0-9_-]/g, "-");
  const documentType = input.documentType ?? "generated";
  const filename = `${safeNumber}-${documentType}-${input.agreementId}-${crypto.randomUUID()}.pdf`;
  const absolutePath = path.join(directory, filename);
  await fs.writeFile(absolutePath, input.buffer, { flag: "wx" });

  return {
    storageKey: path.posix.join("credit-agreements", filename),
    originalName: `${safeNumber}${documentType === "signed" ? "-signed" : ""}.pdf`,
    mimeType: "application/pdf" as const,
    size: input.buffer.length,
    checksumSha256: crypto.createHash("sha256").update(input.buffer).digest("hex"),
    storedAt: input.storedAt
  };
}

export function resolveCreditAgreementPdfPath(storageKey: string, storageRoot?: string) {
  const root = privateRoot(storageRoot);
  const resolved = path.resolve(root, storageKey);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Credit agreement document path is invalid.");
  }
  return resolved;
}

export async function removeCreditAgreementPdf(storageKey: string, storageRoot?: string) {
  const absolutePath = resolveCreditAgreementPdfPath(storageKey, storageRoot);
  await fs.unlink(absolutePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
