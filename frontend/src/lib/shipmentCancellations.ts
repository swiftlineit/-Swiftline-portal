import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

export type ShipmentCancellation = {
  id: string;
  shipmentDraftId: string;
  dpdShipmentId: string;
  businessAccountId: string;
  branchId: string;
  requesterType: "CLIENT" | "ADMIN";
  requesterRole: string;
  reason: string;
  shipmentStatusAtRequest: string;
  status: "REQUESTED" | "COMPLETED" | "REJECTED";
  originalAmountMinor: number;
  requestedFeeBaseMinor: number;
  approvedFeeBaseMinor: number | null;
  feeGstMinor: number | null;
  feeTotalMinor: number | null;
  refundableAmountMinor: number | null;
  feeReason: string;
  carrierConfirmed: boolean;
  settlementConfirmed: boolean;
  carrierReference: string;
  reviewNote: string;
  settlement: {
    originalCreditReversedMinor: number;
    cancellationFeeCreditMinor: number;
    netCreditReleasedMinor: number;
    statementCreditAppliedMinor: number;
    customerAdvanceCreditedMinor: number;
  } | null;
  creditNoteId: string | null;
  cancellationFeeInvoiceId: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  completedAt: string | null;
  shipmentReference?: string;
  consignee?: string;
  branch?: { id: string; name: string; code: string } | null;
  businessAccount?: { id: string; accountId: string; companyName: string } | null;
};

async function fetchWithAuth(input: string, init: RequestInit = {}) {
  let token = getAccessToken() ?? await refreshAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", "Bearer " + token);
  let response = await fetch(input, { ...init, headers });
  if (response.status !== 401) return response;
  token = await refreshAccessToken();
  if (!token) return response;
  headers.set("Authorization", "Bearer " + token);
  response = await fetch(input, { ...init, headers });
  return response;
}

async function parse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || "The cancellation request could not be completed.");
  }
  return data as T;
}

export async function getClientShipmentCancellation(draftId: string) {
  const response = await fetchWithAuth(apiUrl("/api/v1/client/shipments/" + draftId + "/cancellation"));
  return parse<{ success: true; canRequest: boolean; cancellation: ShipmentCancellation | null }>(response);
}

export async function requestClientShipmentCancellation(draftId: string, reason: string) {
  const response = await fetchWithAuth(apiUrl("/api/v1/client/shipments/" + draftId + "/cancellation"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
  return parse<{ success: true; cancellation: ShipmentCancellation }>(response);
}

export async function getAdminShipmentCancellation(draftId: string) {
  const response = await fetchWithAuth(apiUrl("/api/v1/shipment-cancellations/drafts/" + draftId));
  return parse<{ success: true; canRequest: true; cancellation: ShipmentCancellation | null }>(response);
}

export async function requestAdminShipmentCancellation(draftId: string, reason: string) {
  const response = await fetchWithAuth(apiUrl("/api/v1/shipment-cancellations/drafts/" + draftId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
  return parse<{ success: true; cancellation: ShipmentCancellation }>(response);
}

export async function listShipmentCancellations(status = "") {
  const query = status ? "?status=" + encodeURIComponent(status) : "";
  const response = await fetchWithAuth(apiUrl("/api/v1/shipment-cancellations" + query));
  return parse<{ success: true; cancellations: ShipmentCancellation[] }>(response);
}

export async function approveShipmentCancellation(
  id: string,
  input: {
    feeBaseMinor: number;
    feeReason: string;
    carrierConfirmed: true;
    settlementConfirmed: true;
    carrierReference: string;
    reviewNote: string;
  }
) {
  const response = await fetchWithAuth(apiUrl("/api/v1/shipment-cancellations/" + id + "/approve"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return parse<{ success: true; cancellation: ShipmentCancellation }>(response);
}

export async function rejectShipmentCancellation(id: string, reviewNote: string) {
  const response = await fetchWithAuth(apiUrl("/api/v1/shipment-cancellations/" + id + "/reject"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reviewNote })
  });
  return parse<{ success: true; cancellation: ShipmentCancellation }>(response);
}

async function cancellationPdf(id: string, type: "credit-note" | "fee-invoice", audience: "client" | "admin") {
  const base = audience === "client"
    ? "/api/v1/client/shipment-cancellations/" + id + "/" + type + "/pdf"
    : "/api/v1/shipment-cancellations/" + id + "/" + type + "/pdf";
  const response = await fetchWithAuth(apiUrl(base));
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "The financial document could not be opened.");
  }
  return response.blob();
}

export async function openCancellationPdf(
  id: string,
  type: "credit-note" | "fee-invoice",
  audience: "client" | "admin"
) {
  const blob = await cancellationPdf(id, type, audience);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function downloadCancellationPdf(
  id: string,
  type: "credit-note" | "fee-invoice",
  audience: "client" | "admin"
) {
  const blob = await cancellationPdf(id, type, audience);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = type === "credit-note" ? "shipment-credit-note.pdf" : "cancellation-fee-invoice.pdf";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function printCancellationPdf(
  id: string,
  type: "credit-note" | "fee-invoice",
  audience: "client" | "admin"
) {
  const blob = await cancellationPdf(id, type, audience);
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(url, "_blank");
  if (!printWindow) {
    URL.revokeObjectURL(url);
    throw new Error("Allow pop-ups to print this financial document.");
  }
  printWindow.addEventListener("load", () => printWindow.print(), { once: true });
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}
