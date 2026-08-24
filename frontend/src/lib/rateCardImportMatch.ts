import { countries, countryAliases, countryByCode, type Country } from "@/lib/countries";

/**
 * Matching the country names written in a supplier rate-list workbook.
 *
 * Separate from the portal country search because the problems are different.
 * A person typing into a field can be offered suggestions and will correct
 * themselves; a spreadsheet cell is fixed, frequently misspelled, and
 * sometimes names two countries at once. This resolver therefore reads a whole
 * zone column at a time and is allowed to answer "I do not know", which the
 * import review screen turns into a question for the operator.
 */
/** How a workbook's country name was matched. Rendered on the review screen. */
export type ImportMatchConfidence = "exact" | "alias" | "prefix" | "fuzzy";

export type ImportedCountryPart = {
  /** The text this part came from- the whole cell, or one side of a split. */
  raw: string;
  country: Country | null;
  confidence: ImportMatchConfidence | null;
  /** Near misses, offered as hints when nothing was confident enough. */
  candidates: Country[];
};

export type ImportedCountryMatch = {
  /** The cell text exactly as the workbook holds it. */
  raw: string;
  /** One entry, or several when the cell named more than one country. */
  parts: ImportedCountryPart[];
};

/** NFD-folded, lowercase, alphanumerics only, so accents and punctuation fold flat. */
function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const normalizedNames = new Map(countries.map((country) => [normalize(country.name), country]));

const normalizedAliases = new Map<string, Country>();
for (const [iso2, aliases] of Object.entries(countryAliases)) {
  const country = countryByCode(iso2);
  if (!country) continue;
  for (const alias of aliases) normalizedAliases.set(normalize(alias), country);
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }

  return previous[b.length];
}

/** An exact, alias or unambiguous-prefix hit. Never a guess. */
function resolveStrict(text: string): { country: Country; confidence: ImportMatchConfidence } | null {
  const needle = normalize(text);
  if (!needle) return null;

  const exact = normalizedNames.get(needle);
  if (exact) return { country: exact, confidence: "exact" };

  const alias = normalizedAliases.get(needle);
  if (alias) return { country: alias, confidence: "alias" };

  // A prefix counts only when exactly one country answers to it: "BOSNIA" is
  // Bosnia and Herzegovina, but "GUINEA" is three different countries.
  const prefixed = countries.filter((country) => normalize(country.name).startsWith(needle));
  if (prefixed.length === 1) return { country: prefixed[0], confidence: "prefix" };

  return null;
}

/**
 * The closest catalogue name, accepted only when it is clearly the closest.
 *
 * A misspelling is worth correcting; a coin toss between two countries is not.
 * The runner-up must be at least two edits further away, or nothing is
 * returned and the operator is asked.
 */
function resolveFuzzy(text: string, taken: ReadonlySet<string>) {
  const needle = normalize(text);
  if (needle.length < 4) return { country: null, candidates: [] as Country[] };

  const scored = countries
    .filter((country) => !taken.has(country.iso2))
    .map((country) => ({ country, distance: levenshtein(needle, normalize(country.name)) }))
    .sort((a, b) => a.distance - b.distance || a.country.name.localeCompare(b.country.name));

  const [best, runnerUp] = scored;
  const confident = Boolean(
    best
    && best.distance <= 2
    && (!runnerUp || runnerUp.distance - best.distance >= 2)
  );

  return {
    country: confident ? best.country : null,
    candidates: scored.filter((entry) => entry.distance <= 4).slice(0, 3).map((entry) => entry.country)
  };
}

/**
 * Splits a cell that names more than one country.
 *
 * Only reached when the whole cell did not resolve, so "Bosnia and
 * Herzegovina" and "Trinidad and Tobago" are matched intact and never torn in
 * half, while "SERBIA & MONTENEGRO" becomes two destinations.
 */
function splitCell(raw: string) {
  return raw
    .split(/\s*(?:&|\/|,|\band\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Resolves every country name in one zone column of a rate list.
 *
 * Resolved as a group, in two passes, because the zone is the context that
 * makes a typo readable. `SLOVANIA` sits one edit from both Slovakia and
 * Slovenia- but `SLOVAKIA` is spelled correctly two rows above it in the same
 * column, so once the confident matches have claimed their codes, only
 * Slovenia is left and the fuzzy pass is no longer a coin toss.
 */
export function resolveImportedCountryNames(rawNames: string[]): ImportedCountryMatch[] {
  const matches: ImportedCountryMatch[] = rawNames.map((raw) => {
    const whole = resolveStrict(raw);
    if (whole) {
      return { raw, parts: [{ raw, country: whole.country, confidence: whole.confidence, candidates: [] }] };
    }

    const pieces = splitCell(raw);
    const parts = (pieces.length > 1 ? pieces : [raw]).map<ImportedCountryPart>((piece) => {
      const strict = resolveStrict(piece);
      return {
        raw: piece,
        country: strict?.country ?? null,
        confidence: strict?.confidence ?? null,
        candidates: []
      };
    });

    return { raw, parts };
  });

  // Confident matches claim their codes first, across the whole zone, so the
  // fuzzy pass below can never hand a typo the code a correctly spelled
  // neighbour already owns.
  const taken = new Set<string>();
  for (const match of matches) {
    for (const part of match.parts) {
      if (part.country) taken.add(part.country.iso2);
    }
  }

  for (const match of matches) {
    for (const part of match.parts) {
      if (part.country) continue;
      const { country, candidates } = resolveFuzzy(part.raw, taken);
      part.candidates = candidates;
      if (country) {
        part.country = country;
        part.confidence = "fuzzy";
        taken.add(country.iso2);
      }
    }
  }

  return matches;
}
