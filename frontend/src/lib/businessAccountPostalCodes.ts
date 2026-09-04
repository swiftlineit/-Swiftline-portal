// KEEP IN SYNC with the backend postal rules (separate package, cannot share a
// module): portal/backend/src/services/businessAccountRules.ts

export type PostalCodeRule = {
  format: string;
  validate: (value: string) => boolean;
};

const fiveDigitCountries = new Set([
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

const fourDigitCountries = new Set([
  "Australia",
  "Belgium",
  "Switzerland",
  "Bangladesh",
  "South Africa",
  "New Zealand"
]);

const sixDigitCountries = new Set(["India", "Singapore", "China"]);

export const postalCodeFormats: Record<string, string> = {
  India: "######",
  "United States": "##### or #####-####",
  "United Kingdom": "A9 9AA / A99 9AA / A9A 9AA / AA9 9AA / AA99 9AA / AA9A 9AA",
  Canada: "A1A 1A1",
  Australia: "####",
  "United Arab Emirates": "No standard postal code",
  "Saudi Arabia": "#####",
  Singapore: "######",
  China: "######",
  Japan: "###-####",
  Germany: "#####",
  France: "#####",
  Italy: "#####",
  Netherlands: "#### AA",
  Belgium: "####",
  Spain: "#####",
  Switzerland: "####",
  "South Korea": "#####",
  Indonesia: "#####",
  Malaysia: "#####",
  Thailand: "#####",
  Vietnam: "#####",
  Bangladesh: "####",
  Nepal: "#####",
  "Sri Lanka": "#####",
  "South Africa": "####",
  Brazil: "#####-###",
  Mexico: "#####",
  "New Zealand": "####",
  Qatar: "No standard postal code",
  Oman: "###",
  Kuwait: "#####",
  Bahrain: "### or ####",
  Other: "Country-specific"
};

export function getPostalCodeFormat(country: string) {
  return postalCodeFormats[country] ?? postalCodeFormats.Other;
}

const postalCodePlaceholders: Record<string, string> = {
  India: "110001"
};

export function getPostalCodePlaceholder(country: string) {
  return postalCodePlaceholders[country] ?? getPostalCodeFormat(country);
}

export function isValidPostalCodeForCountry(country: string, postalCode: string) {
  const value = postalCode.trim().toUpperCase();

  if (!value) return false;
  if (country === "United Arab Emirates" || country === "Qatar" || country === "Other") return true;
  if (sixDigitCountries.has(country)) return /^\d{6}$/.test(value);
  if (fiveDigitCountries.has(country)) return /^\d{5}$/.test(value);
  if (fourDigitCountries.has(country)) return /^\d{4}$/.test(value);

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
