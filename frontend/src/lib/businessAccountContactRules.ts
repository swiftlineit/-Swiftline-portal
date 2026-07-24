import { parsePhoneNumberFromString } from "libphonenumber-js";

// Single source of truth for contact-level business-account validation on the
// frontend.
//
// KEEP IN SYNC with the backend, which mirrors these rules for authoritative
// server-side validation (separate package, so they cannot share a module):
//   portal/backend/src/services/businessAccountRules.ts

// Maximum requested credit limit accepted on a business account.
export const BUSINESS_ACCOUNT_CREDIT_LIMIT_MAX = 100000;

const allowedPersonalEmailDomains = new Set(["gmail.com", "yahoo.com", "outlook.com"]);
const reservedPersonalEmailNames = new Set(["gmail", "yahoo", "outlook", "hotmail"]);
const blockedEmailTlds = new Set(["con", "comm", "cpm", "coom", "om"]);

export const emailValidationMessage = "Use gmail.com, yahoo.com, outlook.com, or a valid company email domain.";
export const phoneValidationMessage = "Enter a valid phone number for the selected country code.";

export function isValidBusinessContactEmail(value: string) {
  const email = value.trim().toLowerCase();
  const basicEmailPattern = /^[^\s@]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

  if (!basicEmailPattern.test(email)) return false;

  const domain = email.split("@")[1] ?? "";
  const parts = domain.split(".");
  const domainName = parts[0];
  const tld = parts.at(-1) ?? "";

  if (!domainName) return false;
  if (blockedEmailTlds.has(tld)) return false;
  if (reservedPersonalEmailNames.has(domainName)) return allowedPersonalEmailDomains.has(domain);

  return /^[a-z]{2,24}$/.test(tld);
}

export function getPhoneValidationError(countryCode: string, mobileNumber: string) {
  const normalizedCountryCode = countryCode.trim();
  const normalizedMobileNumber = mobileNumber.trim();

  if (!normalizedCountryCode) return "Country code is required.";
  if (!/^\d{6,15}$/.test(normalizedMobileNumber)) return "Mobile number must contain 6 to 15 digits.";

  const phoneNumber = parsePhoneNumberFromString(`${normalizedCountryCode}${normalizedMobileNumber}`);

  return phoneNumber?.isValid() ? "" : phoneValidationMessage;
}

// Accept only web URLs. The URL constructor alone would allow schemes such as
// javascript: or data:, which must never be stored as a website.
export function isHttpOrHttpsUrl(value: string) {
  if (!value) return true;

  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
