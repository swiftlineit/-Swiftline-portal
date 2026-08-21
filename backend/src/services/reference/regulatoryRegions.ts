import { getCountryCodeByName, getPortalCountryNames } from "./portalCountries.js";

/**
 * The Country / Region options a customs & regulatory update can target.
 *
 * Countries are derived from the portal country list so the two can never
 * disagree. The bloc entries above them exist because customs rules are
 * usually announced for a trading bloc rather than a single country- filing
 * one EU reform separately against every member state would bury it.
 *
 * KEEP IN SYNC with the frontend copy (separate package, cannot share a
 * module): portal/frontend/src/lib/regulatoryRegions.ts
 */

export type RegulatoryRegion = { code: string; label: string };

/** Non-country targets. Codes are deliberately longer than ISO-2 so they can
    never collide with a country code the portal list adds later. */
export const regulatoryBlocRegions: RegulatoryRegion[] = [
  { code: "WORLDWIDE", label: "Worldwide" },
  { code: "EUROPEAN_UNION", label: "European Union" },
  { code: "GCC", label: "GCC (Gulf states)" }
];

export const regulatoryRegions: RegulatoryRegion[] = [
  ...regulatoryBlocRegions,
  ...getPortalCountryNames().map((name) => ({ code: getCountryCodeByName(name), label: name }))
];

export const regulatoryRegionCodes: string[] = regulatoryRegions.map((region) => region.code);

export function regulatoryRegionLabel(code: string): string {
  return regulatoryRegions.find((region) => region.code === code)?.label ?? code;
}
