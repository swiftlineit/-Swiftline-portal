import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

export type CreditStatementStatus = "ISSUED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "VOID";

export type CreditStatement = {
  id: string;
  statementNumber: string;
  businessAccountId: string;
  creditAccountId: string;
  billingCycle: "WEEKLY" | "MONTHLY";
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  dueAt: string;
  currency: "INR";
  lines: Array<{
    sourceType: "SHIPMENT_INVOICE" | "CANCELLATION_FEE_INVOICE";
    shipmentInvoiceId: string | null;
    cancellationFeeInvoiceId: string | null;
    shipmentDraftId: string;
    invoiceNumber: string;
    invoiceRevision: number;
    invoiceIssuedAt: string;
    outstandingAmountMinor: number;
  }>;
  adjustments: Array<{
    adjustmentId: string;
    shipmentInvoiceId: string;
    originalStatementId: string;
    description: string;
    amountMinor: number;
    affectsAmountDue: boolean;
  }>;
  totalAmountMinor: number;
  paidAmountMinor: number;
  creditAdjustmentMinor: number;
  outstandingAmountMinor: number;
  status: CreditStatementStatus;
};

export type CreditPayment = {
  id: string;
  businessAccountId: string;
  requestedStatementId: string | null;
  amountMinor: number;
  currency: "INR";
  method: "RAZORPAY" | "BANK_TRANSFER" | "UPI" | "CASH" | "CHEQUE";
  status: "CREATED" | "PENDING_VERIFICATION" | "PROCESSING" | "VERIFIED" | "FAILED";
  internalReference: string;
  externalReference: string;
  notes: string;
  allocations: Array<{ statementId: string; amountMinor: number }>;
  advanceAmountMinor: number;
  verifiedAt: string | null;
  createdAt: string;
};

export type CreditLedgerEntry = {
  id: string;
  type: string;
  reference: string;
  description: string;
  amountMinor: number;
  currency: "INR";
  availableCreditAfterMinor: number;
  availableAdvanceAfterMinor: number;
  createdAt: string;
};

async function fetchWithAuth(input: string, init: RequestInit = {}) {
  let token = getAccessToken() ?? await refreshAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status !== 401) return response;
  token = await refreshAccessToken();
  if (!token) return response;
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

async function parse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.message || "The credit billing request could not be completed.");
  return data as T;
}

function json(method: string, body?: unknown, idempotencyKey?: string): RequestInit {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
}

