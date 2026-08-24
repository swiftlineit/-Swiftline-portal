function getDateParts(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return {
    day: String(date.getDate()).padStart(2, "0"),
    month: String(date.getMonth() + 1).padStart(2, "0"),
    year: String(date.getFullYear()),
    hours: String(date.getHours()).padStart(2, "0"),
    minutes: String(date.getMinutes()).padStart(2, "0")
  };
}

export function formatDashboardDate(value?: string | Date | null) {
  if (!value) return "Not available";
  const parts = getDateParts(value);
  if (!parts) return "Not available";
  return `${parts.day}-${parts.month}-${parts.year}`;
}

export function formatDashboardDateTime(value?: string | Date | null) {
  if (!value) return "Not available";
  const parts = getDateParts(value);
  if (!parts) return "Not available";
  return `${parts.day}-${parts.month}-${parts.year} • ${parts.hours}:${parts.minutes}`;
}

/**
 * Right now, written the way <input type="datetime-local"> reads it.
 *
 * Used as the `max` on the optional status date, so the picker itself refuses a
 * scan dated in the future rather than leaving the server to explain it. Local
 * wall-clock on purpose- the operator states the time on their own clock.
 */
export function currentDateTimeLocal() {
  const parts = getDateParts(new Date());
  if (!parts) return "";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hours}:${parts.minutes}`;
}

/**
 * A datetime-local value ("2026-08-21T14:30") as the ISO instant the API takes,
 * or "" when nothing was picked. The input carries no timezone, so it is read as
 * the operator's local time- which is what they meant by it.
 */
export function dateTimeLocalToIso(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
