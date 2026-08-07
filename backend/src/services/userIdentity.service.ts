import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Canonical form used by the global user-phone unique index.
 *
 * Client-access invitations require a complete international number, so no
 * default country is guessed. This makes differently formatted versions of the
 * same number compare as one identity.
 */
export function normalizeUserPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const phone = parsePhoneNumberFromString(value.trim());
  return phone?.isValid() ? phone.number : null;
}

export function normalizeUserEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
