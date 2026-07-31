"use client";

import { ReactNode, useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";
import { ClientDashboardShell, type ClientShellUser } from "@/components/client/ClientDashboardShell";

const FALLBACK_USER: ClientShellUser = { email: "", role: "" };

export default function ClientLayout({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ClientShellUser>(FALLBACK_USER);

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
        if (!data.success) throw new Error("Unauthorized");
        if (active) setUser(data.user);
      } catch {
        // Each page runs its own auth check and handles redirect-on-failure;
        // this fetch only fills in the header display, so it fails silently.
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  return <ClientDashboardShell user={user}>{children}</ClientDashboardShell>;
}
