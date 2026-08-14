import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";

export type TeamMember = {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  roleLabel: string;
  status: string;
  branches: string[];
  requestedAt: string | null;
  joinedAt: string | null;
};

export type TeamRole = { value: string; label: string };

/** How each membership state reads, and how loudly. */
export const teamStatusLabels: Record<string, { label: string; tone: string }> = {
  pending_approval: { label: "Awaiting Swiftline", tone: "border-amber-200 bg-amber-50 text-amber-800" },
  invited: { label: "Invited", tone: "border-blue-200 bg-blue-50 text-blue-800" },
  active: { label: "Active", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  suspended: { label: "Suspended", tone: "border-slate-300 bg-slate-100 text-slate-700" },
  declined: { label: "Declined", tone: "border-red-200 bg-red-50 text-red-700" }
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

export function listClientTeam() {
  return request<{ success: true; members: TeamMember[]; roles: TeamRole[] }>("/api/v1/client/team");
}

export function requestTeamInvite(input: {
  firstName: string; lastName: string; email: string; phone: string; role: string;
}) {
  return request<{ success: true; message: string }>("/api/v1/client/team/invites", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateTeamMemberRole(memberId: string, role: string) {
  return request<{ success: true; message: string }>(`/api/v1/client/team/${memberId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role })
  });
}
