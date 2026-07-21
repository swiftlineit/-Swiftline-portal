"use client";

import { ReactNode } from "react";
import { FiLogOut } from "react-icons/fi";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { AuthenticatedUser } from "@/lib/useAdminUser";
import { logout } from "@/lib/auth";
import NotificationBell from "@/components/NotificationBell";

export default function BusinessAccountsShell({
  user,
  children
}: {
  user: AuthenticatedUser;
  children: ReactNode;
}) {
  const router = useRouter();

  async function handleLogout() {
    await logout();
    router.replace("/");
  }

  return (
    <div className="h-screen overflow-hidden bg-slate-50">
      <div className="flex h-full">
        <Sidebar userRole={user.role} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-20 shrink-0 items-center justify-end border-b border-slate-200 bg-white px-8 shadow-sm">
            <div className="flex items-center gap-4">
              <NotificationBell />
              <div className="text-right">
                <p className="text-sm font-semibold uppercase text-slate-900">{user.name || user.email}</p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">{user.role}</p>
              </div>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-2 bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500/50"
              >
                <FiLogOut aria-hidden="true" className="h-4 w-4" />
                Logout
              </button>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function BusinessAccountsLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <p className="text-sm font-semibold text-slate-500">Loading business accounts...</p>
    </div>
  );
}
