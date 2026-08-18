/**
 * Regenerates the compact geography files the portal serves, from the 45 MB
 * countries+states+cities dataset.
 *
 * The source carries far more than the forms need- timezones, translations,
 * GDP, currency symbols- and is far too large to parse on every boot or to
 * ship to a browser. This reduces it to names and codes, split so a request
 * only ever loads one country's states or one state's cities.
 *
 * Output (committed, ~2.7 MB):
 *   data/reference/states.json      { "IN": [{ name, code }], ... }
 *   data/reference/cities/IN.json   { "MH": ["Mumbai", ...], ... }
 *
 * DELIBERATELY MANUAL. The output is committed and the 45 MB source is not, so
 * the app boots without it and a fresh clone needs nothing extra. Run this only
 * after replacing the dataset, then commit what changes:
 *
 *   npm run build:reference-data -- --force
 *
 * Place the dataset at portal/countries+states+cities.json first; it is
 * git-ignored, so keep your own copy.
 */
import fs from "node:fs";
import path from "node:path";

type SourceCity = { name?: unknown };
type SourceState = { name?: unknown; iso2?: unknown; cities?: unknown };
type SourceCountry = { name?: unknown; iso2?: unknown; states?: unknown };

const sourcePath = path.resolve(process.cwd(), "..", "countries+states+cities.json");
const outputRoot = path.resolve(process.cwd(), "data", "reference");
const citiesRoot = path.join(outputRoot, "cities");

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

// Parsing 45 MB takes a few seconds, so a rebuild only happens when the source
// is newer than what was generated. This keeps the dev and build pre-hooks
// effectively free after the first run. Pass --force to rebuild regardless.
function isUpToDate() {
  const statesPath = path.join(outputRoot, "states.json");

  if (process.argv.includes("--force") || !fs.existsSync(statesPath)) return false;

  return fs.statSync(statesPath).mtimeMs >= fs.statSync(sourcePath).mtimeMs;
}

function main() {
  if (!fs.existsSync(sourcePath)) {
    // Only this script needs the source. If you are seeing this, you are trying
    // to regenerate without it- the committed files under data/reference are
    // what the app actually reads, and they are already there.
    throw new Error(
      `Geography dataset not found at ${sourcePath}.\n`
      + "It is git-ignored on purpose. Download or copy it there to regenerate;\n"
      + "the app itself does not need it- data/reference is committed."
    );
  }

  if (isUpToDate()) {
    console.log("Reference data is up to date; skipping rebuild.");
    return;
  }

  const countries = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as SourceCountry[];

  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(citiesRoot, { recursive: true });

  const statesByCountry: Record<string, { name: string; code: string }[]> = {};
  let stateCount = 0;
  let cityCount = 0;
  let cityFileCount = 0;

  for (const country of countries) {
    const countryCode = text(country.iso2).toUpperCase();
    if (!countryCode) continue;

    const sourceStates = Array.isArray(country.states) ? country.states as SourceState[] : [];
    const states: { name: string; code: string }[] = [];
    const citiesByState: Record<string, string[]> = {};

    for (const state of sourceStates) {
      const name = text(state.name);
      if (!name) continue;

      // Some entries carry no subdivision code; the name is then the only
      // stable identifier, and is what the account record stores anyway.
      const code = text(state.iso2).toUpperCase() || name;
      states.push({ name, code });

      const sourceCities = Array.isArray(state.cities) ? state.cities as SourceCity[] : [];
      const cities = [...new Set(sourceCities.map((city) => text(city.name)).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));

      if (cities.length) {
        citiesByState[code] = cities;
        cityCount += cities.length;
      }
    }

    if (!states.length) continue;

    states.sort((left, right) => left.name.localeCompare(right.name));
    statesByCountry[countryCode] = states;
    stateCount += states.length;

    if (Object.keys(citiesByState).length) {
      fs.writeFileSync(path.join(citiesRoot, `${countryCode}.json`), JSON.stringify(citiesByState));
      cityFileCount += 1;
    }
  }

  fs.writeFileSync(path.join(outputRoot, "states.json"), JSON.stringify(statesByCountry));

  const statesKb = (fs.statSync(path.join(outputRoot, "states.json")).size / 1024).toFixed(0);
  console.log(`Wrote states.json: ${Object.keys(statesByCountry).length} countries, ${stateCount} states (${statesKb} KB)`);
  console.log(`Wrote cities/: ${cityFileCount} country files, ${cityCount} cities`);
}

main();
