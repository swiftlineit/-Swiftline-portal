import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

export type UserStatus = "invited" | "active" | "suspended" | "disabled";
export const portalRoles = ["admin", "operations", "accounts", "delivery", "hr", "client"] as const;
export type PortalRole = (typeof portalRoles)[number];
export type UserBranch = { _id?: string; id?: string; name: string; code: string; status?: string };

export type User = {
  _id: string;
  email: string;
  role: PortalRole;
  assignedBranches: UserBranch[];
  name?: string;
  isVerified: boolean;
  userStatus?: UserStatus;
  hasSeenWelcome?: boolean;
  lockedUntil?: string | null;
};

async function fetchWithAuth(input: string, init: RequestInit = {}) {
  const token = getAccessToken() ?? await refreshAccessToken();
  const response = await fetch(input, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });

  if (response.status !== 401) return response;

  const refreshedToken = await refreshAccessToken();
  if (!refreshedToken) return response;

  return fetch(input, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${refreshedToken}`
    }
  });
}

function findFirstApiError(value: unknown): string {
  if (!value || typeof value !== "object") return "";

  const errors = (value as { _errors?: unknown })._errors;
  if (Array.isArray(errors) && typeof errors[0] === "string") return errors[0];

  return Object.values(value as Record<string, unknown>)
    .map(findFirstApiError)
    .find(Boolean) || "";
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok || !data.success) {
    const formattedError = findFirstApiError(data.errors);
    throw new Error(data.message || formattedError || "Request failed");
  }
  return data as T;
}

export async function listUsers() {
  const response = await fetchWithAuth(apiUrl("/api/v1/users"));
  return parseApiResponse<{ success: true; users: User[] }>(response);
}

export async function listUserBranchOptions() {
  const response = await fetchWithAuth(apiUrl("/api/v1/users/branches/options"));
  return parseApiResponse<{ success: true; branches: Array<{ id: string; name: string; code: string }> }>(response);
}

export async function updateUserStatus(userId: string, status: User["userStatus"]) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/users/${encodeURIComponent(userId)}/status`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });

  return parseApiResponse<{ success: true; user: User }>(response);
}

export async function updateUserAccess(userId: string, role: PortalRole, assignedBranches: string[]) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/users/${encodeURIComponent(userId)}/access`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, assignedBranches })
  });
  return parseApiResponse<{ success: true; user: User }>(response);
}
