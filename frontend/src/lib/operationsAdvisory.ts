import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

// ── Service disruptions ───────────────────────────────────────────────────────

export const serviceDisruptionTypes = [
  "WEATHER_DISRUPTION",
  "AIRPORT_CLOSURE",
  "CUSTOMS_STRIKE",
  "PUBLIC_HOLIDAY",
  "FLIGHT_CANCELLATION",
  "SECURITY_RESTRICTION",
  "PEAK_SEASON_DELAY"
] as const;
export type ServiceDisruptionType = (typeof serviceDisruptionTypes)[number];

export const serviceDisruptionSeverities = ["INFO", "WARNING", "CRITICAL"] as const;
export type ServiceDisruptionSeverity = (typeof serviceDisruptionSeverities)[number];

export const serviceDisruptionTypeLabels: Record<ServiceDisruptionType, string> = {
  WEATHER_DISRUPTION: "Weather disruption",
  AIRPORT_CLOSURE: "Airport closure",
  CUSTOMS_STRIKE: "Customs strike",
  PUBLIC_HOLIDAY: "Public holiday",
  FLIGHT_CANCELLATION: "Flight cancellation",
  SECURITY_RESTRICTION: "Security restriction",
  PEAK_SEASON_DELAY: "Peak season delay"
};

export type ServiceDisruption = {
  id: string;
  type: ServiceDisruptionType;
  severity: ServiceDisruptionSeverity;
  title: string;
  message: string;
  startAt: string;
  endAt: string | null;
  affectedBranches: string[];
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type ServiceDisruptionInput = {
  type: ServiceDisruptionType;
  severity: ServiceDisruptionSeverity;
  title: string;
  message: string;
  startAt: string;
  endAt: string | null;
  affectedBranches: string[];
  active: boolean;
};

// ── Holiday & Cut-Off Calendar ────────────────────────────────────────────────

export const calendarCategories = [
  "BRANCH_HOLIDAY",
  "DESTINATION_HOLIDAY",
  "CUSTOMS_HOLIDAY",
  "PICKUP_CUTOFF",
  "SAME_DAY_BOOKING_CUTOFF",
  "FLIGHT_CLOSING_TIME",
  "WEEKEND_DELIVERY",
  "PEAK_SEASON_RESTRICTION"
] as const;
export type CalendarCategory = (typeof calendarCategories)[number];

export const calendarCategoryLabels: Record<CalendarCategory, string> = {
  BRANCH_HOLIDAY: "Branch holidays",
  DESTINATION_HOLIDAY: "Destination holidays",
  CUSTOMS_HOLIDAY: "Customs holidays",
  PICKUP_CUTOFF: "Pickup cut-off time",
  SAME_DAY_BOOKING_CUTOFF: "Same-day booking cut-off",
  FLIGHT_CLOSING_TIME: "Flight closing time",
  WEEKEND_DELIVERY: "Weekend delivery availability",
  PEAK_SEASON_RESTRICTION: "Peak season restrictions"
};

export type CalendarEntryBranch = { _id: string; name: string; code: string };

export type CalendarEntry = {
  id: string;
  category: CalendarCategory;
  title: string;
  description: string;
  branchId: string | null;
  branch: CalendarEntryBranch | null;
  countryCode: string | null;
  locationLabel: string | null;
  date: string | null;
  endDate: string | null;
  time: string | null;
  weekendDeliveryAvailable: boolean | null;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type CalendarEntryInput = {
  category: CalendarCategory;
  title: string;
  description: string;
  branchId: string | null;
  countryCode: string | null;
  locationLabel: string | null;
  date: string | null;
  endDate: string | null;
  time: string | null;
  weekendDeliveryAvailable: boolean | null;
  active: boolean;
};

// ── HTTP plumbing ─────────────────────────────────────────────────────────────

function buildAuthHeaders(headers: HeadersInit | undefined, token: string | null) {
  const nextHeaders = new Headers(headers);

  if (token) {
    nextHeaders.set("Authorization", `Bearer ${token}`);
  }

  return nextHeaders;
}

async function fetchWithAuth(input: string, init: RequestInit = {}) {
  const token = getAccessToken() ?? await refreshAccessToken();
  const response = await fetch(input, {
    ...init,
    headers: buildAuthHeaders(init.headers, token)
  });

  if (response.status !== 401) return response;

  const refreshedToken = await refreshAccessToken();
  if (!refreshedToken) return response;

  return fetch(input, {
    ...init,
    headers: buildAuthHeaders(init.headers, refreshedToken)
  });
}

function findFirstApiError(value: unknown): string {
  if (!value || typeof value !== "object") return "";

  const errors = (value as { _errors?: unknown })._errors;
  if (Array.isArray(errors) && typeof errors[0] === "string") return errors[0];

  for (const nested of Object.values(value)) {
    const message = findFirstApiError(nested);
    if (message) return message;
  }

  return "";
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok || !data.success) {
    const formattedError = findFirstApiError(data.errors);
    throw new Error(data.message || formattedError || "Request failed");
  }

  return data as T;
}

// ── Staff endpoints ───────────────────────────────────────────────────────────

export async function listServiceDisruptions(input: { active?: boolean; scope?: "live" } = {}) {
  const url = new URL(apiUrl("/api/v1/operations-advisory/service-disruptions"));
  if (typeof input.active === "boolean") url.searchParams.set("active", String(input.active));
  if (input.scope === "live") url.searchParams.set("scope", "live");

  const response = await fetchWithAuth(url.toString());

  return parseApiResponse<{ success: true; disruptions: ServiceDisruption[] }>(response);
}

export async function createServiceDisruption(input: ServiceDisruptionInput) {
  const response = await fetchWithAuth(apiUrl("/api/v1/operations-advisory/service-disruptions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseApiResponse<{ success: true; disruption: ServiceDisruption }>(response);
}

export async function updateServiceDisruption(id: string, input: ServiceDisruptionInput) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/operations-advisory/service-disruptions/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseApiResponse<{ success: true; disruption: ServiceDisruption }>(response);
}

export async function deleteServiceDisruption(id: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/operations-advisory/service-disruptions/${id}`), {
    method: "DELETE"
  });

  return parseApiResponse<{ success: true; message: string }>(response);
}

export async function listCalendarEntries(input: { category?: CalendarCategory; active?: boolean } = {}) {
  const url = new URL(apiUrl("/api/v1/operations-advisory/calendar-entries"));
  if (input.category) url.searchParams.set("category", input.category);
  if (typeof input.active === "boolean") url.searchParams.set("active", String(input.active));

  const response = await fetchWithAuth(url.toString());

  return parseApiResponse<{ success: true; entries: CalendarEntry[] }>(response);
}

export async function createCalendarEntry(input: CalendarEntryInput) {
  const response = await fetchWithAuth(apiUrl("/api/v1/operations-advisory/calendar-entries"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseApiResponse<{ success: true; entry: CalendarEntry }>(response);
}

export async function updateCalendarEntry(id: string, input: CalendarEntryInput) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/operations-advisory/calendar-entries/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseApiResponse<{ success: true; entry: CalendarEntry }>(response);
}

export async function deleteCalendarEntry(id: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/operations-advisory/calendar-entries/${id}`), {
    method: "DELETE"
  });

  return parseApiResponse<{ success: true; message: string }>(response);
}

// ── Client endpoints ──────────────────────────────────────────────────────────

export async function listClientServiceDisruptions() {
  const response = await fetchWithAuth(apiUrl("/api/v1/client/service-disruptions"));

  return parseApiResponse<{ success: true; disruptions: ServiceDisruption[] }>(response);
}

export async function listClientCalendarEntries() {
  const response = await fetchWithAuth(apiUrl("/api/v1/client/calendar-entries"));

  return parseApiResponse<{ success: true; entries: CalendarEntry[] }>(response);
}
