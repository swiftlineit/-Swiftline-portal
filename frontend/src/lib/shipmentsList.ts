import { apiUrl } from "@/lib/api";
import { getAccessToken, readJsonSafely, refreshAccessToken } from "@/lib/auth";

export type ShipmentAudience = "admin" | "client";

export type ShipmentListItem = {
  id: string;
  businessAccountId: string;
  businessAccountName: string;
  businessAccountCode: string;
  branchId: string;
  branch: { name: string; code: string; city: string };
  shipmentReference: string;
  invoiceNumber: string;
  swiftlineTrackingNumber: string;
  awbNumbers: string[];
  forwardingNumbers: string[];
  consignor: string;
  consignee: string;
  destination: string;
  destinationCountry: string;
  product: string;
  serviceInfo: string;
  route: string;
  shipmentInvoice: {
    invoiceNumber: string;
    currency: string;
    chargeableAmountMinor: number;
    status: "DRAFT" | "ISSUED";
    revision: number;
  } | null;
  pieces: number;
  weightKg: number;
  status: string;
  statusLabel: string;
  manifest: { id: string; manifestNumber: string } | null;
  manifestEligible: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ShipmentListPagination = { page: number; limit: number; total: number; totalPages: number };

/** Statuses a booked shipment can currently be in, newest stage last. */
export const shipmentStatusOptions = [
  { value: "SHIPMENT_BOOKED", label: "Shipment Booked" },
  { value: "ON_HOLD", label: "On Hold" },
  { value: "RELEASED_FROM_HOLD", label: "Released From Hold" },
  { value: "PARCEL_COLLECTED", label: "Parcel Collected" },
  { value: "WAREHOUSE_SCAN_IN", label: "Warehouse Scan In" },
  { value: "EXPORT_CUSTOMS_CLEARED", label: "Export Customs Cleared" },
  { value: "FLIGHT_ASSIGNED", label: "Flight Assigned" },
  { value: "FLIGHT_DEPARTED", label: "Flight Departed" },
  { value: "DESTINATION_ARRIVED", label: "Destination Arrived" },
  { value: "IMPORT_CUSTOMS_CLEARANCE", label: "Import Customs Clearance" },
  { value: "IN_TRANSIT", label: "In Transit" },
  { value: "OUT_FOR_DELIVERY", label: "Out For Delivery" },
  { value: "DELIVERED", label: "Delivered" },
  { value: "RETURNED", label: "Returned" },
  { value: "SHIPMENT_CANCELLED", label: "Cancelled" }
];

export async function fetchWithAuth(path: string, init?: RequestInit) {
  let token = getAccessToken() ?? await refreshAccessToken();
  if (!token) throw new Error("Your session has expired. Please sign in again.");
  const send = () => fetch(apiUrl(path), {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
      Authorization: `Bearer ${token}`
    }
  });

  let response = await send();
  if (response.status === 401) {
    token = await refreshAccessToken();
    if (!token) throw new Error("Your session has expired. Please sign in again.");
    response = await send();
  }
  return response;
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithAuth(path, init);
  const payload = await readJsonSafely(response) as { success?: boolean; message?: string };
  if (!response.ok || !payload.success) {
    throw new Error(payload.message || "The shipment request could not be completed.");
  }
  return payload as T;
}

export async function listShipments(audience: ShipmentAudience, input: {
  page?: number;
  limit?: number;
  status?: string;
  businessAccountId?: string;
  branchId?: string;
} = {}) {
  const params = new URLSearchParams();
  params.set("page", String(input.page ?? 1));
  params.set("limit", String(input.limit ?? 20));
  if (input.status) params.set("status", input.status);
  if (input.businessAccountId) params.set("businessAccountId", input.businessAccountId);
  if (input.branchId) params.set("branchId", input.branchId);
  const base = audience === "client" ? "/api/v1/client/booked-shipments" : "/api/v1/shipments";

  return requestJson<{
    success: true;
    shipments: ShipmentListItem[];
    pagination: ShipmentListPagination;
  }>(`${base}?${params.toString()}`);
}

export function shipmentDetailsHref(audience: ShipmentAudience, shipmentId: string) {
  return audience === "client" ? `/client/shipments/${shipmentId}` : `/dashboard/shipments/${shipmentId}`;
}
