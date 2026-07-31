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
  businessAccountName: string;
  origin: string;
  destination: string;
  coloader: string;
  paymentType: string;
  totalPieces: number;
  totalWeightKg: number;
  totalBags: number;
  shipmentCount: number;
  actorRole: ShipmentManifestAudience;
  generatedAt: string;
};

export type ShipmentManifestListItem = ShipmentManifestSummary & {
  generatedBy: string;
  createdAt: string;
};

export type CreateBulkShipmentManifestInput = {
  shipmentDraftIds: string[];
  origin: string;
  destination: string;
  coloader: string;
  paymentType: string;
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

export type CreateAdminShipmentManifestInput = {
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

export type CreateClientShipmentManifestInput = {
  currentShipmentDraftId: string;
  declaredValueMinor: number;
};

export type CreateShipmentManifestInput = CreateAdminShipmentManifestInput | CreateClientShipmentManifestInput;

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

function manifestRoot(audience: ShipmentManifestAudience) {
  return audience === "client" ? "/api/v1/client/shipment-manifests" : "/api/v1/shipment-manifests";
}

function paths(audience: ShipmentManifestAudience, draftId?: string, manifestId?: string) {
  const root = manifestRoot(audience);
  return {
    context: audience === "client"
      ? `/api/v1/client/shipments/${draftId}/manifests/context`
      : `/api/v1/shipment-manifests/drafts/${draftId}/context`,
    create: root,
    createBulk: `${root}/bulk`,
    download: `${root}/${manifestId}/download`
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

export async function createBulkShipmentManifest(
  input: CreateBulkShipmentManifestInput,
  audience: ShipmentManifestAudience
) {
  const response = await fetchWithAuth(apiUrl(paths(audience).createBulk), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  return readJson<{ success: true; manifest: ShipmentManifestSummary }>(response);
}

export async function listShipmentManifests(audience: ShipmentManifestAudience, input: {
  page?: number;
  limit?: number;
  businessAccountId?: string;
  date?: string;
} = {}) {
  const params = new URLSearchParams();
  params.set("page", String(input.page ?? 1));
  params.set("limit", String(input.limit ?? 15));
  if (input.businessAccountId) params.set("businessAccountId", input.businessAccountId);
  if (input.date) params.set("date", input.date);
  const response = await fetchWithAuth(apiUrl(`${manifestRoot(audience)}?${params.toString()}`));
  return readJson<{
    success: true;
    manifests: ShipmentManifestListItem[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>(response);
}

/** Downloads (or opens) the handover manifest PDF. */
export async function downloadShipmentManifest(
  manifest: Pick<ShipmentManifestSummary, "id" | "manifestNumber">,
  audience: ShipmentManifestAudience,
  view = false
) {
  const response = await fetchWithAuth(
    apiUrl(`${manifestRoot(audience)}/${manifest.id}/pdf${view ? "?view=1" : ""}`)
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(payload.message || "Manifest could not be downloaded.");
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  if (view) {
    window.open(objectUrl, "_blank", "noopener,noreferrer");
  } else {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `MANIFEST-${manifest.manifestNumber}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}

export function manifestsHref(audience: ShipmentManifestAudience) {
  return audience === "client" ? "/client/manifests" : "/dashboard/shipment-manifests";
}
