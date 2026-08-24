// The countries the portal knows, mapped to the ISO-3166 alpha-2 codes the
// geography dataset is keyed by.
//
// The table itself is generated from the frontend catalogue by
// `npm run sync:countries` (see countryCatalogue.generated.ts). It used to be a
// hand-kept list of 34 names carrying a "KEEP IN SYNC" comment, which is
// precisely how it fell behind: the reference dataset under `data/reference`
// holds states for 229 countries, so a Croatian address was skipping its
// subdivision check for no reason other than a name this map did not contain.
//
// Deliberately not the EDI list in `countryNames.ts`: that one holds customs
// spellings ("UNITED STATES OF AMERICA") for a different consumer.

import { countryCatalogue } from "./countryCatalogue.generated.js";

/**
 * ISO-2 code for a country name, or "" for one the catalogue does not map
 * (including the "Other" option). Callers treat "" as "no reference data", not
 * as an error, so an unmapped country simply skips subdivision checks.
 */
export function getCountryCodeByName(countryName: string): string {
  return countryCatalogue[countryName.trim()] ?? "";
}

export function getPortalCountryNames(): string[] {
  return Object.keys(countryCatalogue);
}
