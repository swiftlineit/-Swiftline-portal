import { apiUrl } from "@/lib/api";

let accessToken: string | null = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export async function refreshAccessToken() {
  try {
    const response = await fetch(apiUrl("/api/v1/auth/refresh"), {
      method: "POST",
      credentials: "include"
    });

    const data = await response.json();
    if (data.success && data.accessToken) {
      setAccessToken(data.accessToken);
      return data.accessToken;
    }

    setAccessToken(null);
    return null;
  } catch {
    setAccessToken(null);
    return null;
  }
}

export async function logout() {
  try {
    await fetch(apiUrl("/api/v1/auth/logout"), {
      method: "POST",
      credentials: "include"
    });
  } catch {
    // ignore network failures during logout
  } finally {
    setAccessToken(null);
  }
}

async function parseAuthResponse<T>(response: Response): Promise<T> {
  const data = await response.json();

  if (!response.ok || !data.success) {
    const formattedError = findFirstApiError(data.errors);
    throw new Error(data.message || formattedError || "Authentication request failed");
  }

  return data as T;
}

function findFirstApiError(value: unknown): string {
  if (!value || typeof value !== "object") return "";

  const errors = (value as { _errors?: unknown })._errors;
  if (Array.isArray(errors) && typeof errors[0] === "string") return errors[0];

  for (const nested of Object.values(value)) {
    const message = findFirstApiError(nested);
    if (message) return message;
  }

  return "";
}

export async function getInvitation(token: string) {
  const response = await fetch(apiUrl(`/api/v1/auth/invitations/${encodeURIComponent(token)}`));

  return parseAuthResponse<{
    success: true;
    invitation: {
      email: string;
      name: string;
      businessAccountId: string;
      companyName: string;
      expiresAt: string;
    };
  }>(response);
}

export async function activateInvitation(input: {
  token: string;
  password: string;
  confirmPassword: string;
  termsAccepted: boolean;
}) {
  const response = await fetch(apiUrl("/api/v1/auth/activate-invitation"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseAuthResponse<{ success: true; message: string }>(response);
}

export async function requestPasswordReset(email: string) {
  const response = await fetch(apiUrl("/api/v1/auth/forgot-password"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  });

  return parseAuthResponse<{ success: true; message: string }>(response);
}

export async function resetPassword(input: {
  token: string;
  password: string;
  confirmPassword: string;
}) {
  const response = await fetch(apiUrl("/api/v1/auth/reset-password"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseAuthResponse<{ success: true; message: string }>(response);
}
