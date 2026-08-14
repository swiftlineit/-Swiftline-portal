"use client";

import { ReactNode, useCallback, useEffect, useState } from "react";
import {
  FiAlertTriangle,
  FiArchive,
  FiCalendar,
  FiCheckSquare,
  FiClipboard,
  FiCreditCard,
  FiFileText,
  FiGrid,
  FiHelpCircle,
  FiMapPin,
  FiMenu,
  FiShield,
  FiLogOut,
  FiPackage,
  FiPlusSquare,
  FiSearch,
  FiTag,
  FiTruck,
  FiUser,
} from "react-icons/fi";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { IconType } from "react-icons";
import Sidebar, { filterNavigation, type SidebarNavEntry } from "@/components/Sidebar";
import { logout } from "@/lib/auth";
import DeepLinkTarget from "@/components/DeepLinkTarget";
import NotificationBell from "@/components/NotificationBell";
import UnsavedChangesDialog from "@/components/UnsavedChangesDialog";
import RateCardTray from "@/components/rate-cards/RateCardTray";
import GlobalSearch from "@/components/client/GlobalSearch";
import { getClientDashboard } from "@/lib/clientDashboard";
import { BsWhatsapp, BsCurrencyRupee } from "react-icons/bs";
import OperationsCalendarIcon from "@/components/OperationsCalendarIcon";
// import { FaRupeeSign } from "react-icons/fa";

export type ClientShellUser = {
  name?: string;
  email: string;
  role: string;
};

/**
 * Client navigation, grouped by what the customer came to do. `access` names the
 * permission a link waits on; the rest are open to every member of an account.
 */
type ClientAccess = "financial" | "quote" | "quoteRequest" | "booking" | "addressBook";

/**
 * Grouped by the job the customer came to do.
 *
 * Only destinations that exist are listed. The requested structure also names
 * Shipment Templates, Bulk Upload, POD Centre,
 * Customs & KYC, Serviceability and Team Members; those arrive with the pages
 * themselves rather than as links that 404 in the meantime. Exceptions and
 * Action Required join Operations when their pages land.
 */
const clientNavigation: Array<
  | { label: string; href: string; icon: IconType }
  | {
      label: string;
      icon: IconType;
      items: Array<{ label: string; href: string; icon: IconType; access?: ClientAccess }>;
    }
> = [
  { label: "Dashboard", href: "/client/dashboard", icon: FiGrid },
  {
    label: "Shipments",
    icon: FiPackage,
    items: [
      { label: "Create Shipment", href: "/client/dpd-labels", icon: FiPlusSquare, access: "booking" },
      { label: "Address Book", href: "/client/address-book", icon: FiMapPin, access: "addressBook" },
      { label: "My Shipments", href: "/client/shipments", icon: FiPackage },
      { label: "Tracking", href: "/client/tracking", icon: FiMapPin },
    ],
  },
  {
    label: "Operations",
    icon: FiTruck,
    items: [
      { label: "Pickup Management", href: "/client/pickups", icon: FiTruck },
      { label: "Manifests", href: "/client/manifests", icon: FiArchive },
      { label: "POD Centre", href: "/client/pods", icon: FiCheckSquare },
      { label: "Exceptions", href: "/client/exceptions", icon: FiAlertTriangle },
      { label: "Action Required", href: "/client/actions", icon: FiCheckSquare },
    ],
  },
  { label: "Documents & Compliance", href: "/client/documents", icon: FiFileText },
  {
    label: "Quotes & Rates",
    icon: FiClipboard,
    items: [
      { label: "Get Live Quote", href: "/client/get-quote", icon: FiClipboard, access: "quoteRequest" },
      { label: "My Quotes", href: "/client/quotes", icon: FiFileText, access: "quote" },
      { label: "Your Rate Card", href: "/client/rate-card", icon: FiTag },
      { label: "Serviceability Checker", href: "/client/serviceability", icon: FiSearch },
    ],
  },
  {
    label: "Billing",
    icon: BsCurrencyRupee,
    items: [
      { label: "Credit Account", href: "/client/credit", icon: BsCurrencyRupee },
      { label: "Credit Reports", href: "/client/credit/statements", icon: FiFileText, access: "financial" },
      { label: "Top-up & Payments", href: "/client/payments", icon: FiCreditCard, access: "financial" },
    ],
  },
  {
    // Enquiries and compensation are separate journeys with separate rules, so
    // they sit side by side under one heading rather than nested.
    label: "Claims & Support",
    icon: FiShield,
    items: [
      { label: "Claims", href: "/client/claims", icon: FiShield },
      { label: "Help Desk", href: "/client/tickets", icon: FiHelpCircle },
    ],
  },
  {
    label: "Account",
    icon: FiUser,
    items: [
      { label: "My Profile", href: "/client/profile", icon: FiUser },
      { label: "Holiday & Cut-Off Calendar", href: "/client/operations-calendar", icon: FiCalendar },
    ],
  },
];

