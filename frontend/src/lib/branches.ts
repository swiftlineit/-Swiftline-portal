import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

export const branchServices = [
  "EXPRESS_COURIER",
  "AIR_FREIGHT",
  "SEA_FREIGHT",
  "ROAD_FREIGHT",
  "RAIL_FREIGHT",
  "CUSTOMS_CLEARANCE",
  "WAREHOUSING",
  "COMMERCIAL_CARGO",
  "PERSONAL_SHIPMENTS",
  "LAST_MILE_DELIVERY"
] as const;

export const shipmentCoverageTypes = ["DOMESTIC", "INTERNATIONAL", "IMPORT", "EXPORT"] as const;
export const workingDays = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export const branchStatuses = ["DRAFT", "ACTIVE", "INACTIVE", "SUSPENDED", "CLOSED"] as const;

export type BranchService = (typeof branchServices)[number];
export type ShipmentCoverage = (typeof shipmentCoverageTypes)[number];
export type WorkingDay = (typeof workingDays)[number];
export type BranchStatus = (typeof branchStatuses)[number];

export type Branch = {
  _id: string;
  name: string;
  code: string;
  labelCode: string;
  openingDate?: string | null;
  description?: string;
  address: {
    countryCode: string;
    countryName: string;
    city: string;
    stateOrProvince: string;
    postalCode: string;
    address: string;
  };
  contact: {
    email: string;
    phone: string;
  };
  operations: {
    supportedServices: BranchService[];
    shipmentCoverage: ShipmentCoverage[];
    operatingCountries: string[];
    workingDays: WorkingDay[];
  };
  baseCurrency: string;
  gstin: string;
  invoiceSacCode: string;
  status: BranchStatus;
  createdBy?: { email?: string; name?: string };
  createdAt: string;
  updatedAt: string;
};

export type BranchFormData = {
  name: string;
  code: string;
  labelCode: string;
  openingDate: string;
  description: string;
  address: Branch["address"];
  contact: Branch["contact"];
  operations: Branch["operations"];
  baseCurrency: string;
  gstin: string;
  invoiceSacCode: string;
};

export const countryOptions = [
  { code: "IN", name: "India" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "SG", name: "Singapore" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
  { code: "CN", name: "China" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "MY", name: "Malaysia" },
  { code: "TH", name: "Thailand" }
] as const;

export const currencyOptions = ["INR", "USD", "AED", "GBP", "EUR", "SGD", "CAD", "AUD", "SAR"] as const;

export function formatBranchLabel(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

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

async function parseApiResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok || !data.success) {
    const formattedError = findFirstApiError(data.errors);
    throw new Error(data.message || formattedError || "Branch request failed");
  }

  return data as T;
}

function findFirstApiError(value: unknown): string {
  if (!value || typeof value !== "object") return "";

  const errors = (value as { _errors?: unknown })._errors;
  if (Array.isArray(errors) && typeof errors[0] === "string") {
    return errors[0];
  }

  for (const nested of Object.values(value)) {
    const message = findFirstApiError(nested);
    if (message) return message;
  }

  return "";
}

export async function listBranches(search = "", status = "") {
  const url = new URL(apiUrl("/api/v1/branches"));
  if (search) url.searchParams.set("search", search);
  if (status) url.searchParams.set("status", status);

  const response = await fetchWithAuth(url.toString());

  return parseApiResponse<{ success: true; branches: Branch[] }>(response);
}

export async function getBranch(branchId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/branches/${branchId}`));

  return parseApiResponse<{ success: true; branch: Branch }>(response);
}

export async function validateBranchCode(code: string) {
  const url = new URL(apiUrl("/api/v1/branches/validate-code"));
  url.searchParams.set("code", code);

  const response = await fetchWithAuth(url.toString());

  return parseApiResponse<{ success: true; exists: boolean; valid: boolean }>(response);
}

export async function validateBranchCodeForEdit(code: string, branchId: string) {
  const url = new URL(apiUrl("/api/v1/branches/validate-code"));
  url.searchParams.set("code", code);
  url.searchParams.set("excludeBranchId", branchId);

  const response = await fetchWithAuth(url.toString());

  return parseApiResponse<{ success: true; exists: boolean; valid: boolean }>(response);
}

export function branchToFormData(branch: Branch): BranchFormData {
  return {
    name: branch.name,
    code: branch.code,
    labelCode: branch.labelCode ?? "",
    openingDate: branch.openingDate ? branch.openingDate.slice(0, 10) : "",
    description: branch.description ?? "",
    address: {
      countryCode: branch.address.countryCode ?? "",
      countryName: branch.address.countryName ?? "",
      city: branch.address.city ?? "",
      stateOrProvince: branch.address.stateOrProvince ?? "",
      postalCode: branch.address.postalCode ?? "",
      address: branch.address.address ?? ""
    },
    contact: {
      email: branch.contact.email ?? "",
      phone: branch.contact.phone ?? ""
    },
    operations: {
      supportedServices: branch.operations.supportedServices ?? [],
      shipmentCoverage: branch.operations.shipmentCoverage ?? [],
      operatingCountries: branch.operations.operatingCountries ?? [],
      workingDays: branch.operations.workingDays ?? []
    },
    baseCurrency: branch.baseCurrency ?? "",
    gstin: branch.gstin ?? "",
    invoiceSacCode: branch.invoiceSacCode ?? ""
  };
}

export async function createBranch(data: BranchFormData, status: "DRAFT" | "ACTIVE") {
  const response = await fetchWithAuth(apiUrl("/api/v1/branches"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, status })
  });

  return parseApiResponse<{ success: true; branch: Branch }>(response);
}

export async function updateBranch(branchId: string, data: BranchFormData, status: "DRAFT" | "ACTIVE") {
  const response = await fetchWithAuth(apiUrl(`/api/v1/branches/${branchId}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, status })
  });

  return parseApiResponse<{ success: true; branch: Branch }>(response);
}
