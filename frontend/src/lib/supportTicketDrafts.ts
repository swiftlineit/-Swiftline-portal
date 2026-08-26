import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";
import type { TicketCategory } from "@/lib/supportTickets";

export type SupportTicketDraft = {
  id: string;
  businessAccountId: string;
  branchId: string | null;
  category: TicketCategory;
  subject: string;
  description: string;
  relatedShipmentDraftId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let token = getAccessToken() ?? (await refreshAccessToken());
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response = await fetch(apiUrl(path), { ...init, headers });
  if (response.status === 401) {
    token = await refreshAccessToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
      response = await fetch(apiUrl(path), { ...init, headers });
    }
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) throw new Error(data.message || "Ticket draft request failed.");
  return data as T;
}

export async function listTicketDrafts() {
  const result = await request<{ success: true; drafts: SupportTicketDraft[] }>("/api/v1/client/support-ticket-drafts");
  return result.drafts;
}

export async function getTicketDraft(draftId: string) {
  const result = await request<{ success: true; draft: SupportTicketDraft }>(`/api/v1/client/support-ticket-drafts/${draftId}`);
  return result.draft;
}

export async function createTicketDraft(input: {
  businessAccountId: string;
  category?: TicketCategory;
  subject?: string;
  description?: string;
  relatedShipmentDraftId?: string | null;
}) {
  const result = await request<{ success: true; draft: SupportTicketDraft }>("/api/v1/client/support-ticket-drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return result.draft;
}

export async function saveTicketDraft(
  draftId: string,
  input: {
    businessAccountId: string;
    category?: TicketCategory;
    subject?: string;
    description?: string;
    relatedShipmentDraftId?: string | null;
    version: number;
  }
) {
  const result = await request<{ success: true; draft: SupportTicketDraft }>(`/api/v1/client/support-ticket-drafts/${draftId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return result.draft;
}

export async function deleteTicketDraft(draftId: string) {
  return request<{ success: true; message: string }>(`/api/v1/client/support-ticket-drafts/${draftId}`, { method: "DELETE" });
}

export async function submitTicketDraft(draftId: string) {
  return request<{ success: true; ticket: { id: string; ticketNumber: string }; message: string }>(
    `/api/v1/client/support-ticket-drafts/${draftId}/submit`,
    { method: "POST" }
  );
}