export function ClientDashboardShell({
  user,
  children,
}: {
  user: ClientShellUser;
  children: ReactNode;
}) {
  const router = useRouter();
  // The permission-gated links depend on an API call, so the whole list stays
  // empty until it settles and every link then appears in one paint.
  const [navigation, setNavigation] = useState<SidebarNavEntry[] | null>(null);
  // Below `lg` the sidebar is an off-canvas drawer; this is what opens it.
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Stable identity: the sidebar holds a media-query listener keyed on it, and
  // a fresh closure each render would rebind that listener each render.
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  // Taken from the dashboard call the navigation already makes, so search costs
  // no extra request. Search stays hidden until it resolves — a box that
  // returns nothing because it does not know the account is worse than none.
  const [searchAccountId, setSearchAccountId] = useState("");

  useEffect(() => {
    let active = true;

    function resolve(
      hasFinancialAccess: boolean,
      hasQuoteAccess: boolean,
      canRequestQuote: boolean,
      canBook: boolean,
      canManageAddresses: boolean,
    ) {
      if (!active) return;

      const granted: Record<ClientAccess, boolean> = {
        financial: hasFinancialAccess,
        quote: hasQuoteAccess,
        quoteRequest: canRequestQuote,
        booking: canBook,
        addressBook: canManageAddresses,
      };

      setNavigation(
        filterNavigation(
          clientNavigation.map((entry) =>
            "items" in entry
              ? {
                  ...entry,
                  items: entry.items.map(({ access, ...item }) => ({
                    ...item,
                    visible: !access || granted[access],
                  })),
                }
              : entry,
          ),
        ),
      );
    }

    void getClientDashboard()
      .then((dashboard) => {
        const searchable = dashboard.accounts.find((item) => item.dashboardAccess.state === "READY")
          ?? dashboard.accounts[0];
        if (active) setSearchAccountId(searchable?.account.id ?? "");

        resolve(
          dashboard.accounts.some((item) =>
            ["account_owner", "account_admin", "finance"].includes(
              item.membership.role,
            ),
          ),
          dashboard.accounts.some((item) =>
            [
              "account_owner",
              "account_admin",
              "operations",
              "finance",
            ].includes(item.membership.role),
          ),
          dashboard.accounts.some(
            (item) =>
              ["account_owner", "account_admin", "operations"].includes(
                item.membership.role,
              ) &&
              item.account.rateCard.assigned &&
              item.dashboardAccess.state === "READY",
          ),
          // Mirrors canCreateShipment: a member who cannot book should not be
          // shown the way to the booking form.
          dashboard.accounts.some(
            (item) =>
              ["account_owner", "account_admin", "operations"].includes(
                item.membership.role,
              ) &&
              item.assignedBranches.length > 0 &&
              item.bookingAccess.state === "READY" &&
              item.dashboardAccess.state === "READY",
          ),
          dashboard.accounts.some(
            (item) =>
              ["account_owner", "account_admin", "operations"].includes(item.membership.role)
              && item.dashboardAccess.state === "READY",
          ),
        );
      })
      .catch(() => resolve(false, false, false, false, false));

    return () => {
      active = false;
    };
  }, []);

  async function handleLogout() {
    await logout();
    router.replace("/");
  }

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#EEEDED]/60">
      <div className="h-1 shrink-0 bg-[#0D1282]" />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          items={navigation ?? []}
          mobileOpen={mobileNavOpen}
          onMobileClose={closeMobileNav}
        />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex h-16 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 lg:h-20 lg:gap-4 lg:px-8">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-[#0D1282] transition hover:border-[#0D1282] hover:bg-[#0D1282]/5 focus:outline-none focus:ring-2 focus:ring-[#0D1282]/30 lg:hidden"
            >
              <FiMenu aria-hidden="true" className="h-5 w-5" />
            </button>

            {/* From `lg` the search bar lives inline; below it moves to its own
                row, where a full-width field is usable on a phone. */}
            <div className="hidden min-w-0 flex-1 lg:block">
              {searchAccountId ? <GlobalSearch businessAccountId={searchAccountId} /> : null}
            </div>
            <div className="min-w-0 flex-1 lg:hidden" />

            <div className="flex shrink-0 items-center gap-2 lg:gap-4">
              {/* The name is the first thing to go when width is short: it is
                  the only item here that is not a control. */}
              <div className="hidden text-right md:block">
                <p className="text-sm font-semibold tracking-wide uppercase text-[#0D1282]">
                  {user.name || user.email}
                </p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                  {user.role}
                </p>
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

              <OperationsCalendarIcon />

              <RateCardTray />

              <NotificationBell />

              <div className="group relative inline-flex">
                <button
                  type="button"
                  onClick={handleLogout}
                  aria-label="Logout"
                  className="inline-flex h-10 items-center gap-2 rounded-4xl bg-[#D71313] px-3 text-sm font-semibold text-white shadow-sm shadow-[#D71313]/25 transition hover:bg-[#b40f0f] focus:outline-none focus:ring-2 focus:ring-[#D71313]/40 focus:ring-offset-2 sm:px-4"
                >
                  <FiLogOut aria-hidden="true" className="h-4 w-4" />
                  <span className="hidden sm:inline">Logout</span>
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

          {/* Below `lg` search gets its own row: sharing the first one with the
              hamburger and five controls would leave it too narrow to read an
              AWB in. */}
          {searchAccountId ? (
            <div className="shrink-0 border-b border-slate-200 bg-white px-4 pb-3 lg:hidden">
              <GlobalSearch businessAccountId={searchAccountId} />
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 [overflow-anchor:none] scrollbar-none [-ms-overflow-style:none] sm:px-6 lg:px-8 lg:py-6 [&::-webkit-scrollbar]:hidden">
            {children}
          </div>
          <DeepLinkTarget />
        </main>
      </div>

      {/* The client shell had no unsaved-work guard at all, so leaving a
          half-filled form discarded it silently. The sidebar it renders is the
          same guarded one the admin shell uses; this supplies the prompt. */}
      <UnsavedChangesDialog />

      <a
        href="https://wa.me/917027606600"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Contact support on WhatsApp"
        // Below the nav drawer (z-50) and its backdrop (z-40), so an open menu
        // covers it instead of leaving it floating over the overlay.
        className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-[#25D366] px-4 py-3 text-sm font-semibold text-white shadow transition hover:scale-105 hover:bg-[#1ea952]"
      >
        <BsWhatsapp className="h-5 w-5" />
        <span className="hidden sm:inline"> WhatsApp Support</span>
      </a>
    </div>
  );
}

export function ClientDashboardLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-[#EEEDED]/60">
      <p className="text-sm font-semibold text-[#0D1282]">
        Loading client dashboard...
      </p>
    </div>
  );
}
