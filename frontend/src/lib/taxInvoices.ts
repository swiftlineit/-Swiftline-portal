import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

export type TaxInvoiceStatus = "DRAFT" | "FINALIZED";

export type TaxInvoiceParty = {
  name: string;
  companyName: string;
  address: string;
  email: string;
  phone: string;
  gstinUin: string;
  state: string;
  stateCode: string;
};

export type TaxInvoiceItem = {
  description: string;
  hsCode: string;
  unitType: string;
  quantity: number;
  unitRateMinor: number;
  amountMinor: number;
};

export type TaxInvoiceBox = {
  boxNumber: string;
  dimensions: {
    length: number | null;
    width: number | null;
    height: number | null;
    unit: string;
  };
  actualWeight: number | null;
  weightUnit: string;
  items: TaxInvoiceItem[];
};

export type TaxInvoiceTaxSummary = {
  hsnSac: string;
  gstType: "CGST" | "SGST" | "IGST" | "UTGST";
  taxableValueMinor: number;
  gstRatePercent: number;
  igstAmountMinor: number;
  totalTaxAmountMinor: number;
};

export type TaxInvoice = {
  _id: string;
  invoiceNumber: string;
  invoiceDate: string;
  otherReference: string;
  paymentTerms: string;
  buyerOrderNumber: string;
  dispatchDocumentNumber: string;
  dispatchedThrough: string;
  termsOfDelivery: string;
  shipperIdType: string;
  shipperIdNumber: string;
  shipper: TaxInvoiceParty;
  consignee: TaxInvoiceParty;
  countryOfOrigin: string;
  destinationCountry: string;
  declarationNote: string;
  currency: string;
  boxes: TaxInvoiceBox[];
  taxSummary: TaxInvoiceTaxSummary[];
  subTotalMinor: number;
  totalTaxAmountMinor: number;
  totalAmountMinor: number;
  amountInWords: string;
  taxAmountInWords: string;
  notes: string;
  status: TaxInvoiceStatus;
  finalizedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaxInvoicePayload = Omit<TaxInvoice, "_id" | "status" | "subTotalMinor" | "totalTaxAmountMinor" | "totalAmountMinor" | "finalizedAt" | "createdAt" | "updatedAt">;

export const emptyParty: TaxInvoiceParty = {
  name: "",
  companyName: "",
  address: "",
  email: "",
  phone: "",
  gstinUin: "",
  state: "",
  stateCode: ""
};

export function createEmptyTaxInvoicePayload(): TaxInvoicePayload {
  return {
    invoiceNumber: "",
    invoiceDate: new Date().toISOString().slice(0, 10),
    otherReference: "",
    paymentTerms: "",
    buyerOrderNumber: "",
    dispatchDocumentNumber: "",
    dispatchedThrough: "",
    termsOfDelivery: "",
    shipperIdType: "",
    shipperIdNumber: "",
    shipper: { ...emptyParty },
    consignee: { ...emptyParty },
    countryOfOrigin: "India",
    destinationCountry: "",
    declarationNote: "",
    currency: "INR",
    boxes: [createEmptyBox(1)],
    taxSummary: [createEmptyTaxSummary()],
    amountInWords: "",
    taxAmountInWords: "",
    notes: ""
  };
}

export function createEmptyBox(boxNumber: number): TaxInvoiceBox {
  return {
    boxNumber: String(boxNumber),
    dimensions: { length: null, width: null, height: null, unit: "cm" },
    actualWeight: null,
    weightUnit: "kg",
    items: [createEmptyItem()]
  };
}

export function createEmptyItem(): TaxInvoiceItem {
  return {
    description: "",
    hsCode: "",
    unitType: "PCS",
    quantity: 1,
    unitRateMinor: 0,
    amountMinor: 0
  };
}

export function createEmptyTaxSummary(): TaxInvoiceTaxSummary {
  return {
    hsnSac: "",
    gstType: "IGST",
    taxableValueMinor: 0,
    gstRatePercent: 0,
    igstAmountMinor: 0,
    totalTaxAmountMinor: 0
  };
}

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
    const formattedError = findFirstApiError(data.errors);
    throw new Error(data.message || formattedError || "Tax invoice request failed.");
  }

  return data as T;
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

export async function listTaxInvoices(search = "", status = "") {
  const url = new URL(apiUrl("/api/v1/tax-invoices"));
  if (search) url.searchParams.set("search", search);
  if (status) url.searchParams.set("status", status);

  const response = await fetchWithAuth(url.toString());
  return parseApiResponse<{ success: true; invoices: TaxInvoice[] }>(response);
}

