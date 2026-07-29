import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

export type TicketAudience = "client" | "admin";
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "WAITING_FOR_CUSTOMER" | "RESOLVED" | "CLOSED";
export type TicketPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type TicketCategory = "SHIPMENT_BOOKING" | "TRACKING" | "LABEL_MANIFEST" | "AMENDMENT_CANCELLATION" | "SHIPMENT_DELAYED" | "SHIPMENT_NOT_RECEIVED" | "SHIPMENT_LOST" | "SHIPMENT_THEFT" | "SHIPMENT_DAMAGED" | "INVOICE_PAYMENT" | "CREDIT_ACCOUNT" | "ACCOUNT_ACCESS" | "TECHNICAL" | "OTHER";

export const ticketCategories: Array<{ value: TicketCategory; label: string }> = [
  { value: "SHIPMENT_BOOKING", label: "Shipment Booking" }, { value: "TRACKING", label: "Tracking" },
  { value: "LABEL_MANIFEST", label: "Label or Manifest" }, { value: "AMENDMENT_CANCELLATION", label: "Amendment or Cancellation" },
  { value: "SHIPMENT_DELAYED", label: "Shipment Delayed" }, { value: "SHIPMENT_NOT_RECEIVED", label: "Shipment Not Received" },
  { value: "SHIPMENT_LOST", label: "Shipment Lost" }, { value: "SHIPMENT_THEFT", label: "Shipment Theft" },
  { value: "SHIPMENT_DAMAGED", label: "Shipment Damaged" },
  { value: "INVOICE_PAYMENT", label: "Invoice or Payment" }, { value: "CREDIT_ACCOUNT", label: "Credit Account" },
  { value: "ACCOUNT_ACCESS", label: "Account Access" }, { value: "TECHNICAL", label: "Technical Issue" },
  { value: "OTHER", label: "Other" }
];

/** Categories about a specific shipment, which therefore require one to be named. */
export const shipmentIssueCategories: TicketCategory[] = [
  "SHIPMENT_DELAYED", "SHIPMENT_NOT_RECEIVED", "SHIPMENT_LOST", "SHIPMENT_THEFT", "SHIPMENT_DAMAGED"
];

export function requiresRelatedShipment(category: TicketCategory) {
  return shipmentIssueCategories.includes(category);
}

/** Statuses in which a ticket still blocks a second ticket for the same shipment. */
export const openTicketStatuses: TicketStatus[] = ["OPEN", "IN_PROGRESS", "WAITING_FOR_CUSTOMER"];

export type SupportTicket = {
  id: string; ticketNumber: string; businessAccountId: string; branchId: string;
  category: TicketCategory; priority: TicketPriority; status: TicketStatus; subject: string;
  relatedShipmentDraftId: string | null; assignedTo: string | null;
  lastMessageAt: string; resolvedAt: string | null; closedAt: string | null; createdAt: string; updatedAt: string;
  // Present only on a resolved ticket loaded with its messages; null otherwise.
  resolvedReplyAllowance: { used: number; max: number } | null;
  account: { id: string; accountId: string; companyName: string } | null;
  branch: { id: string; name: string; code: string } | null;
  creator: { id: string; name: string; email: string } | null;
  assignee: { id: string; name: string; email: string } | null;
  relatedShipment: { draftId: string } | null;
  statusHistory: Array<{ fromStatus: TicketStatus | null; toStatus: TicketStatus; changedBy: string; note: string; changedAt: string }>;
  messages: Array<{ id: string; authorId: string; authorType: "CLIENT" | "ADMIN"; authorName: string; message: string; internal: boolean; createdAt: string }>;
};

export type TicketListInput = { page?: number; limit?: number; status?: string; priority?: string; category?: string; search?: string };

function root(audience: TicketAudience) { return audience === "client" ? "/api/v1/client/support-tickets" : "/api/v1/support-tickets"; }
function json(method: string, body?: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
}
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let token = getAccessToken() ?? await refreshAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response = await fetch(apiUrl(path), { ...init, headers });
  if (response.status === 401) {
    token = await refreshAccessToken();
    if (token) { headers.set("Authorization", `Bearer ${token}`); response = await fetch(apiUrl(path), { ...init, headers }); }
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.message || "Support ticket request failed.");
  return data as T;
}

export function listSupportTickets(audience: TicketAudience, input: TicketListInput = {}) {
  const url = new URL(apiUrl(root(audience)));
  Object.entries(input).forEach(([key, value]) => { if (value !== undefined && value !== "") url.searchParams.set(key, String(value)); });
  return request<{ success: true; tickets: SupportTicket[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(url.pathname + url.search);
}
export function createSupportTicket(input: { businessAccountId: string; category: TicketCategory; subject: string; description: string; relatedShipmentDraftId?: string | null }) {
  return request<{ success: true; ticket: SupportTicket }>(root("client"), json("POST", input));
}
export function getSupportTicket(audience: TicketAudience, ticketId: string) {
  return request<{ success: true; ticket: SupportTicket }>(`${root(audience)}/${ticketId}`);
}
export function replySupportTicket(audience: TicketAudience, ticketId: string, message: string, internal = false) {
  return request<{ success: true; ticket: SupportTicket; message: string }>(`${root(audience)}/${ticketId}/replies`, json("POST", { message, internal }));
}
export function updateSupportTicket(ticketId: string, input: { status?: TicketStatus; priority?: TicketPriority; assignedTo?: string | null; note?: string }) {
  return request<{ success: true; ticket: SupportTicket; message: string }>(`${root("admin")}/${ticketId}`, json("PATCH", input));
}
export function getSupportTicketContext() {
  return request<{ success: true; admins: Array<{ id: string; name: string; email: string }> }>(`${root("admin")}/context`);
}

export function ticketLabel(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}
