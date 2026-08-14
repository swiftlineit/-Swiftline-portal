import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

/**
 * The POD Centre's data access.
 *
 * Kept apart from `pods.ts`, which serves the per-shipment panel: that one
 * answers "show me this shipment's POD", this one answers "show me every POD
 * I have", and they filter and paginate differently.
 */

export type PodCentreItem = {
  assignmentId: string;
  shipmentDraftId: string;
  awb: string;
  carrierReference: string;
  consignee: string;
  destination: string;
  parcelNumbers: string[];
  recipientName: string;
  recipientRelationship: string;
  deliveredAt: string | null;
  revisionId: string;
  evidenceCount: number;
};

export const POD_CENTRE_PATH = "/api/v1/client/pods";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let token = getAccessToken() ?? await refreshAccessToken();
  const send = () => fetch(apiUrl(path), {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
  let response = await send();
  if (response.status === 401) {
    token = await refreshAccessToken();
    if (token) response = await send();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.message || "Proof of delivery could not be loaded.");
  return data as T;
}

export function podCentreParams(input: { search?: string; dateFrom?: string; dateTo?: string } = {}) {
  const params = new URLSearchParams();
  if (input.search?.trim()) params.set("search", input.search.trim());
  if (input.dateFrom) params.set("dateFrom", input.dateFrom);
  if (input.dateTo) params.set("dateTo", input.dateTo);
  return params;
}

export function listPodCentre(input: { search?: string; dateFrom?: string; dateTo?: string } = {}) {
  const query = podCentreParams(input).toString();
  return request<{ success: true; pods: PodCentreItem[] }>(`${POD_CENTRE_PATH}${query ? `?${query}` : ""}`);
}

export function emailPods(assignmentIds: string[]) {
  return request<{ success: true; message: string }>(`${POD_CENTRE_PATH}/email`, {
    method: "POST",
    body: JSON.stringify({ assignmentIds })
  });
}

/**
 * Downloads the merged POD document.
 *
 * With ids, exactly those; without, everything matching the current filters —
 * which is what "download all" means on a list somebody has just narrowed.
 */
export async function downloadPodPdf(input: {
  assignmentIds?: string[];
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}) {
  let token = getAccessToken() ?? await refreshAccessToken();
  const params = podCentreParams(input);
  if (input.assignmentIds?.length) params.set("ids", input.assignmentIds.join(","));

  const send = () => fetch(apiUrl(`${POD_CENTRE_PATH}/download?${params.toString()}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  let response = await send();
  if (response.status === 401) {
    token = await refreshAccessToken();
    if (token) response = await send();
  }
  if (!response.ok) {
    const message = await response.json().then((body) => body?.message).catch(() => null);
    throw new Error(message || "The proof of delivery document could not be generated.");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = response.headers.get("Content-Disposition")?.match(/filename="?([^"]+)"?/i)?.[1]
    ?? `swiftline-pod-${new Date().toISOString().slice(0, 10)}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
