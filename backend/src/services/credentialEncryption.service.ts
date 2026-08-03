import crypto from "node:crypto";
import { env } from "../config/env.js";

const algorithm = "aes-256-gcm";

/**
 * Which secret is being protected. Carrier credentials and taxpayer identifiers
 * are unrelated concerns, so they use separate keys — rotating the DPD key must
 * not make stored tax IDs unreadable.
 */
export type SecretScope = "dpd" | "taxId";

const scopeKeyNames: Record<SecretScope, string> = {
  dpd: "DPD_CREDENTIAL_ENCRYPTION_KEY",
  taxId: "TAX_ID_ENCRYPTION_KEY"
};

function getEncryptionKey(scope: SecretScope): Buffer {
  const configuredKey = scope === "taxId" ? env.TAX_ID_ENCRYPTION_KEY : env.DPD_CREDENTIAL_ENCRYPTION_KEY;

  if (configuredKey) {
    return crypto.createHash("sha256").update(configuredKey).digest();
  }

  if (env.NODE_ENV === "production") {
    throw new Error(`${scopeKeyNames[scope]} is required in production`);
  }

  return crypto.createHash("sha256").update(env.JWT_SECRET).digest();
}

export function encryptSecret(value: unknown, scope: SecretScope = "dpd"): string {
  const plaintext = JSON.stringify(value);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, getEncryptionKey(scope), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, encrypted].map((part) => part.toString("base64")).join(".");
}

export function decryptSecret<T>(encryptedValue: string, scope: SecretScope = "dpd"): T {
  const [ivValue, authTagValue, encryptedPayload] = encryptedValue.split(".");

  if (!ivValue || !authTagValue || !encryptedPayload) {
    throw new Error("Encrypted secret is malformed");
  }

  const decipher = crypto.createDecipheriv(
    algorithm,
    getEncryptionKey(scope),
    Buffer.from(ivValue, "base64")
  );
  decipher.setAuthTag(Buffer.from(authTagValue, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPayload, "base64")),
    decipher.final()
  ]).toString("utf8");

  return JSON.parse(decrypted) as T;
}
