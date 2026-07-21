import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

export type DpdEnvironment = "TEST" | "PRODUCTION";
export type DpdLabelSize = "A4" | "A6";
export type DpdPrintFormat = "PDF" | "ZPL";

export type DpdConfiguration = {
  id: string;
  branchId: string;
  environment: DpdEnvironment;
  businessUnitCode: string;
  customerId: string;
  senderAddressId: string;
  depotCode: string;
  defaultServiceCode: string;
  defaultLabelSize: DpdLabelSize;
  defaultPrintFormat: DpdPrintFormat;
  active: boolean;
  credentialsConfigured: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type DpdConfigurationInput = {
  branchId: string;
  environment: DpdEnvironment;
  businessUnitCode: string;
  customerId: string;
  senderAddressId: string;
  depotCode: string;
  defaultServiceCode: string;
  defaultLabelSize: DpdLabelSize;
  defaultPrintFormat: DpdPrintFormat;
  active: boolean;
  credentials?: {
    username: string;
    password: string;
    apiToken?: string;
    accountNumber?: string;
  };
};

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
    throw new Error(data.message || formattedError || "DPD configuration request failed");
  }

  return data as T;
}

export async function listDpdConfigurations(branchId = "") {
  const url = new URL(apiUrl("/api/v1/dpd-configurations"));
  if (branchId) url.searchParams.set("branchId", branchId);

  const response = await fetchWithAuth(url.toString());

  return parseApiResponse<{
    success: true;
    configurations: DpdConfiguration[];
  }>(response);
}

export async function saveDpdConfiguration(input: DpdConfigurationInput) {
  const response = await fetchWithAuth(apiUrl("/api/v1/dpd-configurations"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseApiResponse<{
    success: true;
    configuration: DpdConfiguration;
  }>(response);
}
