"use client";

import { ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { FiBriefcase, FiChevronLeft, FiChevronRight, FiClipboard, FiCreditCard, FiDollarSign, FiFileText, FiGrid, FiHelpCircle, FiLogOut, FiTruck } from "react-icons/fi";
import { usePathname, useRouter } from "next/navigation";
import { logout } from "@/lib/auth";
import NotificationBell from "@/components/NotificationBell";
import { getClientDashboard } from "@/lib/clientDashboard";

export type ClientShellUser = {
  name?: string;
  email: string;
  role: string;
};

export function ClientDashboardShell({
  user,
  children
}: {
  user: ClientShellUser;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [hasFinancialAccess, setHasFinancialAccess] = useState(false);
  const [hasQuoteAccess, setHasQuoteAccess] = useState(false);
  const [canRequestQuote, setCanRequestQuote] = useState(false);

  useEffect(() => {
    let active = true;
    void getClientDashboard()
      .then((dashboard) => {
        if (!active) return;
        setHasFinancialAccess(dashboard.accounts.some((item) =>
          ["account_owner", "account_admin", "finance"].includes(item.membership.role)
        ));
        setHasQuoteAccess(dashboard.accounts.some((item) =>
          ["account_owner", "account_admin", "operations", "finance"].includes(item.membership.role)
        ));
        setCanRequestQuote(dashboard.accounts.some((item) =>
          ["account_owner", "account_admin", "operations"].includes(item.membership.role)
        ));
      })
      .catch(() => {
        if (active) {
          setHasFinancialAccess(false);
          setHasQuoteAccess(false);
          setCanRequestQuote(false);
        }
      });
    return () => { active = false; };
  }, []);

  const navigation = [
    { label: "Dashboard", href: "/client/dashboard", icon: FiGrid },
    { label: "Create Shipment", href: "/client/dpd-labels", icon: FiBriefcase },
    { label: "Get Quote", href: "/client/get-quote", icon: FiClipboard, quoteRequest: true },
    { label: "My Quotes", href: "/client/quotes", icon: FiFileText, quote: true },
    { label: "Tracking", href: "/client/tracking", icon: FiTruck },
    { label: "Support Tickets", href: "/client/tickets", icon: FiHelpCircle },
    { label: "Credit Account", href: "/client/credit", icon: FiDollarSign },
    { label: "Credit Statements", href: "/client/credit/statements", icon: FiFileText, financial: true },
    { label: "Payments", href: "/client/payments", icon: FiCreditCard, financial: true }
  ].filter((item) => (!item.financial || hasFinancialAccess)
    && (!item.quote || hasQuoteAccess)
    && (!item.quoteRequest || canRequestQuote));

  async function handleLogout() {
    await logout();
    router.replace("/");
  }

  return (
    <div className="h-screen overflow-hidden bg-slate-50">
      <div className="flex h-full">
        <aside className={`flex h-full shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white shadow-sm transition-all duration-300 ${sidebarOpen ? "w-56" : "w-20"}`}>
          <div className={`flex h-20 shrink-0 items-center border-b border-slate-200 px-3 ${sidebarOpen ? "justify-between gap-3" : "justify-center"}`}>
            {sidebarOpen ? (
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center bg-blue-900 text-sm font-bold text-white">
                  SL
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-950">Swiftline</p>
                  <p className="truncate text-xs font-medium text-slate-500">Client Portal</p>
                </div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setSidebarOpen((current) => !current)}
              aria-label={sidebarOpen ? "Collapse sidebar" : "Open sidebar"}
              className="flex h-8 w-8 shrink-0 items-center justify-center border border-slate-200 text-blue-700 transition hover:border-blue-200 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-300/60"
            >
              {sidebarOpen ? <FiChevronLeft aria-hidden="true" /> : <FiChevronRight aria-hidden="true" />}
            </button>
          </div>
          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-6">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={sidebarOpen ? undefined : item.label}
                  className={`flex h-11 items-center text-sm font-semibold hover:text-blue-900 ${active ? "text-blue-900" : "text-slate-700"} ${sidebarOpen ? "gap-3 px-2" : "justify-center"}`}
                >
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                  {sidebarOpen ? item.label : null}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-20 shrink-0 items-center justify-end border-b border-slate-200 bg-white px-8 shadow-sm">
            <div className="flex items-center gap-4">
              <NotificationBell />
              <div className="text-right">
                <p className="text-sm font-semibold text-slate-900">{user.name || user.email}</p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">{user.role}</p>
              </div>
              <button
                type="button"
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

export function ClientDashboardLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <p className="text-sm font-semibold text-slate-500">Loading client dashboard...</p>
    </div>
  );
}
