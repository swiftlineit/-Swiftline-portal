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
