// The countries the portal's address fields offer, mapped to the ISO-3166
// alpha-2 codes the geography dataset is keyed by.
//
// KEEP IN SYNC with `countryOptions` in
//   portal/frontend/src/components/business-accounts/FormFieldControls.tsx
// which carries the same list plus the flag each option shows.
//
// Deliberately not the EDI list in `countryNames.ts`: that one holds customs
// spellings ("UNITED STATES OF AMERICA") for a different consumer.

const portalCountryCodes: Record<string, string> = {
  India: "IN",
  "United States": "US",
  "United Kingdom": "GB",
  Canada: "CA",
  Australia: "AU",
  "United Arab Emirates": "AE",
  "Saudi Arabia": "SA",
  Singapore: "SG",
  China: "CN",
  Japan: "JP",
  Germany: "DE",
  France: "FR",
  Italy: "IT",
  Netherlands: "NL",
  Belgium: "BE",
  Spain: "ES",
  Switzerland: "CH",
  "South Korea": "KR",
  Indonesia: "ID",
  Malaysia: "MY",
  Thailand: "TH",
  Vietnam: "VN",
  Bangladesh: "BD",
  Nepal: "NP",
  "Sri Lanka": "LK",
  "South Africa": "ZA",
  Brazil: "BR",
  Mexico: "MX",
  "New Zealand": "NZ",
  Qatar: "QA",
  Oman: "OM",
  Kuwait: "KW",
  Bahrain: "BH",
  Poland: "PL"
};

/**
 * ISO-2 code for a portal country name, or "" for one the portal does not map
 * (including the "Other" option). Callers treat "" as "no reference data", not
 * as an error, so an unmapped country simply skips subdivision checks.
 */
export function getCountryCodeByName(countryName: string): string {
  return portalCountryCodes[countryName.trim()] ?? "";
}

export function getPortalCountryNames(): string[] {
  return Object.keys(portalCountryCodes);
}
