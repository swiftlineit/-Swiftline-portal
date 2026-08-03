import { parsePhoneNumberFromString } from "libphonenumber-js";
import { getUsTaxIdError, isUsTaxIdType, type UsTaxIdType } from "./usTaxId.js";

// Single source of truth for business-account field validation on the backend.
//
// KEEP IN SYNC with the frontend rules, which intentionally mirror these for
// inline form validation (separate package, so they cannot share a module):
//   - portal/frontend/src/lib/businessAccountPostalCodes.ts
//   - portal/frontend/src/lib/businessAccountRegistrationRules.ts
//   - portal/frontend/src/lib/businessAccountContactRules.ts

// Maximum requested credit limit accepted on a business account.
export const BUSINESS_ACCOUNT_CREDIT_LIMIT_MAX = 100000;

const allowedPersonalEmailDomains = new Set(["gmail.com", "yahoo.com", "outlook.com"]);
const reservedPersonalEmailNames = new Set(["gmail", "yahoo", "outlook", "hotmail"]);
const blockedEmailTlds = new Set(["con", "comm", "cpm", "coom", "om"]);

export const emailValidationMessage = "Use gmail.com, yahoo.com, outlook.com, or a valid company email domain.";
export const phoneValidationMessage = "Enter a valid phone number for the selected country code.";

// The US is not listed here: a US account must supply a taxpayer ID (EIN, SSN
// or ITIN), which is carried by the same registrationId/registrationIdType pair
// every other country uses.
export const countriesWithoutRegistrationId = new Set(["Kuwait"]);
export const countriesWithSecondaryRegistrationId = new Set(["France", "Netherlands"]);

const fiveDigitPostalCodeCountries = new Set([
  "Saudi Arabia",
  "Germany",
  "France",
  "Italy",
  "Spain",
  "South Korea",
  "Indonesia",
  "Malaysia",
  "Thailand",
  "Vietnam",
  "Nepal",
  "Sri Lanka",
  "Mexico",
  "Kuwait"
]);
const fourDigitPostalCodeCountries = new Set([
  "Australia",
  "Belgium",
  "Switzerland",
  "Bangladesh",
  "South Africa",
  "New Zealand"
]);
const sixDigitPostalCodeCountries = new Set(["India", "Singapore", "China"]);

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

  // Custom company domains are allowed, while common typo TLDs such as ".con" are rejected.
  return /^[a-z]{2,24}$/.test(tld);
}

export function isValidPhoneForCountryCode(countryCode: string, mobileNumber: string) {
  const phoneNumber = parsePhoneNumberFromString(`${countryCode.trim()}${mobileNumber.trim()}`);

  return Boolean(phoneNumber?.isValid());
}

export function compactRegistrationId(value: string) {
  return value.replace(/\s+/g, "").toUpperCase();
}

export function getPrimaryRegistrationError(country: string, registrationId: string, registrationIdType?: string) {
  const value = compactRegistrationId(registrationId);

  if (!value) return "";

  if (country === "United States") {
    const taxIdType = isUsTaxIdType(registrationIdType ?? "") ? registrationIdType as UsTaxIdType : "ein";

    return getUsTaxIdError(registrationId, taxIdType);
  }

  if (country === "United Kingdom" && !/^(\d{8}|[A-Z]{2}\d{6})$/.test(value)) {
    return "Enter a valid CRID: 8 digits or 2 letters followed by 6 digits.";
  }

  if (country === "India" && !/^[A-Z]{5}\d{4}[A-Z]$/.test(value)) {
    return "Enter a valid PAN, for example ABCDE1234F.";
  }

  if (country === "France" && !/^FR\d{11}$/.test(value)) {
    return "Enter a valid French VAT number, for example FR12123456789.";
  }

  if (country === "Netherlands" && !/^(NL)?\d{9}B\d{2}$/.test(value)) {
    return "Enter a valid Dutch VAT number, for example NL123456789B01.";
  }

  if (country === "Canada") {
    const requiredLength = registrationIdType === "business_number" ? 9 : 10;
    if (!new RegExp(`^\\d{${requiredLength}}$`).test(value)) {
      return registrationIdType === "business_number"
        ? "Enter a valid CRA Business Number: exactly 9 digits."
        : "Enter a valid Canadian registration number: exactly 10 digits.";
    }
  }

  if (country === "Switzerland" && !/^CHE-\d{3}\.\d{3}\.\d{3}$/.test(value)) {
    return "Enter a valid Swiss UID, for example CHE-123.456.789.";
  }

  if (country === "Poland" && !/^(PL)?\d{10}$/.test(value)) {
    return "Enter a valid Polish VAT/NIP, for example PL1234567890 or 1234567890.";
  }

  return "";
}

export function getSecondaryRegistrationError(country: string, registrationId: string) {
  const value = compactRegistrationId(registrationId);

  if (!value) return "";

  if (country === "France" && !/^\d{9}$/.test(value)) {
    return "Enter a valid SIREN: exactly 9 digits.";
  }

  if (country === "Netherlands" && !/^\d{8}$/.test(value)) {
    return "Enter a valid KVK number: exactly 8 digits.";
  }

  return "";
}

export function isValidPostalCodeForCountry(country: string, postalCode: string) {
  const value = postalCode.trim().toUpperCase();

  if (!value) return false;
  if (country === "United Arab Emirates" || country === "Qatar" || country === "Other") return true;
  if (sixDigitPostalCodeCountries.has(country)) return /^\d{6}$/.test(value);
  if (fiveDigitPostalCodeCountries.has(country)) return /^\d{5}$/.test(value);
  if (fourDigitPostalCodeCountries.has(country)) return /^\d{4}$/.test(value);

  if (country === "United States") return /^\d{5}(-\d{4})?$/.test(value);
  if (country === "United Kingdom") return /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/.test(value);
  if (country === "Canada") return /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/.test(value);
  if (country === "Japan") return /^\d{3}-\d{4}$/.test(value);
  if (country === "Netherlands") return /^\d{4}\s?[A-Z]{2}$/.test(value);
  if (country === "Brazil") return /^\d{5}-\d{3}$/.test(value);
  if (country === "Oman") return /^\d{3}$/.test(value);
  if (country === "Bahrain") return /^\d{3,4}$/.test(value);

  return true;
}

export function getPostalCodeValidationMessage(country: string) {
  return `Enter a valid postal code for ${country}.`;
}

// Accept only web URLs. z.string().url()/new URL() would otherwise allow schemes
// such as javascript: or data:, which must never be stored as a website.
export function isHttpOrHttpsUrl(value: string) {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
