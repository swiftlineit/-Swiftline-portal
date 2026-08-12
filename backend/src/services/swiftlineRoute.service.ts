import { OperationalCalendarEntry } from "../models/operationalCalendarEntry.model.js";
import { SwiftlineRoute, type ISwiftlineRoute, type RouteTransitBasis } from "../models/swiftlineRoute.model.js";
import type { CountryRateService } from "../models/countryRateCard.model.js";

/**
 * Turning a lane's transit time into a date a customer can hold us to.
 *
 * Everything here works in whole calendar days held as UTC midnights. Transit
 * time is quoted in days, not hours, so carrying a wall-clock time would only
 * invite daylight-saving and timezone bugs into arithmetic that does not need
 * it. Callers format the result in whatever zone they display.
 */

/** The default origin. Every shipment leaves India today — see the route model. */
export const defaultOriginCountryCode = "IN";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` in UTC. The key format used for the holiday lookup set. */
function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Strips the time, so day arithmetic is not skewed by when a booking happened. */
function toUtcMidnight(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isWeekend(date: Date) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export type RouteEstimate = {
  routeId: string;
  transitDaysMin: number;
  transitDaysMax: number;
  transitBasis: RouteTransitBasis;
  /** Earliest realistic arrival, from `transitDaysMin`. */
  earliestDeliveryAt: Date;
  /**
   * The date quoted to the customer, from `transitDaysMax`. Quoting the slower
   * end means a shipment normally arrives early; quoting the faster end would
   * make the common case look late.
   */
  estimatedDeliveryAt: Date;
};

/**
 * Non-working days at the destination over a window, as `YYYY-MM-DD` keys.
 *
 * Only destination and customs holidays count: a branch holiday in India delays
 * dispatch rather than transit, and the estimate is measured from the date the
 * shipment actually leaves. Entries may carry a range, so each is expanded.
 */
export async function loadDestinationHolidays(
  countryCode: string,
  from: Date,
  to: Date
): Promise<Set<string>> {
  const keys = new Set<string>();
  if (!countryCode) return keys;

  const entries = await OperationalCalendarEntry.find({
    category: { $in: ["DESTINATION_HOLIDAY", "CUSTOMS_HOLIDAY"] },
    countryCode: countryCode.toUpperCase(),
    active: true,
    date: { $ne: null, $lte: to },
    $or: [{ endDate: null }, { endDate: { $gte: from } }]
  })
    .select("date endDate")
    .lean()
    .exec();

  for (const entry of entries) {
    if (!entry.date) continue;
    const start = toUtcMidnight(new Date(entry.date));
    const end = entry.endDate ? toUtcMidnight(new Date(entry.endDate)) : start;
    // A malformed range (end before start) would loop forever, so it is treated
    // as the single start day it can still be read as.
    if (end < start) {
      keys.add(toDateKey(start));
      continue;
    }
    for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + MS_PER_DAY)) {
      keys.add(toDateKey(cursor));
    }
  }

  return keys;
}

/**
 * Adds transit days to a date.
 *
 * On `BUSINESS_DAYS` weekends and destination holidays are skipped and do not
 * consume a day; on `CALENDAR_DAYS` every day counts. The step limit is a guard
 * against a pathological holiday set — the schema already caps transit at 120
 * days, so a correct call can never reach it.
 */
export function addTransitDays(
  from: Date,
  days: number,
  basis: RouteTransitBasis,
  holidays: Set<string> = new Set()
): Date {
  let cursor = toUtcMidnight(from);
  if (days <= 0) return cursor;

  if (basis === "CALENDAR_DAYS") {
    return new Date(cursor.getTime() + days * MS_PER_DAY);
  }

  let remaining = days;
  let steps = 0;
  const maxSteps = days * 7 + 400;

  while (remaining > 0 && steps < maxSteps) {
    cursor = new Date(cursor.getTime() + MS_PER_DAY);
    steps += 1;
    if (isWeekend(cursor) || holidays.has(toDateKey(cursor))) continue;
    remaining -= 1;
  }

  return cursor;
}

/** The lane a shipment travels, or null when none has been configured yet. */
export async function findRoute(input: {
  destinationCountryCode: string;
  service: CountryRateService;
  originCountryCode?: string;
}): Promise<ISwiftlineRoute | null> {
  if (!input.destinationCountryCode) return null;

  return SwiftlineRoute.findOne({
    originCountryCode: (input.originCountryCode ?? defaultOriginCountryCode).toUpperCase(),
    destinationCountryCode: input.destinationCountryCode.toUpperCase(),
    service: input.service
  }).exec();
}

/**
 * The delivery estimate for one shipment.
 *
 * Returns null when the lane has no route configured or the route is closed —
 * callers must render "not available" rather than inventing a date, because a
 * wrong promised date is worse for a customer than an absent one.
 *
 * `holidays` may be supplied by a caller estimating many shipments at once, so
 * the calendar is read once instead of per shipment.
 */
export async function estimateRouteDelivery(input: {
  destinationCountryCode: string;
  service: CountryRateService;
  dispatchedAt: Date;
  originCountryCode?: string;
  route?: ISwiftlineRoute | null;
  holidays?: Set<string>;
}): Promise<RouteEstimate | null> {
  const route = input.route ?? (await findRoute(input));
  if (!route || !route.serviceable) return null;

  const from = toUtcMidnight(input.dispatchedAt);
  const holidays = input.holidays
    ?? (route.transitBasis === "BUSINESS_DAYS"
      ? await loadDestinationHolidays(
        route.destinationCountryCode,
        from,
        // A generous upper bound: the longest transit the schema allows, with
        // slack for the weekends and holidays that will be skipped inside it.
        new Date(from.getTime() + (route.transitDaysMax * 3 + 30) * MS_PER_DAY)
      )
      : new Set<string>());

  return {
    routeId: String(route._id),
    transitDaysMin: route.transitDaysMin,
    transitDaysMax: route.transitDaysMax,
    transitBasis: route.transitBasis,
    earliestDeliveryAt: addTransitDays(from, route.transitDaysMin, route.transitBasis, holidays),
    estimatedDeliveryAt: addTransitDays(from, route.transitDaysMax, route.transitBasis, holidays)
  };
}
