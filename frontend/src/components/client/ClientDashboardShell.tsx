"use client";

import { ReactNode, useEffect, useState } from "react";
import { FiArchive, FiBriefcase, FiClipboard, FiCreditCard, FiDollarSign, FiFileText, FiGrid, FiHelpCircle, FiLogOut, FiMessageCircle, FiPackage, FiTruck, FiUser } from "react-icons/fi";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Sidebar, { SidebarNavItem } from "@/components/Sidebar";
import { logout } from "@/lib/auth";
import NotificationBell from "@/components/NotificationBell";
import { getClientDashboard } from "@/lib/clientDashboard";
import { BsWhatsapp,BsCurrencyRupee } from "react-icons/bs";
// import { FaRupeeSign } from "react-icons/fa";

export type ClientShellUser = {
  name?: string;
  email: string;
  role: string;
};

const clientNavigation = [
  { label: "Dashboard", href: "/client/dashboard", icon: FiGrid },
  // { label: "Create Shipment", href: "/client/dpd-labels", icon: FiBriefcase },
  { label: "Shipments", href: "/client/shipments", icon: FiPackage },
  { label: "Get Live Quote", href: "/client/get-quote", icon: FiClipboard, quoteRequest: true },
  { label: "My Quotes", href: "/client/quotes", icon: FiFileText, quote: true },
  { label: "Tracking", href: "/client/tracking", icon: FiTruck },
  { label: "Credit Account", href: "/client/credit", icon: BsCurrencyRupee},

  { label: "Manifests", href: "/client/manifests", icon: FiArchive },
  { label: "Credit Reports", href: "/client/credit/statements", icon: FiFileText, financial: true },
  { label: "Top-up & Payments", href: "/client/payments", icon: FiCreditCard, financial: true },
  { label: "Help-Desk", href: "/client/tickets", icon: FiHelpCircle },

];

export function ClientDashboardShell({
  user,
  children
}: {
  user: ClientShellUser;
  children: ReactNode;
}) {
  const router = useRouter();
  // The permission-gated links depend on an API call, so the whole list stays
  // empty until it settles and every link then appears in one paint.
  const [navigation, setNavigation] = useState<SidebarNavItem[] | null>(null);

  useEffect(() => {
    let active = true;

    function resolve(hasFinancialAccess: boolean, hasQuoteAccess: boolean, canRequestQuote: boolean) {
      if (!active) return;
      setNavigation(clientNavigation.filter((item) => (!item.financial || hasFinancialAccess)
        && (!item.quote || hasQuoteAccess)
        && (!item.quoteRequest || canRequestQuote)));
    }

    void getClientDashboard()
      .then((dashboard) => {
        resolve(
          dashboard.accounts.some((item) =>
            ["account_owner", "account_admin", "finance"].includes(item.membership.role)),
          dashboard.accounts.some((item) =>
            ["account_owner", "account_admin", "operations", "finance"].includes(item.membership.role)),
          dashboard.accounts.some((item) =>
            ["account_owner", "account_admin", "operations"].includes(item.membership.role))
        );
      })
      .catch(() => resolve(false, false, false));

    return () => { active = false; };
  }, []);

  async function handleLogout() {
    await logout();
    router.replace("/");
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#EEEDED]/60">
      <div className="h-1 shrink-0 bg-[#0D1282]" />
      <div className="flex min-h-0 flex-1">
        <Sidebar items={navigation ?? []} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-20 shrink-0 items-center justify-end border-b border-slate-200 bg-white px-8">
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-semibold tracking-wide uppercase text-[#0D1282]">{user.name || user.email}</p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">{user.role}</p>
              </div>
           <div className="group relative">
  <Link
    href="/client/profile"
    // title="My Profile"
    aria-label="My Profile"
    className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-[#0D1282] transition hover:border-[#0D1282] hover:bg-[#0D1282]/5 focus:outline-none focus:ring-2 focus:ring-[#0D1282]/30"
  >
    <FiUser aria-hidden="true" className="h-5 w-5" />
  </Link>

  <div
    className="
      pointer-events-none absolute left-1/2 top-full z-50 mt-2
      -translate-x-1/2 whitespace-nowrap rounded-lg
      bg-slate-900 px-3 py-2 text-xs font-medium text-white
      opacity-0 shadow-xl transition-all duration-200
      group-hover:translate-y-1 group-hover:opacity-100
    "
  >
    My Profile
    <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900" />
  </div>
</div>

<NotificationBell />

<div className="group relative inline-flex">
  <button
    type="button"
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
          <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">{children}</div>
        </main>
      </div>

      <a
        href="https://wa.me/917027606600"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Contact support on WhatsApp"
        className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-3 text-sm font-semibold text-white shadow transition hover:scale-105 hover:bg-[#1ea952]"
      >
        <BsWhatsapp  className="h-5 w-5" />
        <span className="hidden sm:inline"> WhatsApp Support</span>
      </a>
    </div>
  );
}

export function ClientDashboardLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#EEEDED]/60">
      <p className="text-sm font-semibold text-[#0D1282]">Loading client dashboard...</p>
    </div>
  );
}
