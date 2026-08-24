/**
 * The groups a customer browses their rate card by.
 *
 * A rate card is stored per country; nothing on the server knows about regions.
 * This is a presentation grouping, so a customer opening a card covering thirty
 * destinations meets seven tiles rather than nine hundred table rows.
 *
 * Codes are deliberately longer than ISO-3166 alpha-2, matching the convention
 * in `lib/regulatoryRegions.ts`, so a region code can never be mistaken for a
 * country code- "UK" as a region and "UK" as a code would collide.
 *
 * The United Kingdom, the United States and Canada stand alone because they are
 * Swiftline's established lanes and customers look for them by name. Europe is
 * one region rather than "EU" and "non-EU": Switzerland, Norway, Liechtenstein,
 * Serbia and Bosnia are not EU members, and a customer shipping to Zurich does
 * not care which side of that line it falls on.
 */
export type RateCardRegion = {
  code: string;
  label: string;
  /** Uppercase ISO-3166 alpha-2 codes. Empty for the catch-all. */
  countryCodes: string[];
};

export const REST_OF_WORLD = "REST_OF_WORLD";

export const rateCardRegions: RateCardRegion[] = [
  {
    code: "UNITED_KINGDOM",
    label: "United Kingdom",
    countryCodes: ["GB"]
  },
  {
    code: "USA",
    label: "USA",
    countryCodes: ["US"]
  },
  {
    code: "CANADA",
    label: "Canada",
    countryCodes: ["CA"]
  },
  {
    code: "EUROPE",
    label: "Europe",
    countryCodes: [
      "AD", "AL", "AT", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE", "DK",
      "EE", "ES", "FI", "FO", "FR", "GI", "GR", "HR", "HU", "IE",
      "IS", "IT", "LI", "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MT",
      "NL", "NO", "PL", "PT", "RO", "RS", "SE", "SI", "SK", "SM", "UA", "VA",
      "XK"
    ]
  },
  {
    code: "MIDDLE_EAST",
    label: "Middle East",
    countryCodes: ["AE", "BH", "IL", "IQ", "JO", "KW", "LB", "OM", "PS", "QA", "SA", "SY", "TR", "YE"]
  },
  {
    code: "ASIA_PACIFIC",
    label: "Asia Pacific",
    countryCodes: [
      "AF", "AU", "BD", "BN", "BT", "CN", "FJ", "HK", "ID", "IN", "JP", "KH",
      "KR", "LA", "LK", "MM", "MN", "MO", "MV", "MY", "NP", "NZ", "PG", "PH",
      "PK", "SG", "TH", "TW", "VN"
    ]
  },
  {
    code: "AFRICA",
    label: "Africa",
    countryCodes: [
      "AO", "BJ", "BW", "CD", "CG", "CI", "CM", "DZ", "EG", "ET", "GH", "GM",
      "GN", "KE", "LY", "MA", "MG", "ML", "MU", "MW", "MZ", "NA", "NE", "NG",
      "RW", "SC", "SD", "SN", "SO", "SS", "TN", "TZ", "UG", "ZA", "ZM", "ZW"
    ]
  },
  {
    code: "AMERICAS",
    label: "Latin America & Caribbean",
    countryCodes: [
      "AR", "BB", "BO", "BR", "BS", "BZ", "CL", "CO", "CR", "CU", "DO", "EC",
      "GT", "GY", "HN", "HT", "JM", "MX", "NI", "PA", "PE", "PR", "PY", "SV",
      "TT", "UY", "VE"
    ]
  },
  {
    code: REST_OF_WORLD,
    label: "Other destinations",
    countryCodes: []
  }
];

const regionByCountry = new Map<string, RateCardRegion>();
for (const region of rateCardRegions) {
  for (const code of region.countryCodes) regionByCountry.set(code, region);
}

/**
 * The region a destination belongs to.
 *
 * Falls back to the catch-all rather than returning null, so a rate for a
 * country nobody thought to list still has a tile to appear under. A priced
 * destination the customer cannot find is worse than an imprecise grouping.
 */
export function regionForCountry(countryCode: string): RateCardRegion {
  const code = countryCode.trim().toUpperCase();
  return regionByCountry.get(code) ?? rateCardRegions[rateCardRegions.length - 1];
}

export function rateCardRegionLabel(code: string): string {
  return rateCardRegions.find((region) => region.code === code)?.label ?? code;
}
