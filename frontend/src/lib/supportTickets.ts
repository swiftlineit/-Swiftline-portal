import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

export type TicketAudience = "client" | "admin";
export type TicketStatus =
  | "OPEN"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "AWAITING_CARRIER"
  | "WAITING_FOR_CUSTOMER"
  | "ACTION_REQUIRED"
  | "RESOLVED"
  | "CLOSED";
export type TicketPriority = "NORMAL" | "URGENT" | "CRITICAL";

/** Mirrors `supportTicketStatusLabels` on the server so both say the same word. */
export const ticketStatusLabels: Record<TicketStatus, string> = {
  OPEN: "Open",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "Under Investigation",
  AWAITING_CARRIER: "Awaiting Carrier",
  WAITING_FOR_CUSTOMER: "Awaiting Customer",
  ACTION_REQUIRED: "Action Required",
  RESOLVED: "Resolved",
  CLOSED: "Closed"
};

export const ticketStatuses = Object.keys(ticketStatusLabels) as TicketStatus[];

export const ticketPriorities: Array<{ value: TicketPriority; label: string }> = [
  { value: "NORMAL", label: "Normal" },
  { value: "URGENT", label: "Urgent" },
  { value: "CRITICAL", label: "Critical" }
];
export type TicketCategory =
  | "TRACKING_ISSUE" | "PICKUP_ISSUE" | "DELIVERY_DELAY" | "CUSTOMS_CLEARANCE"
  | "SHIPMENT_HOLD" | "ADDRESS_CORRECTION" | "BILLING_ISSUE" | "WEIGHT_DISPUTE"
  | "POD_REQUEST" | "LOST_SHIPMENT" | "DAMAGED_SHIPMENT" | "MISSING_CONTENTS"
  | "RETURN_SHIPMENT" | "PORTAL_ISSUE" | "OTHER";

export const ticketCategories: Array<{ value: TicketCategory; label: string }> = [
  { value: "TRACKING_ISSUE", label: "Tracking Issue" },
  { value: "PICKUP_ISSUE", label: "Pickup Issue" },
  { value: "DELIVERY_DELAY", label: "Delivery Delay" },
  { value: "CUSTOMS_CLEARANCE", label: "Customs Clearance" },
  { value: "SHIPMENT_HOLD", label: "Shipment Hold" },
  { value: "ADDRESS_CORRECTION", label: "Address Correction" },
  { value: "BILLING_ISSUE", label: "Billing Issue" },
  { value: "WEIGHT_DISPUTE", label: "Weight Dispute" },
  { value: "POD_REQUEST", label: "POD Request" },
  { value: "LOST_SHIPMENT", label: "Lost Shipment" },
  { value: "DAMAGED_SHIPMENT", label: "Damaged Shipment" },
  { value: "MISSING_CONTENTS", label: "Missing Contents" },
  { value: "RETURN_SHIPMENT", label: "Return Shipment" },
  { value: "PORTAL_ISSUE", label: "Portal Issue" },
  { value: "OTHER", label: "Other" }
];

/** Categories about a specific shipment, which therefore require one to be named. */
export const shipmentIssueCategories: TicketCategory[] = [
  "TRACKING_ISSUE", "DELIVERY_DELAY", "CUSTOMS_CLEARANCE", "SHIPMENT_HOLD",
  "ADDRESS_CORRECTION", "WEIGHT_DISPUTE", "POD_REQUEST", "LOST_SHIPMENT",
  "DAMAGED_SHIPMENT", "MISSING_CONTENTS", "RETURN_SHIPMENT"
];

/**
 * Categories a compensation claim can follow from- narrower than the list
 * above. Needing an AWB and being owed money are different questions: a
 * delivery delay names a shipment but has nothing to compensate.
 */
export const claimableTicketCategories: TicketCategory[] = [
  "LOST_SHIPMENT", "DAMAGED_SHIPMENT", "MISSING_CONTENTS"
];

export function requiresRelatedShipment(category: TicketCategory) {
  return shipmentIssueCategories.includes(category);
}

/** Statuses in which a ticket still blocks a second ticket for the same shipment. */
export const openTicketStatuses: TicketStatus[] = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "AWAITING_CARRIER",
  "WAITING_FOR_CUSTOMER",
  "ACTION_REQUIRED"
];

export type SupportTicket = {
  id: string; ticketNumber: string; businessAccountId: string; branchId: string;
  category: TicketCategory; priority: TicketPriority; status: TicketStatus; subject: string;
  relatedShipmentDraftId: string | null; assignedTo: string | null;
  lastMessageAt: string;
  sla?: {
    firstResponseDueAt: string;
    firstRespondedAt: string | null;
    breached: boolean;
    open: boolean;
    /** Set once Swiftline has actually been alerted, not merely once overdue. */
    escalatedAt?: string | null;
  } | null; resolvedAt: string | null; closedAt: string | null; createdAt: string; updatedAt: string;
  // Present only on a resolved ticket loaded with its messages; null otherwise.
  resolvedReplyAllowance: { used: number; max: number } | null;
  account: { id: string; accountId: string; companyName: string } | null;
  branch: { id: string; name: string; code: string } | null;
  creator: { id: string; name: string; email: string } | null;
  assignee: { id: string; name: string; email: string } | null;
  relatedShipment: {
    draftId: string;
    awb: string;
    origin: string;
    destination: string;
    consignee: string;
    bookedAt: string | null;
    statusLabel: string;
    lastScan: { statusLabel: string; location: string; at: string } | null;
    service: string;
  } | null;
  statusHistory: Array<{ fromStatus: TicketStatus | null; toStatus: TicketStatus; changedBy: string; note: string; changedAt: string }>;
  messages: Array<{ id: string; authorId: string; authorType: "CLIENT" | "ADMIN"; authorName: string; message: string; internal: boolean; createdAt: string }>;
};

export type TicketListInput = { page?: number; limit?: number; status?: string; priority?: string; category?: string; search?: string; branchId?: string };

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

/** The list endpoint for an audience, so an export can target the same one. */
export function ticketListPath(audience: TicketAudience) {
  return root(audience);
}

/**
 * Query string for a ticket list request.
 *
 * Shared with the export so a downloaded file carries the filters on screen.
 * Paging keys are dropped: an export is of the whole filtered set, and sending
 * `page` would only invite the server to honour it one day.
 */
export function ticketListParams(input: TicketListInput = {}) {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (key === "page" || key === "limit") return;
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  return params;
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
