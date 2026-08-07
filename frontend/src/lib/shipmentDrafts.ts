import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

/** Which portal the caller is in; the two have separate route trees. */
export type ShipmentDraftActor = "admin" | "client";

/** One row of the unbooked-drafts list. */
export type EditableShipmentDraft = {
  id: string;
  customerType: "BUSINESS" | "INDIVIDUAL";
  status: string;
  bookingState: string;
  invoiceNumber: string;
  shipmentReference: string;
  consigneeName: string;
  destination: string;
  parcelCount: number;
  totalWeightKg: number;
  businessAccount: { accountId: string; companyName: string };
  branch: { name: string; code: string };
  validationIssues: string[];
  createdAt?: string | null;
  updatedAt?: string | null;
};

async function fetchWithAuth(input: string, init: RequestInit = {}) {
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(input, { ...init, headers, credentials: "include" });
  if (response.status !== 401) return response;

  const refreshed = await refreshAccessToken();
  if (!refreshed) return response;

  const retryHeaders = new Headers(init.headers);
  retryHeaders.set("Authorization", `Bearer ${refreshed}`);
  return fetch(input, { ...init, headers: retryHeaders, credentials: "include" });
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Shipment draft request failed.");
  }
  return data as T;
}

function draftPath(actor: ShipmentDraftActor, shipmentDraftId: string) {
  return actor === "client"
    ? `/api/v1/client/dpd-labels/drafts/${shipmentDraftId}`
    : `/api/v1/shipment-drafts/${shipmentDraftId}`;
}

/**
 * Deletes an unbooked draft.
 *
 * Deletion is soft on the server, which is what makes `restoreShipmentDraft`
 * below able to back an undo action. Booked shipments are refused with a 409
 * explaining why, so the caller should surface the thrown message rather than a
 * generic failure.
 */
export async function deleteShipmentDraft(actor: ShipmentDraftActor, shipmentDraftId: string) {
  const response = await fetchWithAuth(apiUrl(draftPath(actor, shipmentDraftId)), { method: "DELETE" });

  return parseApiResponse<{ success: true; message: string; shipmentDraftId: string }>(response);
}

/** Undo for the delete above. Only valid for a short window — see the service. */
export async function restoreShipmentDraft(actor: ShipmentDraftActor, shipmentDraftId: string) {
  const response = await fetchWithAuth(apiUrl(`${draftPath(actor, shipmentDraftId)}/restore`), {
    method: "POST"
  });

  return parseApiResponse<{ success: true; message: string }>(response);
}

/**
 * Drafts that have not been sent to the carrier, newest activity first.
 *
 * Admin only: the client portal already lists its drafts alongside its booked
 * shipments, whereas the admin shipment list is built from carrier records and
 * so never showed these at all.
 */
export async function listEditableShipmentDrafts(input: {
  branchId?: string;
  businessAccountId?: string;
  page?: number;
  limit?: number;
} = {}) {
  const url = new URL(apiUrl("/api/v1/shipment-drafts/editable"));
  if (input.branchId) url.searchParams.set("branchId", input.branchId);
  if (input.businessAccountId) url.searchParams.set("businessAccountId", input.businessAccountId);
  url.searchParams.set("page", String(input.page ?? 1));
  url.searchParams.set("limit", String(input.limit ?? 20));

  const response = await fetchWithAuth(url.toString());

  return parseApiResponse<{
    success: true;
    drafts: EditableShipmentDraft[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>(response);
}
