import { apiUrl } from "@/lib/api";
import { getAccessToken, readJsonSafely, refreshAccessToken } from "@/lib/auth";

export type PodEvidence = { id: string; type: "PHOTO" | "SIGNATURE" | "PARTNER_DOCUMENT"; originalName: string; mimeType: string; size: number; capturedAt: string };
export type PodRevision = { id: string; revisionNumber: number; status: string; parcelNumbers: string[]; recipientName: string; recipientRelationship: string; deliveredAt: string; destinationTimeZone: string; partnerReference: string; notes: string; signatureExceptionReason: string; signatureExceptionStatus: string; reviewReason: string; evidence: PodEvidence[]; submittedAt: string | null; reviewedAt: string | null };
export type PodAssignment = {
  id: string; shipmentDraftId: string; businessAccountId: string; branchId: string; status: string;
  latestPodStatus?: string | null;
  parcelNumbers: string[]; deliveredParcelNumbers: string[]; partnerReference: string; expectedDeliveryAt: string | null;
  deliveryPartnerId?: { _id: string; name: string; code: string } | null;
  currentDeliveryPersonProfileId?: { _id: string; userId?: { firstName?: string; lastName?: string; name?: string; phone?: string; email?: string } };
  shipment?: { consigneeEnteredAddress: Record<string, string>; consigneeSelectedAddress?: Record<string, string>; consigneeValidatedAddress?: Record<string, string>; parcelCount: number; serviceCode: string };
  booking?: { swiftlineTrackingNumber: string; dpdShipmentId: string; parcelNumbers: string[]; serviceCode: string };
  revisions?: PodRevision[]; attempts?: Array<{ _id: string; reason: string; notes: string; nextActionAt: string; attemptedAt: string }>;
  disputes?: Array<{ _id: string; category: string; details: string; status: string; createdAt: string }>;
};
export type DeliveryPartner = { _id: string; name: string; code: string; countries: string[]; contactName: string; email: string; phone: string; podSlaHours: number };
export type EligiblePodShipment = { id: string; businessAccountId: string; branchId: string; consignee: Record<string, string>; parcelCount: number; serviceCode: string; trackingNumber: string; parcelNumbers: string[] };
export type DeliveryPersonOption = { id: string; deliveryPartnerId?: DeliveryPartner | null; user?: { firstName?: string; lastName?: string; name?: string; phone?: string } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let token = getAccessToken() ?? await refreshAccessToken();
  if (!token) throw new Error("Your session has expired.");
  const send = () => fetch(apiUrl(path), { ...init, headers: { ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...init?.headers, Authorization: `Bearer ${token}` } });
  let response = await send();
  if (response.status === 401) { token = await refreshAccessToken(); if (!token) throw new Error("Your session has expired."); response = await send(); }
  const payload = await readJsonSafely(response) as { success?: boolean; message?: string };
  if (!response.ok || !payload.success) throw new Error(payload.message || "The POD request could not be completed.");
  return payload as T;
}

