import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

/** Global search across everything a customer holds a number for. */

export type SearchResultKind =
  | "SHIPMENT"
  | "INVOICE"
  | "MANIFEST"
  | "PICKUP"
  | "CLAIM"
  | "TICKET";

export type ClientSearchResult = {
  kind: SearchResultKind;
  title: string;
  subtitle: string;
  href: string;
  /** Which field matched, so an unexpected hit explains itself. */
  matchedOn: string;
};

export const searchKindLabels: Record<SearchResultKind, string> = {
  SHIPMENT: "Shipment",
  INVOICE: "Invoice",
  MANIFEST: "Manifest",
  PICKUP: "Pickup",
  CLAIM: "Claim",
  TICKET: "Ticket"
};

/** The shortest term the server will act on. Kept here so the UI can say so. */
export const MIN_SEARCH_LENGTH = 2;

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

export async function searchClientRecords(input: {
  /** Required for a client search. Staff search spans accounts and omits it. */
  businessAccountId?: string;
  audience?: "client" | "staff";
  term: string;
  signal?: AbortSignal;
}): Promise<ClientSearchResult[]> {
  const query = new URLSearchParams({ q: input.term });
  if (input.businessAccountId) query.set("businessAccountId", input.businessAccountId);

  const path = input.audience === "staff"
    ? `/api/v1/shipments/search?${query.toString()}`
    : `/api/v1/client/search?${query.toString()}`;

  const response = await fetchWithAuth(apiUrl(path), { signal: input.signal });
  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(data.message || "Search failed");
  }

  return data.results as ClientSearchResult[];
}
