export const shipmentDestinationRegionOptions = [
  { code: "USA", label: "United States" },
  { code: "UNITED_KINGDOM", label: "United Kingdom" },
  { code: "CANADA", label: "Canada" },
  { code: "EUROPE", label: "Europe" }
] as const;

export type ShipmentDestinationRegionCode = (typeof shipmentDestinationRegionOptions)[number]["code"];

export function parseShipmentDestinationRegions(value: string | null) {
  if (!value) return [] as ShipmentDestinationRegionCode[];
  const requested = new Set(value.split(",").map((item) => item.trim().toUpperCase()));
  return shipmentDestinationRegionOptions
    .filter((region) => requested.has(region.code))
    .map((region) => region.code);
}
