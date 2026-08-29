/**
 * All European destination country codes (ISO2, uppercase).
 * Used to expand the `EUROPE` pause token.
 * Covers EU + Schengen + wider Europe the network serves.
 */
export const EUROPE_COUNTRY_CODES = [
  "AL", "AD", "AT", "BY", "BE", "BA", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IS", "IE", "IT", "XK", "LV", "LI", "LT", "LU", "MT", "MD", "MC", "ME", "NL", "MK", "NO", "PL", "PT", "RO", "RU", "SM", "RS", "SK", "SI", "ES", "SE", "CH", "TR", "UA", "GB", "VA"
] as const;

export const EUROPE_COUNTRY_SET = new Set<string>(EUROPE_COUNTRY_CODES);

/** Human labels matching the pause tokens. */
export const BOOKING_PAUSE_COUNTRY_LABELS: Record<string, string> = {
  GB: "United Kingdom",
  US: "United States",
  CA: "Canada",
  EUROPE: "Europe",
  ALL: "All destinations"
};

export function normalizeCountryCode(code: string | null | undefined): string {
  const upper = (code ?? "").trim().toUpperCase();
  // Normalize aliases: UK is stored as GB
  if (upper === "UK") return "GB";
  return upper;
}

export function getCountryLabels(tokens: string[]): string[] {
  return tokens.map((t) => BOOKING_PAUSE_COUNTRY_LABELS[t] ?? t);
}
