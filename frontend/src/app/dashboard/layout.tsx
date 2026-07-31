"use client";

import { ReactNode, useEffect, useState } from "react";
import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken } from "@/lib/auth";
import DashboardShell from "@/components/DashboardShell";
import { type AuthenticatedUser } from "@/lib/useAdminUser";

// Empty role renders no sidebar nav items (Sidebar filters by
// `roles.includes(userRole)`) rather than crashing or over-privileging while
// the real role loads in the background.
const FALLBACK_USER: AuthenticatedUser = { email: "", role: "" as AuthenticatedUser["role"] };

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthenticatedUser>(FALLBACK_USER);

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
        // Each page runs its own useAdminUser() check and handles redirect-on-failure;
        // this fetch only fills in the header/sidebar display, so it fails silently.
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  return <DashboardShell user={user}>{children}</DashboardShell>;
}
