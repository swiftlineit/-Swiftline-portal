import { portalCountries, type PortalCountry } from "@/lib/portalCountries";

/**
 * Matches what a person types to a country.
 *
 * Country fields take an ISO-3166 alpha-2 code, which almost nobody types.
 * People type the name, or the abbreviation they use in conversation- and the
 * everyday abbreviation is frequently not the code: the United Kingdom is "UK"
 * to a customer and "GB" to the standard, the United States is "USA", and the
 * United Arab Emirates is "UAE". Matching on the code alone therefore fails on
 * exactly the destinations that get typed most.
 */

/**
 * Everyday names that are not the country's own name or its code.
 *
 * Deliberately short. Every entry here is a term a customer would actually
 * type into a destination field, not an exhaustive list of endonyms- a long
 * speculative list would only add ways for two countries to collide.
 */
const aliases: Record<string, string[]> = {
  gb: ["uk", "britain", "great britain", "england", "scotland", "wales", "northern ireland"],
  us: ["usa", "america", "united states of america"],
  ae: ["uae", "emirates", "dubai", "abu dhabi"],
  nl: ["holland"],
  kr: ["korea", "republic of korea"],
  sa: ["ksa"],
  cn: ["prc", "mainland china"],
  in: ["bharat"],
  za: ["rsa"],
  nz: ["aotearoa"]
};

/** How well a country matched, lowest first. Decides suggestion order. */
const enum Rank {
  ExactCode = 0,
  ExactName = 1,
  ExactAlias = 2,
  NamePrefix = 3,
  AliasPrefix = 4,
  NameContains = 5
}

function aliasesFor(country: PortalCountry) {
  return aliases[country.iso2] ?? [];
}

function rank(country: PortalCountry, query: string): Rank | null {
  const name = country.name.toLowerCase();
  const list = aliasesFor(country);

  if (country.iso2 === query) return Rank.ExactCode;
  if (name === query) return Rank.ExactName;
  if (list.includes(query)) return Rank.ExactAlias;
  if (name.startsWith(query)) return Rank.NamePrefix;
  if (list.some((alias) => alias.startsWith(query))) return Rank.AliasPrefix;
  if (name.includes(query)) return Rank.NameContains;

  return null;
}

/**
 * Countries matching a typed query, best match first.
 *
 * An empty query returns the whole list, so opening the field shows the
 * options rather than nothing.
 */
export function findCountries(query: string): PortalCountry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return portalCountries;

  return portalCountries
    .map((country) => ({ country, score: rank(country, needle) }))
    .filter((entry): entry is { country: PortalCountry; score: Rank } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.country.name.localeCompare(b.country.name))
    .map((entry) => entry.country);
}

/**
 * The single country a typed value unambiguously means, or null.
 *
 * Only an exact hit counts- a code, a full name, or a known alias. A prefix
 * is deliberately not enough: "united" would otherwise silently resolve to
 * whichever of the three "United …" countries happens to sort first.
 */
export function resolveCountry(value: string): PortalCountry | null {
  const needle = value.trim().toLowerCase();
  if (!needle) return null;

  return portalCountries.find((country) => {
    const score = rank(country, needle);
    return score === Rank.ExactCode || score === Rank.ExactName || score === Rank.ExactAlias;
  }) ?? null;
}

/**
 * The country code to submit for a typed value.
 *
 * Falls back to the raw text, uppercased, when nothing matched. The portal
 * ships a short country list but the rate cards and route records behind these
 * fields do not, so a code we do not list is passed through for the database to
 * answer rather than rejected here.
 */
export function toCountryCode(value: string): string {
  return resolveCountry(value)?.iso2.toUpperCase() ?? value.trim().toUpperCase();
}
