import { getCountryCodeByName, getPortalCountryNames } from "./reference/portalCountries.js";

/**
 * The destination groups available on the staff shipment table.
 *
 * The United Kingdom is intentionally separate from Europe because it is one
 * of Swiftline's primary lanes and operators need to isolate it quickly.
 */
export const shipmentDestinationRegionOptions = [
  { code: "USA", label: "United States", countryCodes: ["US"] },
  { code: "UNITED_KINGDOM", label: "United Kingdom", countryCodes: ["GB"] },
  { code: "CANADA", label: "Canada", countryCodes: ["CA"] },
  {
    code: "EUROPE",
    label: "Europe",
    countryCodes: [
      "AD", "AL", "AT", "BA", "BE", "BG", "BY", "CH", "CY", "CZ", "DE", "DK",
      "EE", "ES", "FI", "FO", "FR", "GI", "GR", "HR", "HU", "IE", "IS", "IT",
      "LI", "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MT", "NL", "NO", "PL",
      "PT", "RO", "RS", "SE", "SI", "SK", "SM", "UA", "VA", "XK"
    ]
  }
] as const;

export type ShipmentDestinationRegionCode = (typeof shipmentDestinationRegionOptions)[number]["code"];

const regionByCode = new Map(
  shipmentDestinationRegionOptions.map((region) => [region.code, region] as const)
);

// Country names are a compatibility fallback for older drafts that stored the
// name but not the ISO code. New records normally match by countryCode.
const countryNamesByCode = new Map<string, string[]>();
for (const name of getPortalCountryNames()) {
  const code = getCountryCodeByName(name).trim().toUpperCase();
  if (!code) continue;
  countryNamesByCode.set(code, [
    ...(countryNamesByCode.get(code) ?? []),
    name.trim().toUpperCase()
  ]);
}

const countryNameAliases: Record<string, string[]> = {
  US: ["USA", "UNITED STATES OF AMERICA"],
  GB: ["UK", "GREAT BRITAIN", "ENGLAND", "SCOTLAND", "WALES", "NORTHERN IRELAND"]
};

function countryNamesForCodes(countryCodes: readonly string[]) {
  return [...new Set(countryCodes.flatMap((code) => [
    ...(countryNamesByCode.get(code) ?? []),
    ...(countryNameAliases[code] ?? [])
  ]))];
}

export function normalizeShipmentDestinationRegions(values: string[]) {
  const requested = new Set(values.map((value) => value.trim().toUpperCase()));
  return shipmentDestinationRegionOptions
    .filter((region) => requested.has(region.code))
    .map((region) => region.code);
}

/**
 * Mongo condition for the destination shown by the shipment list.
 *
 * Address validation can replace the entered address, so filtering both fields
 * with a plain `$or` could include a shipment whose entered country matches but
 * whose validated destination does not. `$expr` applies the same fallback as
 * the serializer: validated address first, entered address second.
 */
export function shipmentDestinationRegionCondition(
  regions: readonly ShipmentDestinationRegionCode[]
): Record<string, unknown> | undefined {
  const selected = regions
    .map((code) => regionByCode.get(code))
    .filter((region): region is (typeof shipmentDestinationRegionOptions)[number] => Boolean(region));
  if (!selected.length) return undefined;

  const countryCodes = [...new Set(selected.flatMap((region) => region.countryCodes))];
  const countryNames = countryNamesForCodes(countryCodes);

  return {
    $expr: {
      $let: {
        vars: {
          destination: { $ifNull: ["$consigneeValidatedAddress", "$consigneeEnteredAddress"] }
        },
        in: {
          $or: [
            { $in: [{ $toUpper: { $ifNull: ["$$destination.countryCode", ""] } }, countryCodes] },
            { $in: [{ $toUpper: { $ifNull: ["$$destination.countryName", ""] } }, countryNames] }
          ]
        }
      }
    }
  };
}
