import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/**
 * Canonical form used by the global user-phone unique index.
 *
 * Client-access invitations require a complete international number, so by
 * default no country is guessed. This makes differently formatted versions of
 * the same number compare as one identity.
 *
 * `defaultCountry` is for the internal staff form, where numbers are typed
 * without a country code often enough that rejecting them outright is a poor
 * trade. The result is still E.164, so a staff record and a client record for
 * the same person collide on the unique index either way.
 */
export function normalizeUserPhone(value: unknown, defaultCountry?: CountryCode): string | null {
  if (typeof value !== "string") return null;
  const phone = parsePhoneNumberFromString(value.trim(), defaultCountry);
  return phone?.isValid() ? phone.number : null;
}

export function normalizeUserEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
