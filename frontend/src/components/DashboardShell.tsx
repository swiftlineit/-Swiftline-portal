"use client";

import { ReactNode } from "react";
import { FiLogOut, FiUser } from "react-icons/fi";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { AuthenticatedUser } from "@/lib/useAdminUser";
import { logout } from "@/lib/auth";
import DeepLinkTarget from "@/components/DeepLinkTarget";
import NotificationBell from "@/components/NotificationBell";

// Shared chrome for every authenticated dashboard page: sidebar, header, and
// scrollable content area.
export default function DashboardShell({
  user,
  children,
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
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#EEEDED]/60">
      <div className="h-1 shrink-0 bg-[#0D1282]" />
      <div className="flex min-h-0 flex-1">
        <Sidebar userRole={user.role} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-20 shrink-0 items-center justify-end border-b border-slate-200 bg-white px-8">
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-semibold tracking-wide uppercase text-[#0D1282]">
                  {user.name || user.email}
                </p>
                <p className="mt-1 text-xs  uppercase tracking-wide text-slate-500 text-semibold">
                  {user.role} (<span className="text-blue-900">s</span>L
                  <span className="text-red-600">C</span>){" "}
                </p>
              </div>
              <div className="group relative">
                <Link
                  href="/dashboard/profile"
                  // title="My Profile"
                  aria-label="My Profile"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-[#0D1282] transition hover:border-[#0D1282] hover:bg-[#0D1282]/5 focus:outline-none focus:ring-2 focus:ring-[#0D1282]/30"
                >
                  <FiUser aria-hidden="true" className="h-5 w-5" />
                </Link>

                <div
                  className="pointer-events-none absolute left-1/2 top-full z-50 mt-2
                            -translate-x-1/2 whitespace-nowrap rounded-lg
                            bg-slate-900 px-3 py-2 text-xs font-medium text-white
                            opacity-0 shadow-xl transition-all duration-200
                            group-hover:translate-y-1 group-hover:opacity-100"
                >
                  My Profile
                  <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900" />
                </div>
              </div>
              <NotificationBell />
              <div className="group relative inline-flex">
                <button
                  onClick={handleLogout}
                  className="inline-flex items-center gap-2 rounded-4xl bg-[#D71313] px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#D71313]/25 transition hover:bg-[#b40f0f] focus:outline-none focus:ring-2 focus:ring-[#D71313]/40 focus:ring-offset-2"
                >
                  <FiLogOut aria-hidden="true" className="h-4 w-4" />
                  Logout
                </button>

                <div
                  className="
      pointer-events-none absolute left-1/2 top-full z-50 mt-2
      -translate-x-1/2 whitespace-nowrap rounded-lg
      bg-slate-900 px-3 py-2 text-xs font-medium text-white
      opacity-0 shadow-xl transition-all duration-200
      group-hover:translate-y-1 group-hover:opacity-100
    "
                >
                  Sign out of your account
                  <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900" />
                </div>
              </div>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6 scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {children}
          </div>
          <DeepLinkTarget />
        </main>
      </div>
    </div>
  );
}

export function DashboardLoading({
  message = "Loading...",
}: {
  message?: string;
}) {
  // Fills the shell's content area. `min-h-screen` here was a full viewport
  // inside an area already shorter than one, which overflowed the scroller.
  return (
    <div className="flex h-full items-center justify-center bg-[#EEEDED]/60">
      <p className="text-sm font-semibold text-[#0D1282]">{message}</p>
    </div>
  );
}
