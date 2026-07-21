import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

export type QuoteStatus = "REQUESTED" | "UNDER_REVIEW" | "QUOTED" | "DECLINED" | "EXPIRED" | "CONVERTED";
export type QuoteAudience = "client" | "admin";
export type QuoteParcelInput = {
  sequence: number;
  actualWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};
export type ShipmentQuoteInput = {
  businessAccountId?: string;
  destinationCountryCode: string;
  destinationCountryName: string;
  shipmentType: "DOCUMENTS" | "PARCEL" | "MERCHANDISE" | "SAMPLES" | "GIFTS" | "RETURNS" | "OTHER";
  serviceType: "COURIER" | "CARGO";
  goodsValueMinor: number;
  contents: string;
  parcels: QuoteParcelInput[];
};
export type QuoteContext = {
  businessAccountId: string;
  accountId: string;
  companyName: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  originCity: string;
  branchContact: { email: string; phone: string };
  membershipRole?: "account_owner" | "account_admin" | "operations" | "finance" | "tracking_only";
};
export type QuoteEstimate = {
  currency: "INR";
  originCity: string;
  destinationCountryCode: string;
  destinationCountryName: string;
  serviceType: "COURIER" | "CARGO";
  parcels: Array<{
    sequence: number;
    actualWeightKg: number;
    volumetricWeightKg: number;
    chargeableWeightKg: number;
    rateFromKg: number | null;
    rateToKg: number | null;
    chargesPerKg: number | null;
    maxBoxKg: number | null;
    baseAmountMinor: number;
    exceedsMaxBoxKg: boolean;
  }>;
  freightMinor: number;
  fuelSurchargeMinor: number | null;
  taxableAddOnsMinor: number | null;
  gstRate: number;
  gstMinor: number;
  totalMinor: number;
  missingRate: boolean;
  exceedsMaxBoxKg: boolean;
};
export type FinalQuotePricing = {
  currency: "INR";
  freightMinor: number;
  fuelSurchargeMinor: number;
  taxableAddOnsMinor: number;
  taxableSubtotalMinor: number;
  gstRate: number;
  gstMinor: number;
  totalMinor: number;
};
export type ShipmentQuote = {
  id: string;
  quoteNumber: string;
  businessAccountId: string;
  branchId: string;
  source: "CLIENT" | "ADMIN";
  status: QuoteStatus;
  request: ShipmentQuoteInput & { originCity: string };
  estimate: QuoteEstimate;
  finalPricing: FinalQuotePricing | null;
  customerNote: string;
  internalNote: string;
  validUntil: string | null;
  convertedDraftId: string | null;
  createdAt: string;
  updatedAt: string;
  account: Omit<QuoteContext, "businessAccountId" | "branchId" | "membershipRole"> | null;
};

function headers(init: HeadersInit | undefined, token: string | null) {
  const result = new Headers(init);
  if (token) result.set("Authorization", `Bearer ${token}`);
  return result;
}

async function fetchWithAuth(input: string, init: RequestInit = {}) {
  const token = getAccessToken() ?? await refreshAccessToken();
  let response = await fetch(input, { ...init, headers: headers(init.headers, token) });
  if (response.status !== 401) return response;
  const refreshed = await refreshAccessToken();
  if (!refreshed) return response;
  response = await fetch(input, { ...init, headers: headers(init.headers, refreshed) });
  return response;
}

async function parse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.message || "Shipment quote request failed.");
  return data as T;
}

function root(audience: QuoteAudience) {
  return audience === "client" ? "/api/v1/client/quotes" : "/api/v1/quote-requests";
}

function json(method: string, body?: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}

export async function getQuoteContext(audience: QuoteAudience) {
  return parse<{ success: true; context?: QuoteContext; accounts?: QuoteContext[] }>(
    await fetchWithAuth(apiUrl(`${root(audience)}/context`))
  );
}

export async function estimateShipmentQuote(audience: QuoteAudience, input: ShipmentQuoteInput) {
  return parse<{ success: true; context: QuoteContext; estimate: QuoteEstimate }>(
    await fetchWithAuth(apiUrl(`${root(audience)}/estimate`), json("POST", input))
  );
}

export async function createShipmentQuote(audience: QuoteAudience, input: ShipmentQuoteInput) {
  return parse<{ success: true; quote: ShipmentQuote }>(
    await fetchWithAuth(apiUrl(root(audience)), json("POST", input))
  );
}

export async function createShipmentDraftFromQuote(audience: QuoteAudience, input: ShipmentQuoteInput) {
  return parse<{ success: true; shipmentDraftId: string }>(
    await fetchWithAuth(apiUrl(`${root(audience)}/draft`), json("POST", input))
  );
}

export async function listShipmentQuotes(audience: QuoteAudience, status = "") {
  const url = new URL(apiUrl(root(audience)));
  if (status) url.searchParams.set("status", status);
  return parse<{ success: true; quotes: ShipmentQuote[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(
    await fetchWithAuth(url.toString())
  );
}

export async function getShipmentQuote(audience: QuoteAudience, quoteId: string) {
  return parse<{ success: true; quote: ShipmentQuote }>(
    await fetchWithAuth(apiUrl(`${root(audience)}/${quoteId}`))
  );
}

export async function updateShipmentQuoteStatus(quoteId: string, status: "UNDER_REVIEW" | "DECLINED", note = "") {
  return parse<{ success: true; quote: ShipmentQuote }>(
    await fetchWithAuth(apiUrl(`/api/v1/quote-requests/${quoteId}/status`), json("PATCH", { status, note }))
  );
}

export async function publishShipmentQuote(quoteId: string, input: {
  freightMinor: number; fuelSurchargeMinor: number; taxableAddOnsMinor: number;
  validUntil: string; customerNote: string; internalNote: string;
}) {
  return parse<{ success: true; quote: ShipmentQuote }>(
    await fetchWithAuth(apiUrl(`/api/v1/quote-requests/${quoteId}/publish`), json("POST", input))
  );
}

export async function convertShipmentQuote(audience: QuoteAudience, quoteId: string) {
  return parse<{ success: true; shipmentDraftId: string }>(
    await fetchWithAuth(apiUrl(`${root(audience)}/${quoteId}/convert`), json("POST"))
  );
}

export function formatQuoteMoney(amountMinor: number | null | undefined) {
  if (amountMinor === null || amountMinor === undefined) return "Not configured";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amountMinor / 100);
}
