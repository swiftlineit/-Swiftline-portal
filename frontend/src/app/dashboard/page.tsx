"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FiLogOut } from "react-icons/fi";
import Sidebar from "@/components/Sidebar";
import WelcomeModal from "@/components/WelcomeModal";
import { apiUrl } from "@/lib/api";
import { getAccessToken, refreshAccessToken, logout } from "@/lib/auth";

export default function DashboardPage() {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [user, setUser] = useState<{ name?: string; email: string; role: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      let token = getAccessToken();
      if (!token) {
        token = await refreshAccessToken();
      }

      if (!token) {
        router.replace("/");
        return;
      }

      try {
        const response = await fetch(apiUrl("/api/v1/auth/me"), {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        if (!data.success) {
          throw new Error("Unauthorized");
        }

        setUser(data.user);
        if (!data.user.hasSeenWelcome) {
          setShowModal(true);
        }
      } catch {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          const response = await fetch(apiUrl("/api/v1/auth/me"), {
            headers: { Authorization: `Bearer ${refreshed}` }
          });
          const data = await response.json();
          if (data.success) {
            setUser(data.user);
            if (!data.user.hasSeenWelcome) {
              setShowModal(true);
            }
          } else {
            await logout();
            router.replace("/");
          }
        } else {
          await logout();
          router.replace("/");
        }
      } finally {
        setLoading(false);
      }
    }

    void loadUser();
  }, [router]);

  async function handleClose() {
    setShowModal(false);
    const token = getAccessToken();
    if (!token) return;

    await fetch(apiUrl("/api/v1/auth/welcome-seen"), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    });
  }

  async function handleLogout() {
    await logout();
    router.replace("/");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-8 dark:bg-slate-950">
        <div className="rounded-3xl  p-10 shadow-lg">
          <div className="flex flex-col items-center gap-6">
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 9 }).map((_, i) => (
                <div
                  key={i}
                  className="h-4 w-4 bg-slate-800 dark:bg-slate-200 animate-pulse"
                  style={{
                    animationDelay: `${(i % 3) * 0.15 + Math.floor(i / 3) * 0.15}s`,
                    animationDuration: "1.2s",
                  }}
                />
              ))}
            </div>
            <p className="text-base text-slate-600 dark:text-slate-300">
              Loading dashboard...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 ">
      <div className="flex min-h-screen">
        <Sidebar userRole={user?.role} />

        <main className="flex flex-1 flex-col">
          <header className="flex h-20 items-center justify-end border-b border-slate-200 bg-white px-8 shadow-sm  ">
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-semibold text-slate-900 ">
                  {user?.name || user?.email || "User"}
                </p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500 ">
                  {user?.role || "Role"}
                </p>
              </div>

              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-2  bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/50"
              >
                <FiLogOut aria-hidden="true" className="h-4 w-4" />
                Logout
              </button>
            </div>
          </header>

          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 py-6">
            <h1 className="text-8xl font-semibold text-blue-900">Dashboard</h1>
            <p className="mt-2 text-sm text-slate-600">
              Welcome to the Swiftline Cargo dashboard. Here you can manage your shipments, track deliveries, and access various tools to streamline your logistics operations.
            </p>
          </div>




        </main>
      </div>

      {showModal && <WelcomeModal onClose={handleClose} />}
    </div>
  );
}
