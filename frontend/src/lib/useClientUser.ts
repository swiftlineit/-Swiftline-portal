"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiUrl } from "@/lib/api";
import { getAccessToken, logout, refreshAccessToken } from "@/lib/auth";
import type { ClientShellUser } from "@/components/client/ClientDashboardShell";

export function useClientUser() {
  const router = useRouter();
  const [user, setUser] = useState<ClientShellUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        let token = getAccessToken() ?? await refreshAccessToken();
        if (!token) throw new Error("Unauthorized");
        let response = await fetch(apiUrl("/api/v1/auth/me"), { headers: { Authorization: `Bearer ${token}` } });
        if (response.status === 401) {
          token = await refreshAccessToken();
          if (!token) throw new Error("Unauthorized");
          response = await fetch(apiUrl("/api/v1/auth/me"), { headers: { Authorization: `Bearer ${token}` } });
        }
        const data = await response.json();
        if (!data.success || data.user.role !== "client") throw new Error("Unauthorized");
        if (active) setUser(data.user);
      } catch {
        await logout();
        router.replace("/");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [router]);

  return { user, loading };
}
