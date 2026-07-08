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
