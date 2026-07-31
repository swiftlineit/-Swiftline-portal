import { apiUrl } from "@/lib/api";

let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;

export function getAccessToken() {
  return accessToken;
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export async function readJsonSafely(response: Response): Promise<Record<string, unknown>> {
  // Rate limiters and proxies answer with plain text or HTML. Callers must never
  // let that parse failure look like a rejected session.
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function requestRefreshedAccessToken() {
  try {
    const response = await fetch(apiUrl("/api/v1/auth/refresh"), {
      method: "POST",
      credentials: "include"
    });

    const data = await readJsonSafely(response);
    if (response.ok && data.success && typeof data.accessToken === "string") {
      setAccessToken(data.accessToken);
      return data.accessToken;
    }

    // Only a rejected refresh cookie means the session is gone. Throttling,
    // server faults, and offline devices must keep the current token usable.
    if (response.status === 401 || response.status === 403) setAccessToken(null);
    return null;
  } catch {
    return null;
  }
}

export async function refreshAccessToken() {
  // A dashboard page mount can trigger several parallel refreshes. Sharing one
  // request stops them rotating the cookie against each other.
  refreshInFlight ??= requestRefreshedAccessToken().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
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
  const data = await readJsonSafely(response) as { success?: boolean; message?: string; errors?: unknown };

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

export type LoginResult = {
  success: true;
  accessToken: string;
  user: { id: string; email: string; role: string; name?: string; userStatus: string; hasSeenWelcome: boolean };
};

/** Exchanges a Google Identity Services ID token for the portal's own access/refresh tokens. */
export async function loginWithGoogle(credential: string) {
  const response = await fetch(apiUrl("/api/v1/auth/login/google"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ credential })
  });

  return parseAuthResponse<LoginResult>(response);
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
