import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

export type ShipmentImportEntryStatus = "READY" | "NEEDS_REVIEW" | "INVALID" | "DRAFT_CREATED" | "CREATE_FAILED";

export type ShipmentImportEntry = {
  id: string;
  position: number;
  originalFilename: string;
  fileChecksum: string;
  status: ShipmentImportEntryStatus;
  warnings: string[];
  errors: string[];
  shipmentDraftId: string | null;
  summary: {
    consignee: string;
    destination: string;
    references: string[];
    parcelCount: number;
    itemCount: number;
    totalWeightKg: number;
    declaredValue: number;
    serviceType: string;
    shipmentType: string;
  } | null;
};

export type ShipmentImportBatch = {
  id: string;
  businessAccountId: string;
  branchId: string;
  status: "PARSED" | "CREATING_DRAFTS" | "COMPLETED" | "PARTIAL" | "FAILED";
  fileCount: number;
  readyCount: number;
  needsReviewCount: number;
  invalidCount: number;
  createdCount: number;
  failedCount: number;
  confirmedAt: string | null;
  entries: ShipmentImportEntry[];
};

async function fetchWithAuth(input: string, init: RequestInit = {}) {
  let token = getAccessToken() ?? await refreshAccessToken();
  let response = await fetch(input, {
    ...init,
    headers: { ...Object.fromEntries(new Headers(init.headers).entries()), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  });
  if (response.status !== 401) return response;
  token = await refreshAccessToken();
  if (!token) return response;
  response = await fetch(input, {
    ...init,
    headers: { ...Object.fromEntries(new Headers(init.headers).entries()), Authorization: `Bearer ${token}` }
  });
  return response;
}

async function parse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.message || "Shipment import failed.");
  return data as T;
}

function basePath(audience: "admin" | "client") {
  return audience === "client" ? "/api/v1/client/shipment-imports" : "/api/v1/shipment-imports";
}

export async function downloadShipmentImportTemplate(audience: "admin" | "client") {
  const response = await fetchWithAuth(apiUrl(`${basePath(audience)}/template`));
  if (!response.ok) throw new Error("Unable to download the shipment import template.");
  return response.blob();
}

export async function previewShipmentImports(input: {
  audience: "admin" | "client";
  businessAccountId?: string;
  branchId: string;
  files: File[];
}) {
  const formData = new FormData();
  if (input.businessAccountId) formData.append("businessAccountId", input.businessAccountId);
  formData.append("branchId", input.branchId);
  input.files.forEach((file) => formData.append("shipmentFiles", file));
  const response = await fetchWithAuth(apiUrl(`${basePath(input.audience)}/batches`), { method: "POST", body: formData });
  return parse<{ success: true; batch: ShipmentImportBatch }>(response);
}

export async function createShipmentImportDrafts(input: {
  audience: "admin" | "client";
  batchId: string;
  entryIds: string[];
  idempotencyKey: string;
}) {
  const response = await fetchWithAuth(apiUrl(`${basePath(input.audience)}/batches/${input.batchId}/create-drafts`), {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({ entryIds: input.entryIds })
  });
  return parse<{ success: true; duplicateRequest: boolean; batch: ShipmentImportBatch }>(response);
}
