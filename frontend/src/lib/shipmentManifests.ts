import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

export type ShipmentManifestAudience = "admin" | "client";

export type ShipmentManifestSummary = {
  id: string;
  manifestNumber: string;
  businessAccountId: string;
  branchId: string;
  shipmentDraftIds: string[];
  destinationAgent: string;
  flightNumber: string;
  departureDate: string;
  mawbNumber: string;
  originIataCode: string;
  destinationIataCode: string;
  totalPieces: number;
  totalWeightKg: number;
  totalBags: number;
  shipmentCount: number;
  actorRole: ShipmentManifestAudience;
  generatedAt: string;
};

export type ManifestEligibleShipment = {
  shipmentDraftId: string;
  dpdShipmentId: string;
  consignmentNumber: string;
  shipmentReference: string;
  consignee: string;
  destination: string;
  pieces: number;
  weightKg: number;
  serviceInfo: string;
};

export type ShipmentManifestContext = {
  canCreate: boolean;
  currentShipmentDraftId: string;
  existingManifests: ShipmentManifestSummary[];
  eligibleShipments: ManifestEligibleShipment[];
};

export type CreateShipmentManifestInput = {
  currentShipmentDraftId: string;
  destinationAgent: string;
  flightNumber: string;
  departureDate: string;
  mawbNumber: string;
  originIataCode: string;
  destinationIataCode: string;
  valueType: string;
  lines: Array<{
    shipmentDraftId: string;
    declaredValueMinor: number;
    bagNumber: string;
  }>;
};

async function fetchWithAuth(input: string, init?: RequestInit) {
  let token = getAccessToken() ?? await refreshAccessToken();
  if (!token) throw new Error("Your session has expired. Please sign in again.");
  let response = await fetch(input, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` }
  });
  if (response.status === 401) {
    token = await refreshAccessToken();
    if (!token) throw new Error("Your session has expired. Please sign in again.");
    response = await fetch(input, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` }
    });
  }
  return response;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) throw new Error(payload.message || "Manifest request could not be completed.");
  return payload as T;
}

function paths(audience: ShipmentManifestAudience, draftId?: string, manifestId?: string) {
  if (audience === "client") {
    return {
      context: `/api/v1/client/shipments/${draftId}/manifests/context`,
      create: "/api/v1/client/shipment-manifests",
      download: `/api/v1/client/shipment-manifests/${manifestId}/download`
    };
  }
  return {
    context: `/api/v1/shipment-manifests/drafts/${draftId}/context`,
    create: "/api/v1/shipment-manifests",
    download: `/api/v1/shipment-manifests/${manifestId}/download`
  };
}

export async function getShipmentManifestContext(draftId: string, audience: ShipmentManifestAudience) {
  const response = await fetchWithAuth(apiUrl(paths(audience, draftId).context));
  return readJson<{ success: true } & ShipmentManifestContext>(response);
}

export async function createShipmentManifest(input: CreateShipmentManifestInput, audience: ShipmentManifestAudience) {
  const response = await fetchWithAuth(apiUrl(paths(audience).create), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return readJson<{ success: true; manifest: ShipmentManifestSummary }>(response);
}

export async function downloadShipmentManifest(manifest: ShipmentManifestSummary, audience: ShipmentManifestAudience) {
  const response = await fetchWithAuth(apiUrl(paths(audience, undefined, manifest.id).download));
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(payload.message || "Manifest could not be downloaded.");
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `MANIFEST-${manifest.manifestNumber}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}