async function blob(path: string) { let token = getAccessToken() ?? await refreshAccessToken(); if (!token) throw new Error("Your session has expired."); let response = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${token}` } }); if (response.status === 401) { token = await refreshAccessToken(); if (!token) throw new Error("Your session has expired."); response = await fetch(apiUrl(path), { headers: { Authorization: `Bearer ${token}` } }); } if (!response.ok) { const data = await readJsonSafely(response) as { message?: string }; throw new Error(data.message || "Evidence could not be opened."); } return response.blob(); }

export const listPodPartners = () => request<{ success: true; partners: DeliveryPartner[] }>("/api/v1/pod/partners");
export const createPodPartner = (input: Omit<DeliveryPartner, "_id"> & { contractReference?: string }) => request<{ success: true; message: string; partner: DeliveryPartner }>("/api/v1/pod/partners", { method: "POST", body: JSON.stringify(input) });
export const listPodEligibleShipments = () => request<{ success: true; shipments: EligiblePodShipment[] }>("/api/v1/pod/eligible-shipments");
export const listDeliveryPeople = () => request<{ success: true; deliveryPeople: DeliveryPersonOption[] }>("/api/v1/pod/delivery-people");
export const listManagedPods = () => request<{ success: true; assignments: PodAssignment[] }>("/api/v1/pod/assignments");
export const getManagedPod = (id: string) => request<{ success: true; assignment: PodAssignment }>(`/api/v1/pod/assignments/${id}`);
export const createPodAssignment = (input: { shipmentDraftId: string; deliveryPersonProfileId: string; deliveryPartnerId?: string | null; parcelNumbers: string[]; partnerReference: string; expectedDeliveryAt?: string | null }) => request<{ success: true; message: string; assignment: PodAssignment }>("/api/v1/pod/assignments", { method: "POST", body: JSON.stringify(input) });
export const reviewPod = (id: string, approved: boolean, reason: string) => request<{ success: true; message: string; assignment: PodAssignment }>(`/api/v1/pod/assignments/${id}/review`, { method: "POST", body: JSON.stringify({ approved, reason }) });
export const reviewSignatureException = (id: string, approved: boolean, reason: string) => request<{ success: true; message: string; assignment: PodAssignment }>(`/api/v1/pod/assignments/${id}/signature-exception/review`, { method: "POST", body: JSON.stringify({ approved, reason }) });
export const reassignPod = (id: string, deliveryPersonProfileId: string, reason: string) => request<{ success: true; message: string; assignment: PodAssignment }>(`/api/v1/pod/assignments/${id}/reassign`, { method: "POST", body: JSON.stringify({ deliveryPersonProfileId, reason }) });
export const submitManagedPod = (id: string, input: Record<string, unknown>) => request<{ success: true; message: string; assignment: PodAssignment }>(`/api/v1/pod/assignments/${id}/manual-submit`, { method: "POST", body: JSON.stringify(input) });

export const listMyDeliveries = () => request<{ success: true; assignments: PodAssignment[] }>("/api/v1/driver/deliveries/assignments");
export const getMyDelivery = (id: string) => request<{ success: true; assignment: PodAssignment }>(`/api/v1/driver/deliveries/assignments/${id}`);
export const updateMyDeliveryStatus = (id: string, status: "ACCEPTED" | "OUT_FOR_DELIVERY") => request<{ success: true; message: string; assignment: PodAssignment }>(`/api/v1/driver/deliveries/assignments/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
export const saveMyPodDraft = (id: string, input: Record<string, unknown>) => request<{ success: true; message: string; assignment: PodAssignment }>(`/api/v1/driver/deliveries/assignments/${id}/draft`, { method: "PUT", body: JSON.stringify(input) });
export const submitMyPod = (id: string) => request<{ success: true; message: string; assignment: PodAssignment }>(`/api/v1/driver/deliveries/assignments/${id}/submit`, { method: "POST" });
export const requestMySignatureException = (id: string, reason: string) => request<{ success: true; message: string; assignment: PodAssignment }>(`/api/v1/driver/deliveries/assignments/${id}/signature-exception`, { method: "POST", body: JSON.stringify({ reason }) });
export const recordMyFailedDelivery = (id: string, input: { reason: string; notes: string; nextActionAt: string }) => request<{ success: true; message: string; assignment: PodAssignment }>(`/api/v1/driver/deliveries/assignments/${id}/failed-attempt`, { method: "POST", body: JSON.stringify(input) });
export async function uploadPodEvidence(id: string, type: PodEvidence["type"], file: Blob, audience: "manager" | "delivery" = "delivery") { const data = new FormData(); data.append("evidence", file, file instanceof File ? file.name : `${type.toLowerCase()}.png`); const root = audience === "manager" ? "/api/v1/pod" : "/api/v1/driver/deliveries"; return request<{ success: true; message: string; assignment: PodAssignment }>(`${root}/assignments/${id}/evidence/${type}`, { method: "POST", body: data }); }
export const loadPodEvidence = (assignmentId: string, revisionId: string, evidenceId: string, audience: "manager" | "delivery" | "client") => blob(audience === "client" ? `/api/v1/client/pod/assignments/${assignmentId}/revisions/${revisionId}/evidence/${evidenceId}` : audience === "manager" ? `/api/v1/pod/assignments/${assignmentId}/revisions/${revisionId}/evidence/${evidenceId}` : `/api/v1/driver/deliveries/assignments/${assignmentId}/revisions/${revisionId}/evidence/${evidenceId}`);
export const getClientPod = (shipmentId: string) => request<{ success: true; pod: PodAssignment }>(`/api/v1/client/shipments/${shipmentId}/pod`);
export const reportPodIssue = (shipmentId: string, category: string, details: string) => request<{ success: true; message: string }>(`/api/v1/client/shipments/${shipmentId}/pod/disputes`, { method: "POST", body: JSON.stringify({ category, details }) });
