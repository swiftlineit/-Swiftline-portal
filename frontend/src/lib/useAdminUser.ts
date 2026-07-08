"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiUrl } from "@/lib/api";
import { getAccessToken, logout, refreshAccessToken } from "@/lib/auth";

export type AuthenticatedUser = {
  name?: string;
  email: string;
  role: "admin" | "staff" | "client";
  hasSeenWelcome?: boolean;
};

export function useAdminUser() {
  const router = useRouter();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    async function loadUser() {
      let token = getAccessToken();
      if (!token) token = await refreshAccessToken();

      if (!token) {
        router.replace("/");
        return;
      }

      try {
        const response = await fetch(apiUrl("/api/v1/auth/me"), {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();

        if (!data.success) throw new Error("Unauthorized");

        if (data.user.role !== "admin") {
          setForbidden(true);
          router.replace("/dashboard");
          return;
        }

        setUser(data.user);
      } catch {
        await logout();
        router.replace("/");
      } finally {
        setLoading(false);
      }
    }

    void loadUser();
  }, [router]);

  return { user, loading, forbidden };
}
