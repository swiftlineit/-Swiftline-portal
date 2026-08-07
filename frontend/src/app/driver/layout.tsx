"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DriverShell from "@/components/driver/DriverShell";
import { apiUrl } from "@/lib/api";
import { getAccessToken, logout, readJsonSafely, refreshAccessToken } from "@/lib/auth";
import { getMyDriverProfile, type Driver } from "@/lib/drivers";

export default function DriverLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [driver, setDriver] = useState<Driver | null>(null);
  const [message, setMessage] = useState("Loading your pickup workspace...");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        let token = getAccessToken() ?? await refreshAccessToken();
        if (!token) throw new Error("SIGNED_OUT");
        let response = await fetch(apiUrl("/api/v1/auth/me"), { headers: { Authorization: `Bearer ${token}` } });
        if (response.status === 401) { token = await refreshAccessToken(); if (!token) throw new Error("SIGNED_OUT"); response = await fetch(apiUrl("/api/v1/auth/me"), { headers: { Authorization: `Bearer ${token}` } }); }
        const payload = await readJsonSafely(response) as { success?: boolean; user?: { role?: string } };
        if (!response.ok || !payload.success || payload.user?.role !== "delivery") throw new Error("SIGNED_OUT");
        const profile = (await getMyDriverProfile()).driver;
        if (active) setDriver(profile);
      } catch (caught) {
        if (!active) return;
        if (caught instanceof Error && caught.message === "SIGNED_OUT") { await logout(); router.replace("/"); return; }
        setMessage(caught instanceof Error ? caught.message : "Your delivery profile could not be loaded.");
      }
    }
    void load();
    return () => { active = false; };
  }, [router]);

  if (!driver) return <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-6 text-center text-sm font-semibold text-[#0D1282]">{message}</div>;
  return <DriverShell name={`${driver.firstName} ${driver.lastName}`.trim()} subrole={driver.deliverySubrole}>{children}</DriverShell>;
}