export async function getTaxInvoice(invoiceId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/tax-invoices/${invoiceId}`));
  return parseApiResponse<{ success: true; invoice: TaxInvoice }>(response);
}

export async function createTaxInvoice(payload: TaxInvoicePayload) {
  const response = await fetchWithAuth(apiUrl("/api/v1/tax-invoices"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return parseApiResponse<{ success: true; invoice: TaxInvoice }>(response);
}

export async function updateTaxInvoice(invoiceId: string, payload: TaxInvoicePayload) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/tax-invoices/${invoiceId}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  return parseApiResponse<{ success: true; invoice: TaxInvoice }>(response);
}

export async function finalizeTaxInvoice(invoiceId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/tax-invoices/${invoiceId}/finalize`), {
    method: "POST"
  });

  return parseApiResponse<{ success: true; invoice: TaxInvoice }>(response);
}

export async function deleteTaxInvoice(invoiceId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/tax-invoices/${invoiceId}`), {
    method: "DELETE"
  });

  return parseApiResponse<{ success: true }>(response);
}

export function invoiceToPayload(invoice: TaxInvoice): TaxInvoicePayload {
  return {
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate.slice(0, 10),
    otherReference: invoice.otherReference,
    paymentTerms: invoice.paymentTerms ?? "",
    buyerOrderNumber: invoice.buyerOrderNumber ?? "",
    dispatchDocumentNumber: invoice.dispatchDocumentNumber ?? "",
    dispatchedThrough: invoice.dispatchedThrough ?? "",
    termsOfDelivery: invoice.termsOfDelivery ?? "",
    shipperIdType: invoice.shipperIdType,
    shipperIdNumber: invoice.shipperIdNumber,
    shipper: { ...emptyParty, ...invoice.shipper },
    consignee: { ...emptyParty, ...invoice.consignee },
    countryOfOrigin: invoice.countryOfOrigin,
    destinationCountry: invoice.destinationCountry,
    declarationNote: invoice.declarationNote,
    currency: invoice.currency,
    boxes: invoice.boxes,
    taxSummary: invoice.taxSummary?.length ? invoice.taxSummary : [createEmptyTaxSummary()],
    amountInWords: invoice.amountInWords,
    taxAmountInWords: invoice.taxAmountInWords,
    notes: invoice.notes
  };
}

export function computeInvoiceSubTotalMinor(boxes: TaxInvoiceBox[]) {
  return boxes.reduce((invoiceTotal, box) => {
    return invoiceTotal + box.items.reduce((boxTotal, item) => {
      return boxTotal + Math.max(0, Math.trunc(item.quantity || 0)) * Math.max(0, Math.trunc(item.unitRateMinor || 0));
    }, 0);
  }, 0);
}

export function computeTaxSummaryTotalMinor(taxSummary: TaxInvoiceTaxSummary[]) {
  return taxSummary.reduce((total, row) => {
    return total + Math.round((row.taxableValueMinor || 0) * (row.gstRatePercent || 0) / 100);
  }, 0);
}

export function computeInvoiceTotalMinor(boxes: TaxInvoiceBox[], taxSummary: TaxInvoiceTaxSummary[] = []) {
  return computeInvoiceSubTotalMinor(boxes) + computeTaxSummaryTotalMinor(taxSummary);
}

export function formatMinorMoney(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency || "INR",
    minimumFractionDigits: 2
  }).format((amountMinor || 0) / 100);
}

const numberWordsBelowTwenty = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen"
];

const tensWords = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function wordsBelowThousand(value: number) {
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;

  if (hundreds) parts.push(`${numberWordsBelowTwenty[hundreds] ?? ""} Hundred`);
  if (rest > 0 && rest < 20) parts.push(numberWordsBelowTwenty[rest] ?? "");
  if (rest >= 20) {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    parts.push(ones ? `${tensWords[tens] ?? ""} ${numberWordsBelowTwenty[ones] ?? ""}` : tensWords[tens] ?? "");
  }

  return parts.join(" ");
}

function integerToIndianWords(value: number): string {
  if (value === 0) return "Zero";

  const crore = Math.floor(value / 10000000);
  const lakh = Math.floor((value % 10000000) / 100000);
  const thousand = Math.floor((value % 100000) / 1000);
  const rest = value % 1000;
  const parts: string[] = [];

  if (crore) parts.push(`${integerToIndianWords(crore)} Crore`);
  if (lakh) parts.push(`${wordsBelowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${wordsBelowThousand(thousand)} Thousand`);
  if (rest) parts.push(wordsBelowThousand(rest));

  return parts.join(" ");
}

export function amountMinorToWords(amountMinor: number, currency: string) {
  const major = Math.floor((amountMinor || 0) / 100);
  const minor = Math.abs(amountMinor || 0) % 100;
  const currencyLabel = currency.toUpperCase() === "INR" ? "Rupees" : currency.toUpperCase();
  const minorLabel = currency.toUpperCase() === "INR" ? "Paise" : "Cents";
  const majorWords = `${integerToIndianWords(major)} ${currencyLabel}`;

  if (!minor) return `${majorWords} Only`;
  return `${majorWords} And ${integerToIndianWords(minor)} ${minorLabel} Only`;
}
