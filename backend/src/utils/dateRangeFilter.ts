/**
 * Turns a single "YYYY-MM-DD" query param into the [start, end) bounds for that
 * calendar day, matching the single-date filter pattern used across list
 * endpoints (see shipmentListing.service.ts). Returns null for an empty or
 * unparsable value so callers can skip adding the filter entirely.
 */
export function dayBounds(dateValue: string | undefined | null): { start: Date; end: Date } | null {
  if (!dateValue) return null;
  const selectedDate = new Date(dateValue);
  if (Number.isNaN(selectedDate.getTime())) return null;
  const start = new Date(selectedDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(selectedDate);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
