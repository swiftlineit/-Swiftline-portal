/**
 * Suggests Harmonized System codes for a plain-language goods description, so
 * the person filling a customs invoice does not have to know the tariff.
 *
 * `data/reference/hs-codes.json` is generated from the published HS CSV by
 * `npm run build:hs-codes`. It is ~800 KB — far too much to ship to a browser
 * on every shipment form — so it is loaded once into this process and only the
 * handful of matches for a query ever crosses the wire.
 */
import fs from "node:fs";
import path from "node:path";

export type HsCodeSuggestion = { code: string; description: string };

/** Indexed form of one entry: the description pre-tokenized for matching. */
type IndexedHsCode = HsCodeSuggestion & { haystack: string };

const dataPath = path.resolve(process.cwd(), "data", "reference", "hs-codes.json");
const missingDataMessage = "HS code reference data is missing. Run `npm run build:hs-codes`.";

/**
 * Words that appear in thousands of tariff descriptions and so tell us nothing
 * about which code is meant. Dropping them keeps "parts of machines" from
 * matching every entry containing "of".
 */
const stopWords = new Set([
  "and", "or", "of", "the", "for", "with", "other", "than", "not", "nes",
  "in", "to", "a", "an", "by", "on", "from", "whether", "used", "new"
]);

/**
 * The tariff is written in legal vocabulary but people describe what is in the
 * box: nobody declares "footwear" or "automatic data processing machines". Each
 * everyday word is searched as itself *and* as the tariff's wording, so either
 * spelling finds the code.
 */
const synonyms: Record<string, string[]> = {
  laptop: ["automatic data processing"],
  laptops: ["automatic data processing"],
  computer: ["automatic data processing"],
  notebook: ["automatic data processing"],
  phone: ["telephone"],
  phones: ["telephone"],
  mobile: ["telephone"],
  cellphone: ["telephone"],
  smartphone: ["smartphones"],
  shoe: ["footwear"],
  shoes: ["footwear"],
  sandals: ["footwear"],
  slippers: ["footwear"],
  sneakers: ["footwear"],
  jewelry: ["jewellery"],
  ornaments: ["jewellery"],
  clothes: ["apparel"],
  clothing: ["apparel"],
  garment: ["apparel"],
  garments: ["apparel"],
  dress: ["apparel"],
  makeup: ["make up"],
  cosmetics: ["cosmetic"],
  medicine: ["medicaments"],
  medicines: ["medicaments"],
  tablets: ["medicaments"],
  wooden: ["wood"],
  spectacles: ["spectacles"],
  glasses: ["spectacles"],
  purse: ["bags"],
  wallet: ["bags"],
  luggage: ["trunks"],
  earphones: ["headphones"]
};

/**
 * The shortest word a query term can be, and so the width of the inverted
 * index's keys — every candidate lookup is by exactly this many characters.
 */
const keyLength = 3;

let index: IndexedHsCode[] | null = null;
/** First `keyLength` characters of a word in a description -> entries holding it. */
let entriesByWordStart: Map<string, number[]> | null = null;

export class HsCodeDataError extends Error {
  constructor(message: string, public readonly statusCode = 503) {
    super(message);
  }
}

/** Lowercases and reduces to single-spaced words, so matching ignores punctuation. */
function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function loadIndex() {
  if (index) return index;

  if (!fs.existsSync(dataPath)) throw new HsCodeDataError(missingDataMessage);

  const entries = JSON.parse(fs.readFileSync(dataPath, "utf8")) as Array<[string, string]>;
  // Padded with spaces so a whole-word test is a plain substring check.
  index = entries.map(([code, description]) => ({
    code,
    description,
    haystack: ` ${normalize(description)} `
  }));

  // Scoring all 6800 descriptions per keystroke is wasteful when a term rules
  // almost all of them out, so record which entries open a word with each key.
  entriesByWordStart = new Map();
  index.forEach((entry, entryIndex) => {
    for (const word of new Set(entry.haystack.trim().split(" "))) {
      if (word.length < keyLength) continue;

      const key = word.slice(0, keyLength);
      const bucket = entriesByWordStart!.get(key);
      if (bucket) {
        // Words are deduplicated per entry, but two different words can share a
        // key ("shirt" and "shirts"), so guard against listing an entry twice.
        if (bucket[bucket.length - 1] !== entryIndex) bucket.push(entryIndex);
      } else {
        entriesByWordStart!.set(key, [entryIndex]);
      }
    }
  });

  return index;
}