export function createPaymentRequestId() {
  return crypto.randomUUID?.() ?? `credit-payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export type CreditListPagination = { page: number; limit: number; total: number; totalPages: number };
export type CreditListFilter = { status?: string; date?: string; page?: number; limit?: number };

function withFilter(url: URL, filter: CreditListFilter = {}) {
  if (filter.status) url.searchParams.set("status", filter.status);
  if (filter.date) url.searchParams.set("date", filter.date);
  url.searchParams.set("page", String(filter.page ?? 1));
  // Omitted (rather than defaulted) so callers that want "the full recent
  // history in one call" keep that behavior; only pass this for paginated UIs.
  if (filter.limit) url.searchParams.set("limit", String(filter.limit));
  return url;
}

export async function listClientStatements(businessAccountId: string, filter: CreditListFilter = {}) {
  const url = withFilter(new URL(apiUrl("/api/v1/client/credit/statements")), filter);
  url.searchParams.set("businessAccountId", businessAccountId);
  return parse<{ success: true; statements: CreditStatement[]; pagination: CreditListPagination }>(await fetchWithAuth(url.toString()));
}

export async function getClientStatement(businessAccountId: string, statementId: string) {
  return parse<{ success: true; statement: CreditStatement }>(await fetchWithAuth(
    apiUrl(`/api/v1/client/credit/statements/${statementId}?businessAccountId=${encodeURIComponent(businessAccountId)}`)
  ));
}

export async function closeClientCycle(businessAccountId: string) {
  return parse<{ success: true; message: string; statement: CreditStatement | null }>(await fetchWithAuth(
    apiUrl("/api/v1/client/credit/statements/close-cycle"),
    json("POST", { businessAccountId })
  ));
}

export async function listAdminStatements(businessAccountId: string, filter: CreditListFilter = {}) {
  const url = withFilter(new URL(apiUrl(`/api/v1/credit-accounts/${businessAccountId}/statements`)), filter);
  return parse<{ success: true; statements: CreditStatement[]; pagination: CreditListPagination }>(await fetchWithAuth(url.toString()));
}

export async function getAdminStatement(businessAccountId: string, statementId: string) {
  return parse<{ success: true; statement: CreditStatement }>(await fetchWithAuth(
    apiUrl(`/api/v1/credit-accounts/${businessAccountId}/statements/${statementId}`)
  ));
}

export async function closeAdminCycle(businessAccountId: string) {
  return parse<{ success: true; message: string; statement: CreditStatement | null }>(await fetchWithAuth(
    apiUrl(`/api/v1/credit-accounts/${businessAccountId}/close-cycle`),
    json("POST")
  ));
}

export async function writeOffAdminStatement(businessAccountId: string, statementId: string, input: { amountMinor: number; reason: string }) {
  return parse<{ success: true; message: string; statement: CreditStatement }>(await fetchWithAuth(
    apiUrl(`/api/v1/credit-accounts/${businessAccountId}/statements/${statementId}/write-off`),
    json("POST", input)
  ));
}

export async function listClientCreditPayments(businessAccountId: string, filter: CreditListFilter = {}) {
  const url = withFilter(new URL(apiUrl("/api/v1/client/credit/payments")), filter);
  url.searchParams.set("businessAccountId", businessAccountId);
  return parse<{ success: true; payments: CreditPayment[]; pagination: CreditListPagination }>(await fetchWithAuth(url.toString()));
}

export async function listAdminCreditPayments(businessAccountId: string, filter: CreditListFilter = {}) {
  const url = withFilter(new URL(apiUrl(`/api/v1/credit-accounts/${businessAccountId}/payments`)), filter);
  return parse<{ success: true; payments: CreditPayment[]; pagination: CreditListPagination }>(await fetchWithAuth(url.toString()));
}

export async function submitClientOfflinePayment(input: {
  businessAccountId: string;
  requestedStatementId: string;
  amountMinor: number;
  method: "BANK_TRANSFER" | "UPI" | "CASH" | "CHEQUE";
  externalReference: string;
  notes: string;
}) {
  return parse<{ success: true; message: string; payment: CreditPayment }>(await fetchWithAuth(
    apiUrl("/api/v1/client/credit/payments/offline"),
    json("POST", input, createPaymentRequestId())
  ));
}

export async function recordAdminOfflinePayment(businessAccountId: string, input: {
  requestedStatementId: string;
  amountMinor: number;
  method: "BANK_TRANSFER" | "UPI" | "CASH" | "CHEQUE";
  externalReference: string;
  notes: string;
}) {
  return parse<{ success: true; message: string; payment: CreditPayment }>(await fetchWithAuth(
    apiUrl(`/api/v1/credit-accounts/${businessAccountId}/payments/offline`),
    json("POST", input, createPaymentRequestId())
  ));
}

export async function verifyAdminOfflinePayment(businessAccountId: string, paymentId: string) {
  return parse<{ success: true; message: string; payment: CreditPayment }>(await fetchWithAuth(
    apiUrl(`/api/v1/credit-accounts/${businessAccountId}/payments/${paymentId}/verify`),
    json("POST")
  ));
}

export async function createClientOnlinePayment(input: {
  businessAccountId: string;
  requestedStatementId: string;
  amountMinor: number;
}) {
  return parse<{
    success: true;
    payment: CreditPayment & { razorpayOrderId?: string };
    razorpay: { keyId: string };
  }>(await fetchWithAuth(
    apiUrl("/api/v1/client/credit/payments/online"),
    json("POST", input, createPaymentRequestId())
  ));
}

export async function verifyClientOnlinePayment(input: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}) {
  return parse<{ success: true; message: string; payment: CreditPayment }>(await fetchWithAuth(
    apiUrl("/api/v1/client/credit/payments/online/verify"),
    json("POST", input)
  ));
}

export type CreditLedgerListFilter = { date?: string; page?: number; limit?: number };

export async function listClientLedger(businessAccountId: string, filter: CreditLedgerListFilter = {}) {
  const url = withFilter(new URL(apiUrl("/api/v1/client/credit/ledger")), filter);
  url.searchParams.set("businessAccountId", businessAccountId);
  return parse<{ success: true; entries: CreditLedgerEntry[]; pagination: CreditListPagination }>(await fetchWithAuth(url.toString()));
}

export async function listAdminLedger(businessAccountId: string, filter: CreditLedgerListFilter = {}) {
  const url = withFilter(new URL(apiUrl(`/api/v1/credit-accounts/${businessAccountId}/ledger`)), filter);
  return parse<{ success: true; entries: CreditLedgerEntry[]; pagination: CreditListPagination }>(await fetchWithAuth(url.toString()));
}

export async function openAuthenticatedFile(url: string, downloadName?: string) {
  const response = await fetchWithAuth(apiUrl(url));
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "The document could not be opened.");
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  if (downloadName) {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = downloadName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return;
  }
  window.open(objectUrl, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

export async function printAuthenticatedPdf(url: string) {
  const response = await fetchWithAuth(apiUrl(url));
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "The document could not be printed.");
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const printWindow = window.open(objectUrl, "_blank");
  if (!printWindow) {
    URL.revokeObjectURL(objectUrl);
    throw new Error("Allow pop-ups to print this statement.");
  }
  printWindow.addEventListener("load", () => printWindow.print(), { once: true });
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
