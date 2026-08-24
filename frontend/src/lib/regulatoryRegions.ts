import { countries } from "@/lib/countries";

/**
 * The Country / Region options a customs & regulatory update can target.
 *
 * Countries are derived from the shared catalogue so the two can never disagree.
 * The bloc entries above them exist because customs rules are usually announced
 * for a trading bloc rather than a single country- filing one EU reform
 * separately against every member state would bury it.
 *
 * KEEP IN SYNC with the backend copy (separate package, cannot share a module):
 *   portal/backend/src/services/reference/regulatoryRegions.ts
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
  ...countries.map((country) => ({ code: country.iso2.toUpperCase(), label: country.name }))
];

export function regulatoryRegionLabel(code: string): string {
  return regulatoryRegions.find((region) => region.code === code)?.label ?? code;
}
