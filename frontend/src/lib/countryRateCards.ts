import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

export const countryRateServices = ["COURIER", "CARGO"] as const;
export type CountryRateService = (typeof countryRateServices)[number];

export type CountryRateCard = {
  _id: string;
  countryCode: string;
  countryName: string;
  service: CountryRateService;
  fromKg: number;
  toKg: number;
  chargesPerKg: number;
  maxBoxKg: number;
  createdAt: string;
  updatedAt: string;
};

export type CountryRateCardInput = {
  countryCode: string;
  countryName: string;
  service: CountryRateService;
  fromKg: number;
  toKg: number;
  chargesPerKg: number;
  maxBoxKg: number;
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
    const listError = Array.isArray(data.errors) && typeof data.errors[0] === "string" ? data.errors[0] : "";
    throw new Error(data.message || formattedError || listError || "Country rate card request failed");
  }

  return data as T;
}

export function getCountryFlag(countryCode: string) {
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return Array.from(code).map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join("");
}

export function formatCountryRateService(service: string) {
  return service.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export async function listCountryRateCards() {
  const response = await fetchWithAuth(apiUrl("/api/v1/country-rate-cards"));

  return parseApiResponse<{
    success: true;
    rates: CountryRateCard[];
  }>(response);
}

export async function listClientCountryRateCards() {
  const response = await fetchWithAuth(apiUrl("/api/v1/client/country-rate-cards"));

  return parseApiResponse<{
    success: true;
    rates: CountryRateCard[];
  }>(response);
}

export async function saveCountryRateCard(input: CountryRateCardInput, rateId?: string) {
  const response = await fetchWithAuth(apiUrl(rateId ? `/api/v1/country-rate-cards/${rateId}` : "/api/v1/country-rate-cards"), {
    method: rateId ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseApiResponse<{
    success: true;
    rate: CountryRateCard;
  }>(response);
}

export async function deleteCountryRateCard(rateId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/country-rate-cards/${rateId}`), {
    method: "DELETE"
  });

  return parseApiResponse<{ success: true; message: string }>(response);
}

export function buildCountryRateCardCsv(rates: CountryRateCard[]) {
  const rows = [
    ["Country", "Service", "From KG", "To KG", "Charges / KG", "Max Box KG"],
    ...rates.map((rate) => [
      `${rate.countryName} (${rate.countryCode})`,
      formatCountryRateService(rate.service),
      String(rate.fromKg),
      String(rate.toKg),
      String(rate.chargesPerKg),
      String(rate.maxBoxKg)
    ])
  ];

  return rows
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
    .join("\n");
}
