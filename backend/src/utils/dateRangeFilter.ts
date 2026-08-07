/**
 * Turns the "dateFrom"/"dateTo" query params used by every list endpoint into an
 * inclusive Mongo range condition covering whole calendar days:
 * [dateFrom 00:00:00.000, dateTo 23:59:59.999]. Either bound may be omitted for
 * an open-ended range, and null is returned when neither is usable so callers
 * can skip adding the filter entirely.
 */
export function dateRangeCondition(
  fromValue: string | undefined | null,
  toValue: string | undefined | null
): { $gte?: Date; $lte?: Date } | null {
  const start = dayBoundary(fromValue, "start");
  const end = dayBoundary(toValue, "end");
  if (!start && !end) return null;
  return { ...(start ? { $gte: start } : {}), ...(end ? { $lte: end } : {}) };
}

/** Reads the raw "dateFrom"/"dateTo" params off a request query. */
export function dateRangeParams(query: Record<string, unknown>) {
  return {
    dateFrom: typeof query.dateFrom === "string" ? query.dateFrom : "",
    dateTo: typeof query.dateTo === "string" ? query.dateTo : ""
  };
}

function dayBoundary(value: string | undefined | null, edge: "start" | "end") {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  if (edge === "start") parsed.setHours(0, 0, 0, 0);
  else parsed.setHours(23, 59, 59, 999);
  return parsed;
}
