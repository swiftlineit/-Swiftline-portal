import { regionForCountry, type RateCardRegion } from "@/lib/rateCardRegions";
import type { ClientCountryRateCard, CountryRateService } from "@/lib/countryRateCards";

/**
 * Shapes an assigned rate card into what a customer browses.
 *
 * The API returns one row per country, service and weight slab, sorted by
 * country. A card covering thirty destinations is therefore nine hundred rows,
 * which is a spreadsheet, not an answer to "what does Belgium cost". These
 * helpers fold those rows into destinations and regions so the page can ask for
 * a level at a time.
 */

export type Destination = {
  countryCode: string;
  countryName: string;
  services: CountryRateService[];
  /** The cheapest rate on the destination, used as the "from" price. */
  lowestRate: number;
  slabCount: number;
};

export type Region = {
  region: RateCardRegion;
  destinations: Destination[];
  lowestRate: number;
};

export function buildDestinations(rates: ClientCountryRateCard[]): Destination[] {
  const byCountry = new Map<string, Destination>();

  for (const rate of rates) {
    const existing = byCountry.get(rate.countryCode);

    if (!existing) {
      byCountry.set(rate.countryCode, {
        countryCode: rate.countryCode,
        countryName: rate.countryName,
        services: [rate.service],
        lowestRate: rate.chargesPerKg,
        slabCount: 1
      });
      continue;
    }

    if (!existing.services.includes(rate.service)) existing.services.push(rate.service);
    existing.lowestRate = Math.min(existing.lowestRate, rate.chargesPerKg);
    existing.slabCount += 1;
  }

  return [...byCountry.values()].sort((a, b) => a.countryName.localeCompare(b.countryName));
}

/**
 * Destinations grouped into regions, in the order the regions are declared.
 *
 * Regions with nothing on the card are dropped rather than shown empty: a tile
 * a customer can click into and find nothing is worse than no tile at all.
 */
export function buildRegions(destinations: Destination[]): Region[] {
  const byRegion = new Map<string, Region>();

  for (const destination of destinations) {
    const region = regionForCountry(destination.countryCode);
    const existing = byRegion.get(region.code);

    if (!existing) {
      byRegion.set(region.code, {
        region,
        destinations: [destination],
        lowestRate: destination.lowestRate
      });
      continue;
    }

    existing.destinations.push(destination);
    existing.lowestRate = Math.min(existing.lowestRate, destination.lowestRate);
  }

  return [...byRegion.values()];
}

export function formatRate(value: number) {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
