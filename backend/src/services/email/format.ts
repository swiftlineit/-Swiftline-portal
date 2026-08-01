/** Shared value formatting so every template renders money and dates alike. */

export function formatMoneyMinor(amountMinor: number, currency = "INR") {
  const amount = Number.isFinite(amountMinor) ? amountMinor / 100 : 0;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

export function formatDateTime(value: Date | string | number | null | undefined) {
  if (!value) return "Not available";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata"
  }).format(date);
}

export function formatDate(value: Date | string | number | null | undefined) {
  if (!value) return "Not available";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";

  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(date);
}

export function asText(value: unknown, fallback = "Not provided") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

export function asNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

/**
 * Notification `href` values are portal-relative. Absolute values are passed
 * through so a template can point at something outside the SPA.
 */
export function toAbsoluteUrl(appUrl: string, href: string) {
  if (!href) return appUrl;
  if (/^https?:\/\//i.test(href)) return href;
  return `${appUrl.replace(/\/+$/, "")}/${href.replace(/^\/+/, "")}`;
}

export function firstNameOf(fullName: string) {
  const trimmed = fullName.trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0] ?? "there";
}
