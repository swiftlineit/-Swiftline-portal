import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

/**
 * Client login requests raised by a business account administrator.
 *
 * Approving one creates a real portal login, which is why these are
 * admin-only and why the request sits waiting rather than the customer being
 * able to grant access themselves.
 */
export type ClientAccessRequest = {
  id: string;
  businessAccountId: string;
  accountName: string;
  accountCode: string;
  branchName: string;
  branchCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: string;
  roleLabel: string;
  requestedByName: string;
  requestedAt: string;
};

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
  if (!response.ok || !data.success) throw new Error(data.message || "That did not work.");
  return data as T;
}

export function listClientAccessRequests() {
  return request<{ success: true; requests: ClientAccessRequest[] }>("/api/v1/users/access-requests");
}

/** Returns the details needed to create the login on the existing flow. */
export function beginClientAccessApproval(requestId: string) {
  return request<{
    success: true;
    accountId: string;
    invite: { firstName: string; lastName: string; email: string; phone: string; role: string };
  }>(`/api/v1/users/access-requests/${requestId}/approve`, { method: "POST" });
}

/** Called once the login has actually been created, to clear the request. */
export function completeClientAccessApproval(requestId: string) {
  return request<{ success: true; message: string }>(
    `/api/v1/users/access-requests/${requestId}/complete`,
    { method: "POST" }
  );
}

export function declineClientAccessRequest(requestId: string, reason: string) {
  return request<{ success: true; message: string }>(
    `/api/v1/users/access-requests/${requestId}/decline`,
    { method: "POST", body: JSON.stringify({ reason }) }
  );
}
