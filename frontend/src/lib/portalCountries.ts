// The countries the portal's address and operating-country fields offer, with
// the ISO-3166 alpha-2 code used for flags and for the geography reference API.
//
// This is the canonical list: `countryOptions` in FormFieldControls is derived
// from it, so the dropdown and the state/city lookup can never disagree.
//
// KEEP IN SYNC with the backend copy (separate package, cannot share a module):
//   portal/backend/src/services/reference/portalCountries.ts

export type PortalCountry = { name: string; iso2: string };

export const portalCountries: PortalCountry[] = [
  { name: "India", iso2: "in" },
  { name: "United States", iso2: "us" },
  { name: "United Kingdom", iso2: "gb" },
  { name: "Canada", iso2: "ca" },
  { name: "Australia", iso2: "au" },
  { name: "United Arab Emirates", iso2: "ae" },
  { name: "Saudi Arabia", iso2: "sa" },
  { name: "Singapore", iso2: "sg" },
  { name: "China", iso2: "cn" },
  { name: "Japan", iso2: "jp" },
  { name: "Germany", iso2: "de" },
  { name: "France", iso2: "fr" },
  { name: "Italy", iso2: "it" },
  { name: "Netherlands", iso2: "nl" },
  { name: "Belgium", iso2: "be" },
  { name: "Spain", iso2: "es" },
  { name: "Switzerland", iso2: "ch" },
  { name: "Poland", iso2: "pl" },
  { name: "South Korea", iso2: "kr" },
  { name: "Indonesia", iso2: "id" },
  { name: "Malaysia", iso2: "my" },
  { name: "Thailand", iso2: "th" },
  { name: "Vietnam", iso2: "vn" },
  { name: "Bangladesh", iso2: "bd" },
  { name: "Nepal", iso2: "np" },
  { name: "Sri Lanka", iso2: "lk" },
  { name: "South Africa", iso2: "za" },
  { name: "Brazil", iso2: "br" },
  { name: "Mexico", iso2: "mx" },
  { name: "New Zealand", iso2: "nz" },
  { name: "Qatar", iso2: "qa" },
  { name: "Oman", iso2: "om" },
  { name: "Kuwait", iso2: "kw" },
  { name: "Bahrain", iso2: "bh" }
];

/** ISO-2 code for a portal country name, uppercased, or "" when unmapped. */
export function getPortalCountryCode(countryName: string) {
  const target = countryName.trim();

  return portalCountries.find((country) => country.name === target)?.iso2.toUpperCase() ?? "";
}
