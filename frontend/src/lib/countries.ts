import { defaultCountries, parseCountry } from "react-international-phone";

/**
 * Every country the portal knows, with the ISO-3166 alpha-2 code used for
 * flags, rate cards, routes and the geography reference API.
 *
 * Sourced from `react-international-phone` rather than a hand-kept list: it is
 * already a dependency, it already supplies country names and codes, and its
 * 218 entries cover every destination Swiftline has opened or is likely to.
 * Hand-kept lists are what left Belgium unselectable on the rate card while its
 * rates sat in a spreadsheet, and Croatia unselectable on the routes screen
 * while the reference API happily served its twenty states.
 *
 * This module holds data only. Matching what somebody typed to one of these
 * lives in `countryLookup`, which binds this list to the ranking rules.
 *
 * The backend copy is generated from this same source by `npm run
 * sync:countries` - see `backend/src/services/reference/countryCatalogue.generated.ts`.
 */
export type Country = { name: string; iso2: string };

/** Everyday names for a country, keyed by lowercase ISO-3166 alpha-2 code. */
export type CountryAliases = Record<string, string[]>;

/**
 * Names the source list leaves ambiguous.
 *
 * `react-international-phone` calls both CD and CG "Congo". Two countries
 * sharing a name breaks everything downstream that keys on it: the resolver
 * would answer whichever sorted first, the backend catalogue is a name-keyed
 * object so one entry would silently overwrite the other, and an operator
 * picking "Congo" from a list would have no way to say which one they meant.
 */
const nameOverrides: Record<string, string> = {
  cd: "Democratic Republic of the Congo",
  cg: "Republic of the Congo"
};

export const countries: Country[] = defaultCountries
  .map(parseCountry)
  .map(({ name, iso2 }) => ({ name: nameOverrides[iso2] ?? name, iso2 }))
  .sort((a, b) => a.name.localeCompare(b.name));

const byCode = new Map(countries.map((country) => [country.iso2, country]));

/**
 * Everyday names that are not the country's own name or its code.
 *
 * Deliberately short. Every entry is a term somebody would actually type into a
 * destination field, or that a supplier's rate list actually spells that way -
 * not an exhaustive list of endonyms, which would only add ways for two
 * countries to collide.
 */
export const countryAliases: CountryAliases = {
  gb: ["uk", "britain", "great britain", "england", "scotland", "wales", "northern ireland"],
  us: ["usa", "america", "united states of america"],
  ae: ["uae", "emirates", "dubai", "abu dhabi"],
  nl: ["holland"],
  kr: ["korea", "republic of korea"],
  sa: ["ksa"],
  cn: ["prc", "mainland china"],
  in: ["bharat"],
  za: ["rsa"],
  nz: ["aotearoa"],
  cz: ["czechia", "czech"],
  ba: ["bosnia", "bosnia herzegovina", "herzegovina"],
  gr: ["hellas"],
  ie: ["eire", "republic of ireland"],
  mk: ["macedonia"],
  tr: ["turkiye"],
  ru: ["russian federation"]
};

/**
 * The display name for a stored country code.
 *
 * Falls back to the code itself, so a record saved against a destination the
 * catalogue does not list still reads as something rather than as a blank.
 */
export function countryName(countryCode: string): string {
  const code = countryCode.trim().toLowerCase();
  return byCode.get(code)?.name ?? countryCode.trim().toUpperCase();
}

/** The catalogue entry for a code, or null. */
export function countryByCode(countryCode: string): Country | null {
  return byCode.get(countryCode.trim().toLowerCase()) ?? null;
}

/**
 * The catalogue in the `{ code, name }` shape, with the code uppercased.
 *
 * Older pickers store and compare uppercase ISO codes. Offering the shape they
 * already expect keeps them on the shared catalogue without rewriting how each
 * one holds its value.
 */
export const countryCodeOptions: Array<{ code: string; name: string }> = countries.map((country) => ({
  code: country.iso2.toUpperCase(),
  name: country.name
}));
