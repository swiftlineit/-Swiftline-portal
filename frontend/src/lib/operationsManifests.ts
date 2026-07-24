import { apiUrl } from "@/lib/api";
import { getAccessToken, readJsonSafely, refreshAccessToken } from "@/lib/auth";

export type ManifestStatus = "DRAFT" | "PACKING" | "READY_TO_SEAL" | "SEALED" | "DISPATCHED" | "CANCELLED";
export type ManifestHeader = { destinationAgent: string; destinationCountryCode: string; destinationCountryName: string; flightNumber: string; departureDate: string; mawbNumber: string; originIataCode: string; destinationIataCode: string; valueType: string };
export type OperationsManifest = { id: string; manifestNumber: string; branchId: string; branch?: { name: string; code: string } | null; header: ManifestHeader; status: ManifestStatus; totalBags: number; totalConsignments: number; totalPhysicalParcels: number; totalWeightKg: number; createdAt: string; updatedAt: string };
export type OperationsBag = { id: string; bagNumber: string; status: "OPEN" | "CLOSED" | "REOPENED" | "CANCELLED"; totalConsignments: number; totalPhysicalParcels: number; totalWeightKg: number };
export type OperationsConsignment = { id: string; bagId: string; bagIds: string[]; bagNumbers: string[]; consignmentNumber: string; displayConsignmentNumber: string; expectedParcelNumbers: string[]; scannedParcelNumbers: string[]; weightKg: number; status: "PARTIAL" | "COMPLETE"; consigneeSnapshot: { name?: string; formatted?: string }; consignorSnapshot: { name?: string; formatted?: string }; description: string; declaredValueMinor?: number | null; serviceInfo: string; goodsValueRequired: boolean; dpdWarning: string };
export type OperationsScan = { id: string; bagId: string | null; parcelNumber: string; status: "ACCEPTED" | "REJECTED" | "REMOVED"; message: string; scannedAt: string };
export type ManifestDetail = { manifest: OperationsManifest; bags: OperationsBag[]; consignments: OperationsConsignment[]; scans: OperationsScan[]; latestScan: OperationsScan | null; sealingIssues: string[] };
export type OperationsScanSession = {
  id: string;
  manifestId: string;
  branchId: string;
  status: "PENDING" | "ACTIVE" | "ENDED";
  pairingExpiresAt: string;
  sessionExpiresAt: string;
  connectedAt: string | null;
  lastSeenAt: string | null;
  lastScanAt: string | null;
  endedReason: string;
  manifest: {
    manifestNumber: string;
    status: ManifestStatus;
    destinationCountryCode: string;
    destinationCountryName: string;
    totalPhysicalParcels: number;
    totalWeightKg: number;
  } | null;
  activeBag: {
    id: string;
    bagNumber: string;
    status: OperationsBag["status"];
    totalPhysicalParcels: number;
    totalWeightKg: number;
  } | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let token = getAccessToken() ?? await refreshAccessToken();
  let response = await fetch(apiUrl(path), { ...init, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers, Authorization: `Bearer ${token}` } });
  if (response.status === 401) {
    token = await refreshAccessToken();
    response = await fetch(apiUrl(path), { ...init, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers, Authorization: `Bearer ${token}` } });
  }
  const data = await readJsonSafely(response) as { success?: boolean; message?: string };
  if (!response.ok || !data.success) {
    throw new Error(data.message
      || (response.status === 429 ? "The scanner is sending requests too quickly. Pause briefly and try again." : "")
      || "The operations manifest request could not be completed.");
  }
  return data as T;
}

