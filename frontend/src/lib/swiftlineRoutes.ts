import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";
import type { CountryRateService } from "@/lib/countryRateCards";

/**
 * Swiftline Routes — the lanes we operate and how long each one takes.
 *
 * A route is origin + destination + service. Transit time lives here rather than
 * on the rate card because it is an operational fact, not a priced one: it does
 * not change with a customer's band.
 */

export const routeTransitBases = ["BUSINESS_DAYS", "CALENDAR_DAYS"] as const;
export type RouteTransitBasis = (typeof routeTransitBases)[number];

export const routeTransitBasisLabels: Record<RouteTransitBasis, string> = {
  BUSINESS_DAYS: "Business days",
  CALENDAR_DAYS: "Calendar days"
};

export type SwiftlineRoute = {
  _id: string;
  originCountryCode: string;
  destinationCountryCode: string;
  destinationCountryName: string;
  service: CountryRateService;
  transitDaysMin: number;
  transitDaysMax: number;
  transitBasis: RouteTransitBasis;
  serviceable: boolean;
  cutOffTime: string;
  restrictions: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type SwiftlineRouteInput = {
  destinationCountryCode: string;
  destinationCountryName: string;
  service: CountryRateService;
  transitDaysMin: number;
  transitDaysMax: number;
  transitBasis: RouteTransitBasis;
  serviceable: boolean;
  cutOffTime: string;
  restrictions: string;
  notes: string;
};

function buildAuthHeaders(headers: HeadersInit | undefined, token: string | null) {
  const nextHeaders = new Headers(headers);

  if (token) nextHeaders.set("Authorization", `Bearer ${token}`);

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

async function parseApiResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok || !data.success) {
    // The route endpoints report validation problems as a string list, so the
    // first one is shown rather than a generic failure message.
    const listError = Array.isArray(data.errors) && typeof data.errors[0] === "string" ? data.errors[0] : "";
    throw new Error(data.message || listError || "Swiftline route request failed");
  }

  return data as T;
}

/** How a lane's transit time reads in a table cell, e.g. "3–5 business days". */
export function formatTransitTime(route: Pick<SwiftlineRoute, "transitDaysMin" | "transitDaysMax" | "transitBasis">) {
  const unit = route.transitBasis === "BUSINESS_DAYS" ? "business days" : "calendar days";
  if (route.transitDaysMin === route.transitDaysMax) {
    return `${route.transitDaysMin} ${route.transitDaysMin === 1 ? unit.replace("days", "day") : unit}`;
  }

  return `${route.transitDaysMin}–${route.transitDaysMax} ${unit}`;
}

export async function listSwiftlineRoutes(filters: { service?: string; search?: string } = {}) {
  const query = new URLSearchParams();
  if (filters.service) query.set("service", filters.service);
  if (filters.search) query.set("search", filters.search);
  const suffix = query.toString() ? `?${query.toString()}` : "";

  const response = await fetchWithAuth(apiUrl(`/api/v1/swiftline-routes${suffix}`));

  return parseApiResponse<{ success: true; routes: SwiftlineRoute[] }>(response);
}

/** Creates or replaces a lane. The server keys on origin + destination + service. */
export async function saveSwiftlineRoute(input: SwiftlineRouteInput) {
  const response = await fetchWithAuth(apiUrl("/api/v1/swiftline-routes"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseApiResponse<{ success: true; message: string; route: SwiftlineRoute }>(response);
}

export async function deleteSwiftlineRoute(routeId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/swiftline-routes/${routeId}`), {
    method: "DELETE"
  });

  return parseApiResponse<{ success: true; message: string }>(response);
}
