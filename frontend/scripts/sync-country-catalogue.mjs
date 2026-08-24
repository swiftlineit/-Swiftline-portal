// Generates the backend's country catalogue from the frontend's.
//
// The two packages cannot share a module, and the alternative- a hand-kept map
// on each side with a "KEEP IN SYNC" comment- is exactly how they drifted:
// the backend knew 34 countries while the reference dataset behind it held
// states for 229, so a Croatian address silently skipped subdivision checks and
// an address import could not recognise the word "Croatia".
//
// Source of truth is `react-international-phone`, which the frontend already
// depends on for country names, codes and the flag list. Output is committed;
// re-run `npm run sync:countries` after upgrading that package.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultCountries, parseCountry } from "react-international-phone";

const here = path.dirname(fileURLToPath(import.meta.url));
const destination = path.resolve(
  here,
  "..",
  "..",
  "backend",
  "src",
  "services",
  "reference",
  "countryCatalogue.generated.ts"
);

// Kept in step with `nameOverrides` in src/lib/countries.ts: the source calls
// both CD and CG "Congo", and this file is a name-keyed object, so without the
// override one of the two would silently overwrite the other.
const nameOverrides = {
  cd: "Democratic Republic of the Congo",
  cg: "Republic of the Congo"
};

const countries = defaultCountries
  .map(parseCountry)
  .map(({ name, iso2 }) => ({ name: nameOverrides[iso2] ?? name, iso2: iso2.toUpperCase() }))
  .sort((a, b) => a.name.localeCompare(b.name));

const duplicateNames = countries
  .map((country) => country.name)
  .filter((name, index, all) => all.indexOf(name) !== index);

if (duplicateNames.length) {
  throw new Error(
    `Two countries share a name (${[...new Set(duplicateNames)].join(", ")}). `
    + "Add an entry to nameOverrides here and in src/lib/countries.ts before regenerating."
  );
}

if (countries.length < 200) {
  throw new Error(`Expected at least 200 countries, got ${countries.length}. Refusing to write a truncated catalogue.`);
}

// Quoted unconditionally: many country names are not valid bare identifiers
// ("Cote d'Ivoire", "Timor-Leste"), and a mix of quoted and bare keys reads as
// though the difference means something.
const entries = countries
  .map((country) => `  ${JSON.stringify(country.name)}: ${JSON.stringify(country.iso2)}`)
  .join(",\n");

const contents = `// GENERATED FILE - DO NOT EDIT.
//
// Written by \`npm run sync:countries\` in portal/frontend from the
// \`react-international-phone\` catalogue, which is the same source the portal's
// country pickers, flags and geography lookups read. Editing this by hand is
// how the frontend and backend lists drift apart.
//
// ${countries.length} countries, sorted by name.

export const countryCatalogue: Record<string, string> = {
${entries}
};
`;

await writeFile(destination, contents, "utf8");
console.log(`Wrote ${countries.length} countries to ${path.relative(process.cwd(), destination)}`);
