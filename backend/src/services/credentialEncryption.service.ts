import crypto from "node:crypto";
import { env } from "../config/env.js";

const algorithm = "aes-256-gcm";

/**
 * Which secret is being protected.
 *
 * Kept as a scope rather than collapsed away so a second class of secret can be
 * given its own key without re-encrypting the taxpayer identifiers and bank
 * account numbers already stored under this one.
 */
export type SecretScope = "taxId";

const scopeKeyNames: Record<SecretScope, string> = {
  taxId: "TAX_ID_ENCRYPTION_KEY"
};

function getEncryptionKey(scope: SecretScope): Buffer {
  const configuredKey = env.TAX_ID_ENCRYPTION_KEY;

  if (configuredKey) {
    return crypto.createHash("sha256").update(configuredKey).digest();
  }

  if (env.NODE_ENV === "production") {
    throw new Error(`${scopeKeyNames[scope]} is required in production`);
  }

  return crypto.createHash("sha256").update(env.JWT_SECRET).digest();
}

export function encryptSecret(value: unknown, scope: SecretScope = "taxId"): string {
  const plaintext = JSON.stringify(value);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, getEncryptionKey(scope), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, encrypted].map((part) => part.toString("base64")).join(".");
}

export function decryptSecret<T>(encryptedValue: string, scope: SecretScope = "taxId"): T {
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
