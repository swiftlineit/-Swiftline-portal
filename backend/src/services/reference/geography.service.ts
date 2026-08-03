/**
 * Serves the country / state / city reference data the portal's address forms
 * use for their dropdowns.
 *
 * The artifacts under `data/reference` are generated from the 45 MB source by
 * `npm run build:reference-data`. Everything here loads lazily and is then held
 * in memory: `states.json` is small enough to keep whole, while cities are read
 * one country at a time so a portal that only ever sees Indian addresses never
 * pays for the other 222 files.
 */
import fs from "node:fs";
import path from "node:path";

export type ReferenceState = { name: string; code: string };

const referenceRoot = path.resolve(process.cwd(), "data", "reference");
const statesPath = path.join(referenceRoot, "states.json");
const citiesRoot = path.join(referenceRoot, "cities");

const missingDataMessage = "Geography reference data is missing. Run `npm run build:reference-data`.";

let statesByCountry: Record<string, ReferenceState[]> | null = null;
const citiesByCountry = new Map<string, Record<string, string[]>>();

export class GeographyDataError extends Error {
  constructor(message: string, public readonly statusCode = 503) {
    super(message);
  }
}

function normalizeCountryCode(value: string) {
  return value.trim().toUpperCase();
}

/**
 * Compares names loosely so a value stored before this dataset existed still
 * matches its dropdown entry — case, accents, punctuation and spacing vary
 * between what a person typed and what the dataset records.
 */
export function normalizePlaceName(value: string) {
  // Strips the combining diacritical marks block (U+0300-U+036F) left behind
  // by NFD, so "Wurttemberg" and "Württemberg" compare equal.
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function loadStates() {
  if (statesByCountry) return statesByCountry;

  if (!fs.existsSync(statesPath)) throw new GeographyDataError(missingDataMessage);

  statesByCountry = JSON.parse(fs.readFileSync(statesPath, "utf8")) as Record<string, ReferenceState[]>;
  return statesByCountry;
}

export function getStates(countryCode: string): ReferenceState[] {
  return loadStates()[normalizeCountryCode(countryCode)] ?? [];
}

export function getCities(countryCode: string, stateCode: string): string[] {
  const country = normalizeCountryCode(countryCode);

  if (!citiesByCountry.has(country)) {
    const filePath = path.join(citiesRoot, `${country}.json`);
    // A country with no city data is a normal outcome, not an error: 27 of them
    // have none. Cache the empty result so the miss is not retried per request.
    citiesByCountry.set(
      country,
      fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, string[]> : {}
    );
  }

  const cities = citiesByCountry.get(country) ?? {};
  const exact = cities[stateCode.trim().toUpperCase()];

  if (exact) return exact;

  // States without a subdivision code are keyed by name; match those loosely so
  // a caller can pass either form.
  const target = normalizePlaceName(stateCode);
  const match = Object.entries(cities).find(([key]) => normalizePlaceName(key) === target);

  return match?.[1] ?? [];
}

// True when the country has no subdivisions at all, so the form must fall back
// to free text rather than presenting an empty dropdown.
export function hasStates(countryCode: string) {
  return getStates(countryCode).length > 0;
}

/**
 * Whether a state name belongs to a country. Countries with no subdivision data
 * accept anything, and the comparison is loose so a legacy stored spelling is
 * not rejected on an unrelated edit.
 */
export function isValidStateForCountry(countryCode: string, stateName: string) {
  const states = getStates(countryCode);

  if (!states.length) return true;

  const target = normalizePlaceName(stateName);

  if (!target) return false;

  return states.some((state) => normalizePlaceName(state.name) === target || normalizePlaceName(state.code) === target);
}
