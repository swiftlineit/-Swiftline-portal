"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { FiLogOut, FiUser } from "react-icons/fi";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import UnsavedChangesDialog from "@/components/UnsavedChangesDialog";
import { AuthenticatedUser } from "@/lib/useAdminUser";
import { logout } from "@/lib/auth";
import DeepLinkTarget from "@/components/DeepLinkTarget";
import NotificationBell from "@/components/NotificationBell";
import GlobalSearch from "@/components/client/GlobalSearch";
import OperationsCalendarIcon from "@/components/OperationsCalendarIcon";
import { loadProfileImageUrl } from "@/lib/profile";

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
  const pathname = usePathname();
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const [profileImageUrl, setProfileImageUrl] = useState("");
  const initials = (user.name ?? "").trim().split(/\s+/).filter(Boolean);
  const fallbackInitials = initials.length
    ? `${initials[0][0] ?? ""}${initials.length > 1 ? initials[initials.length - 1][0] ?? "" : ""}`.toUpperCase()
    : "";

  useEffect(() => {
    let objectUrl = "";
    let active = true;

    async function refreshProfileImage() {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = "";
      try {
        const url = await loadProfileImageUrl();
        objectUrl = url;
        if (active) setProfileImageUrl(url);
      } catch {
        if (active) setProfileImageUrl("");
      }
    }

    void refreshProfileImage();
    window.addEventListener("profile-image-updated", refreshProfileImage);
    return () => {
      active = false;
      window.removeEventListener("profile-image-updated", refreshProfileImage);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  // The dashboard uses an inner scroll container. Reset it on route changes so
  // a previously scrolled detail screen cannot hide the next page's heading.
  useEffect(() => {
    contentScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    document
      .querySelector<HTMLElement>("[data-dashboard-sidebar-scroll]")
      ?.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);

  async function handleLogout() {
    await logout();
    router.replace("/");
  }

  return (
    <div className="fixed inset-0 flex h-dvh max-h-dvh flex-col overflow-hidden overscroll-none bg-[#EEEDED]/60">
      <div className="h-1 shrink-0 bg-[#0D1282]" />
      <div className="flex min-h-0 flex-1">
        <Sidebar userRole={user.role} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-20 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-8">
            {/* Staff search spans every account this user may see. */}
            <div className="hidden min-w-0 flex-1 lg:block">
              <GlobalSearch audience="staff" />
            </div>
            <div className="min-w-0 flex-1 lg:hidden" />
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
                  {profileImageUrl ? (
                    <Image src={profileImageUrl} alt={`${user.name || "User"} profile`} width={40} height={40} unoptimized className="h-full w-full rounded-full object-cover" />
                  ) : fallbackInitials ? (
                    <span className="text-xs font-bold tracking-wide">{fallbackInitials}</span>
                  ) : (
                    <FiUser aria-hidden="true" className="h-5 w-5" />
                  )}
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
              <OperationsCalendarIcon variant="staff" />
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
          <div
            ref={contentScrollRef}
            data-dashboard-scroll
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 [overflow-anchor:none] scrollbar-none [-ms-overflow-style:none] sm:px-8 sm:py-6 [&::-webkit-scrollbar]:hidden"
          >
            {children}
          </div>
          <DeepLinkTarget />
        </main>
      </div>

      {/* One instance per shell: the prompt is driven by a module-level registry
          that any open form writes to, so it must not be mounted per page. */}
      <UnsavedChangesDialog />
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
