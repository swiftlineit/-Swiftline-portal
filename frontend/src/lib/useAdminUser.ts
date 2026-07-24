"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiUrl } from "@/lib/api";
import { getAccessToken, logout, readJsonSafely, refreshAccessToken } from "@/lib/auth";

export type AuthenticatedUser = {
  name?: string;
  email: string;
  role: "admin" | "operations" | "accounts" | "delivery" | "hr" | "client";
  hasSeenWelcome?: boolean;
};

function signInWithReturnPath() {
  const current = `${window.location.pathname}${window.location.search}`;
  return current === "/" ? "/" : `/?next=${encodeURIComponent(current)}`;
}

export function useAdminUser(allowInternalStaff = false) {
  const router = useRouter();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // "retry" covers throttling, server faults, and dropped connections. Those must
    // never end a signed-in shift, so only a rejected identity clears the session.
    async function attempt(): Promise<"done" | "signed-out" | "retry"> {
      let token = getAccessToken() ?? await refreshAccessToken();
      if (!token) return "signed-out";

      let response = await fetch(apiUrl("/api/v1/auth/me"), {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.status === 401) {
        token = await refreshAccessToken();
        if (!token) return "signed-out";
        response = await fetch(apiUrl("/api/v1/auth/me"), {
          headers: { Authorization: `Bearer ${token}` }
        });
      }

      if (response.status === 401 || response.status === 403) return "signed-out";

      const data = await readJsonSafely(response) as { success?: boolean; user?: AuthenticatedUser };
      if (!response.ok || !data.success || !data.user) return "retry";

      if (data.user.role !== "admin" && !(allowInternalStaff && data.user.role === "operations")) {
        setForbidden(true);
        router.replace("/dashboard");
        return "done";
      }

      setUser(data.user);
      return "done";
    }

    async function loadUser() {
      for (let remaining = 2; remaining > 0; remaining -= 1) {
        try {
          const outcome = await attempt();
          if (outcome === "done") {
            setLoading(false);
            return;
          }
          if (outcome === "signed-out") {
            await logout();
            router.replace(signInWithReturnPath());
            return;
          }
        } catch {
          // Fall through to the retry below.
        }
        if (remaining > 1) await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }

      setError("Your session could not be confirmed. Check your connection and reload the page.");
      setLoading(false);
    }

    void loadUser();
  }, [allowInternalStaff, router]);

  return { user, loading, forbidden, error };
}