export const listManifestBranches = () => request<{ success: true; branches: Array<{ id: string; name: string; code: string }> }>("/api/v1/operations-manifests/branches/options");
export const listOperationsManifests = (page = 1, status = "") => request<{ success: true; items: OperationsManifest[]; pagination: { page: number; pages: number; total: number } }>(`/api/v1/operations-manifests?page=${page}&limit=15${status ? `&status=${status}` : ""}`);
export const createOperationsManifest = (body: { branchId: string; header: ManifestHeader }) => request<{ success: true; manifestId: string; manifestNumber: string }>("/api/v1/operations-manifests", { method: "POST", body: JSON.stringify(body) });
export const getOperationsManifest = (id: string) => request<{ success: true } & ManifestDetail>(`/api/v1/operations-manifests/${id}`);
export const createOperationsBag = (id: string) => request(`/api/v1/operations-manifests/${id}/bags`, { method: "POST", body: "{}" });
export const scanOperationsParcel = (
  id: string,
  bagId: string,
  parcelNumber: string,
  scanRequestId: string,
  options?: { scanSource?: "MANUAL" | "CAMERA" | "HARDWARE"; sessionId?: string }
) => request<{ success: true } & ManifestDetail>(`/api/v1/operations-manifests/${id}/scan`, {
  method: "POST",
  body: JSON.stringify({ bagId, parcelNumber, scanRequestId, ...options })
});
export const createOperationsScanSession = (manifestId: string, activeBagId: string) => request<{
  success: true;
  session: OperationsScanSession;
  qrDataUri: string;
}>(`/api/v1/operations-manifests/${manifestId}/scan-sessions`, {
  method: "POST",
  body: JSON.stringify({ activeBagId })
});
export const pairOperationsScanSession = (token: string) => request<{
  success: true;
  session: OperationsScanSession;
}>("/api/v1/operations-manifests/scan-sessions/pair", {
  method: "POST",
  body: JSON.stringify({ token })
});
export const getOperationsScanSession = (sessionId: string) => request<{
  success: true;
  session: OperationsScanSession;
}>(`/api/v1/operations-manifests/scan-sessions/${sessionId}/status`);
export const getActiveOperationsScanSession = (manifestId: string) => request<{
  success: true;
  session: OperationsScanSession | null;
}>(`/api/v1/operations-manifests/${manifestId}/scan-sessions/active`);
export const changeOperationsScanSessionBag = (manifestId: string, sessionId: string, activeBagId: string) => request<{
  success: true;
  session: OperationsScanSession;
}>(`/api/v1/operations-manifests/${manifestId}/scan-sessions/${sessionId}/bag`, {
  method: "PATCH",
  body: JSON.stringify({ activeBagId })
});
export const disconnectOperationsScanSession = (manifestId: string, sessionId: string) => request<{
  success: true;
  session: OperationsScanSession;
}>(`/api/v1/operations-manifests/${manifestId}/scan-sessions/${sessionId}`, { method: "DELETE" });
export const setOperationsGoodsValue = (id: string, consignmentId: string, declaredValueMinor: number) => request(`/api/v1/operations-manifests/${id}/consignments/${consignmentId}/value`, { method: "PATCH", body: JSON.stringify({ declaredValueMinor }) });
export const runManifestAction = (id: string, action: "seal" | "dispatch" | "cancel", reason = "") => request<{ success: true; message: string }>(`/api/v1/operations-manifests/${id}/${action}`, { method: "POST", body: JSON.stringify(reason ? { reason } : {}) });
export const runBagAction = (id: string, bagId: string, action: "close" | "reopen" | "cancel", reason = "") => request<{ success: true; message: string }>(`/api/v1/operations-manifests/${id}/bags/${bagId}/${action}`, { method: "POST", body: JSON.stringify(reason ? { reason } : {}) });
export const removeOperationsScan = (id: string, scanId: string, reason: string) => request(`/api/v1/operations-manifests/${id}/scans/${scanId}/remove`, { method: "POST", body: JSON.stringify({ reason }) });

export async function downloadOperationsManifest(id: string, format: "xlsx" | "pdf", view = false) {
  const token = getAccessToken() ?? await refreshAccessToken();
  const response = await fetch(apiUrl(`/api/v1/operations-manifests/${id}/export.${format}${view ? "?view=1" : ""}`), { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.message || "Manifest export could not be opened."); }
  const url = URL.createObjectURL(await response.blob());
  if (view) window.open(url, "_blank", "noopener,noreferrer"); else { const link = document.createElement("a"); link.href = url; link.download = `operations-manifest.${format}`; link.click(); }
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
