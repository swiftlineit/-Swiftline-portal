import { countries, countryAliases, type Country, type CountryAliases } from "@/lib/countries";

/**
 * Matches what a person types to a country.
 *
 * Country fields take an ISO-3166 alpha-2 code, which almost nobody types.
 * People type the name, or the abbreviation they use in conversation- and the
 * everyday abbreviation is frequently not the code: the United Kingdom is "UK"
 * to a customer and "GB" to the standard, the United States is "USA", and the
 * United Arab Emirates is "UAE". Matching on the code alone therefore fails on
 * exactly the destinations that get typed most.
 *
 * The ranking is generic over the catalogue and the alias table so a narrower
 * list can reuse it without inheriting this one's vocabulary.
 */

/** How well a country matched, lowest first. Decides suggestion order. */
const enum Rank {
  ExactCode = 0,
  ExactName = 1,
  ExactAlias = 2,
  NamePrefix = 3,
  AliasPrefix = 4,
  NameContains = 5
}

function rank(country: Country, query: string, aliases: CountryAliases): Rank | null {
  const name = country.name.toLowerCase();
  const list = aliases[country.iso2] ?? [];

  if (country.iso2 === query) return Rank.ExactCode;
  if (name === query) return Rank.ExactName;
  if (list.includes(query)) return Rank.ExactAlias;
  if (name.startsWith(query)) return Rank.NamePrefix;
  if (list.some((alias) => alias.startsWith(query))) return Rank.AliasPrefix;
  if (name.includes(query)) return Rank.NameContains;

  return null;
}

/**
 * Countries from `list` matching a typed query, best match first.
 *
 * An empty query returns the whole list, so opening a field shows the options
 * rather than nothing.
 */
export function rankCountries<T extends Country>(
  list: readonly T[],
  query: string,
  aliases: CountryAliases = countryAliases
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...list];

  return list
    .map((country) => ({ country, score: rank(country, needle, aliases) }))
    .filter((entry): entry is { country: T; score: Rank } => entry.score !== null)
    .sort((a, b) => a.score - b.score || a.country.name.localeCompare(b.country.name))
    .map((entry) => entry.country);
}

/**
 * The single country in `list` a typed value unambiguously means, or null.
 *
 * Only an exact hit counts- a code, a full name, or a known alias. A prefix is
 * deliberately not enough: "united" would otherwise silently resolve to
 * whichever of the three "United ..." countries happens to sort first.
 */
export function resolveIn<T extends Country>(
  list: readonly T[],
  value: string,
  aliases: CountryAliases = countryAliases
): T | null {
  const needle = value.trim().toLowerCase();
  if (!needle) return null;

  return list.find((country) => {
    const score = rank(country, needle, aliases);
    return score === Rank.ExactCode || score === Rank.ExactName || score === Rank.ExactAlias;
  }) ?? null;
}

/** Countries matching a typed query, best match first. */
export function findCountries(query: string): Country[] {
  return rankCountries(countries, query);
}

/** The single country a typed value unambiguously means, or null. */
export function resolveCountry(value: string): Country | null {
  return resolveIn(countries, value);
}

/**
 * The country code to submit for a typed value.
 *
 * Falls back to the raw text, uppercased, when nothing matched, so a code the
 * catalogue does not list is passed through for the database to answer rather
 * than rejected here.
 */
export function toCountryCode(value: string): string {
  return resolveCountry(value)?.iso2.toUpperCase() ?? value.trim().toUpperCase();
}