/** Entries worth scoring: those opening a word with any of the query's terms. */
function findCandidates(forms: string[]) {
  loadIndex();
  const candidates = new Set<number>();

  for (const form of forms) {
    // A phrase synonym ("automatic data processing") is looked up by its first
    // word; the full phrase is then confirmed while scoring.
    const bucket = entriesByWordStart!.get(form.slice(0, keyLength));
    if (bucket) for (const entryIndex of bucket) candidates.add(entryIndex);
  }

  return candidates;
}

/**
 * How well one word of the query matches an entry. A whole word (or its plural)
 * beats a word the query merely started, so "shirt" prefers "T-shirts" over
 * "shirting fabric".
 */
function scoreTerm(haystack: string, term: string) {
  if (haystack.includes(` ${term} `) || haystack.includes(` ${term}s `)) return 4;
  if (haystack.includes(` ${term}`)) return 3;
  return 0;
}

/**
 * Scores one entry against the query's terms, each of which may also be matched
 * through a synonym. Entries matching every term are ranked far above partial
 * matches, but partial matches are still returned — "handmade wooden box" should
 * suggest wooden boxes rather than nothing at all.
 */
function scoreEntry(entry: IndexedHsCode, termForms: string[][]) {
  let score = 0;
  let matched = 0;

  for (const forms of termForms) {
    const best = forms.reduce(
      (highest, form) => Math.max(highest, scoreTerm(entry.haystack, form)),
      0
    );

    if (best > 0) matched += 1;
    score += best;
  }

  if (!matched) return 0;
  return matched === termForms.length ? score + 10 : score;
}

/**
 * Returns the best matching codes for a description, or for a partial code when
 * the query is numeric. An empty or too-short query returns nothing rather than
 * an arbitrary slice of the tariff.
 */
export function searchHsCodes(query: string, limit = 8): HsCodeSuggestion[] {
  const digits = query.replace(/\D/g, "");

  // A numeric query is someone typing the code itself, not describing goods.
  if (digits && digits.length === query.trim().length) {
    if (digits.length < 2) return [];
    return loadIndex()
      .filter((entry) => entry.code.startsWith(digits))
      .slice(0, limit)
      .map(({ code, description }) => ({ code, description }));
  }

  const terms = normalize(query)
    .split(" ")
    .filter((term) => term.length > 2 && !stopWords.has(term));

  if (!terms.length) return [];

  // Each term is matched as itself or as any of its tariff synonyms.
  const termForms = terms.map((term) => [term, ...(synonyms[term] ?? [])]);
  const entries = loadIndex();
  const matches: Array<{ entry: IndexedHsCode; score: number }> = [];

  for (const entryIndex of findCandidates(termForms.flat())) {
    const entry = entries[entryIndex];
    if (!entry) continue;

    const score = scoreEntry(entry, termForms);
    if (score > 0) matches.push({ entry, score });
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    // Same relevance: the shorter description is the more direct match, and the
    // more specific (6 digit) code is what a customs declaration wants.
    if (left.entry.description.length !== right.entry.description.length) {
      return left.entry.description.length - right.entry.description.length;
    }
    return right.entry.code.length - left.entry.code.length;
  });

  return matches.slice(0, limit).map(({ entry }) => ({
    code: entry.code,
    description: entry.description
  }));
}
