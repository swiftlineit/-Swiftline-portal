import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";
// Re-exported below so existing "@/lib/users" imports keep working while
// `@/lib/roles` stays the one place roles are defined.
import type { PortalRole } from "@/lib/roles";

export type UserStatus = "invited" | "active" | "suspended" | "disabled";
export { portalRoles, staffRoles, roleLabels, type PortalRole, type StaffRole } from "@/lib/roles";
export type UserBranch = { _id?: string; id?: string; name: string; code: string; status?: string };

export const staffDocumentTypes = ["aadhaar", "pan", "other"] as const;
export type StaffDocumentType = (typeof staffDocumentTypes)[number];

/** Metadata only — the bytes come from the document endpoint. */
export type StaffDocumentSummary = {
  type: StaffDocumentType;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

export type StaffProfile = {
  employeeCode: string;
  designation: string;
  dateOfJoining: string | null;
  dateOfBirth: string | null;
  /** Masked by the API as "XXXX XXXX 1234"; the full number never leaves the server. */
  aadhaarNumber: string;
  panNumber: string;
  address: { line1: string; city: string; state: string; postalCode: string };
  emergencyContact: { name: string; phone: string };
  documents: Record<StaffDocumentType, StaffDocumentSummary | null>;
};

export type User = {
  _id: string;
  email: string;
  role: PortalRole;
  assignedBranches: UserBranch[];
  name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  isVerified: boolean;
  userStatus?: UserStatus;
  hasSeenWelcome?: boolean;
  lockedUntil?: string | null;
  lastLogin?: string | null;
  createdAt?: string | null;
  /** Present on internal staff added through the Add Staff form. */
  staffProfile?: StaffProfile | null;
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

/**
 * Creates an internal staff member.
 *
 * The body is multipart because it carries the KYC documents, so no
 * Content-Type is set here — the browser adds it along with the boundary.
 */
export async function createStaff(form: FormData) {
  const response = await fetchWithAuth(apiUrl("/api/v1/users/staff"), {
    method: "POST",
    body: form
  });

  return parseApiResponse<{ success: true; message?: string; user: User }>(response);
}

export async function getStaffUser(userId: string) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/users/${encodeURIComponent(userId)}`));
  return parseApiResponse<{ success: true; user: User }>(response);
}

/** Partial update: only the keys present in `form` are written. */
export async function updateStaffUser(userId: string, form: FormData) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/users/${encodeURIComponent(userId)}/staff`), {
    method: "PATCH",
    body: form
  });

  return parseApiResponse<{ success: true; message?: string; user: User }>(response);
}

// Staff documents are private and the endpoint needs a Bearer token, which a
// plain <a href> cannot send, so the bytes are fetched with auth and handed to
// the browser as an object URL. Callers own the URL and must revoke it.
export async function fetchStaffDocumentObjectUrl(
  userId: string,
  documentType: StaffDocumentType,
  mode: "preview" | "download" = "preview"
) {
  const response = await fetchWithAuth(
    apiUrl(`/api/v1/users/${encodeURIComponent(userId)}/documents/${documentType}${mode === "download" ? "?download=1" : ""}`)
  );
  if (!response.ok) throw new Error("Unable to load the document.");

  return URL.createObjectURL(await response.blob());
}

/** Fetches the document with auth, then saves it under its original file name. */
export async function downloadStaffDocument(
  userId: string,
  documentType: StaffDocumentType,
  fileName: string
) {
  const objectUrl = await fetchStaffDocumentObjectUrl(userId, documentType, "download");
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export async function updateUserAccess(userId: string, role: PortalRole, assignedBranches: string[]) {
  const response = await fetchWithAuth(apiUrl(`/api/v1/users/${encodeURIComponent(userId)}/access`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, assignedBranches })
  });
  return parseApiResponse<{ success: true; user: User }>(response);
}
