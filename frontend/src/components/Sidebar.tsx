"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useGuardedNavigate } from "@/lib/useUnsavedChanges";
import { usePathname } from "next/navigation";
import type { IconType } from "react-icons";
import {
  FiAlertOctagon,
  FiArchive,
  FiBriefcase,
  FiChevronDown,
  FiChevronLeft,
  FiChevronRight,
  FiClipboard,
  FiCreditCard,
  FiEdit3,
  FiFileText,
  FiGlobe,
  FiGrid,
  FiHelpCircle,
  FiShield,
  FiMapPin,
  FiPackage,
  FiSettings,
  FiTruck,
  FiUsers,
  FiXCircle,
} from "react-icons/fi";
import { BsCurrencyRupee } from "react-icons/bs";
import {
  ALL_STAFF_AREA,
  BRANCH_VIEW_AREA,
  BUSINESS_ACCOUNT_AREA,
  COUNTER_SALES_AREA,
  CREDIT_VIEW_AREA,
  RATE_CARD_AREA,
  CLAIMS_AREA,
  OPERATIONS_AREA,
  SHIPMENT_VIEW_AREA,
  STAFF_DIRECTORY_AREA,
  withAdmin
} from "@/lib/roles";

/** A destination. `visible` gates it on a role or a permission the caller resolves. */
export type SidebarNavItem = {
  label: string;
  href: string;
  icon: IconType;
  visible?: boolean;
};

/** A collapsible heading. It disappears when none of its children are visible. */
export type SidebarNavGroup = {
  label: string;
  icon: IconType;
  items: SidebarNavItem[];
};

export type SidebarNavEntry = SidebarNavItem | SidebarNavGroup;

function isGroup(entry: SidebarNavEntry): entry is SidebarNavGroup {
  return "items" in entry;
}

/**
 * Drops the links a user may not see, then any group left with nothing in it.
 * Items without a `visible` flag are always shown.
 */
export function filterNavigation(entries: SidebarNavEntry[]): SidebarNavEntry[] {
  return entries.flatMap<SidebarNavEntry>((entry) => {
    if (!isGroup(entry)) return entry.visible === false ? [] : [entry];

    const items = entry.items.filter((item) => item.visible !== false);
    return items.length ? [{ ...entry, items }] : [];
  });
}

/**
 * Staff navigation, grouped by the job being done rather than listed flat — the
 * portal has outgrown a single column of twenty links.
 *
 * `roles` reuses the access bundles from `@/lib/roles`, which the matching page
 * also passes to `useAdminUser` — a link is never shown to a role the page would
 * turn away. A group header is only chrome, so its own visibility follows from
 * whichever of its children survive that filter.
 */
const staffNavigation: Array<
  | (SidebarNavItem & { roles: readonly string[] })
  | { label: string; icon: IconType; items: Array<SidebarNavItem & { roles: readonly string[] }> }
> = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: FiGrid,
    roles: withAdmin(ALL_STAFF_AREA),
  },
  {
    label: "Shipments",
    icon: FiPackage,
    items: [
      { label: "All Shipments", href: "/dashboard/shipments", icon: FiPackage, roles: withAdmin(SHIPMENT_VIEW_AREA) },
      { label: "Tracking", href: "/dashboard/tracking", icon: FiTruck, roles: withAdmin(SHIPMENT_VIEW_AREA) },
      { label: "Amendments", href: "/dashboard/amendments", icon: FiEdit3, roles: withAdmin(OPERATIONS_AREA) },
      { label: "Cancellations", href: "/dashboard/cancellations", icon: FiXCircle, roles: withAdmin(OPERATIONS_AREA) },
    ],
  },
  {
    label: "Manifests",
    icon: FiArchive,
    items: [
      { label: "Shipment Manifests", href: "/dashboard/shipment-manifests", icon: FiFileText, roles: withAdmin(OPERATIONS_AREA) },
      { label: "Operations Manifests", href: "/dashboard/operations-manifests", icon: FiArchive, roles: withAdmin(OPERATIONS_AREA) },
    ],
  },
  {
    label: "Operations",
    icon: FiTruck,
    items: [
      { label: "Pickup Requests", href: "/dashboard/pickups", icon: FiTruck, roles: withAdmin(OPERATIONS_AREA) },
      { label: "Pickup Drivers", href: "/dashboard/drivers", icon: FiUsers, roles: withAdmin(OPERATIONS_AREA) },
      { label: "International POD", href: "/dashboard/pod", icon: FiFileText, roles: withAdmin(OPERATIONS_AREA) },
      { label: "Operations Advisory", href: "/dashboard/operations-advisory", icon: FiAlertOctagon, roles: withAdmin(OPERATIONS_AREA) },
      { label: "Swiftline Routes", href: "/dashboard/swiftline-routes", icon: FiGlobe, roles: withAdmin(OPERATIONS_AREA) },
    ],
  },
  {
    label: "Sales & Pricing",
    icon: BsCurrencyRupee,
    items: [
      { label: "Quote Requests", href: "/dashboard/quote-requests", icon: FiClipboard, roles: withAdmin(OPERATIONS_AREA) },
      { label: "Counter Sales", href: "/dashboard/counter-sales", icon: BsCurrencyRupee, roles: withAdmin(COUNTER_SALES_AREA) },
      { label: "Country Rate Card", href: "/dashboard/country-rate-card", icon: FiFileText, roles: withAdmin(RATE_CARD_AREA) },
    ],
  },
  {
    label: "Accounts",
    icon: FiBriefcase,
    items: [
      { label: "Business Accounts", href: "/dashboard/business-accounts", icon: FiBriefcase, roles: withAdmin(BUSINESS_ACCOUNT_AREA) },
      { label: "Credit Accounts", href: "/dashboard/credit-accounts", icon: FiCreditCard, roles: withAdmin(CREDIT_VIEW_AREA) },
    ],
  },
  {
    label: "Administration",
    icon: FiSettings,
    items: [
      { label: "Branches", href: "/dashboard/branches", icon: FiMapPin, roles: withAdmin(BRANCH_VIEW_AREA) },
      { label: "Users", href: "/dashboard/users", icon: FiUsers, roles: withAdmin(STAFF_DIRECTORY_AREA) },
    ],
  },
  {
    label: "Help Desk",
    href: "/dashboard/tickets",
    icon: FiHelpCircle,
    roles: withAdmin(OPERATIONS_AREA),
  },
  {
    // Beside Help Desk, not inside it: enquiries and compensation are separate
    // journeys, and finance and delivery reach claims but not tickets.
    label: "Claims",
    href: "/dashboard/claims",
    icon: FiShield,
    roles: withAdmin(CLAIMS_AREA),
  },
];

function staffNavigationFor(userRole: string): SidebarNavEntry[] {
  return filterNavigation(staffNavigation.map((entry) =>
    "items" in entry
      ? {
          label: entry.label,
          icon: entry.icon,
          items: entry.items.map(({ roles, ...item }) => ({ ...item, visible: roles.includes(userRole) }))
        }
      : { label: entry.label, href: entry.href, icon: entry.icon, visible: entry.roles.includes(userRole) }
  ));
}

/**
 * Dashboard roots ("/dashboard", "/client/dashboard") own a whole URL subtree,
 * so only an exact match should light them up.
 */
function matchesRoute(pathname: string, href: string) {
  return pathname === href || (!href.endsWith("/dashboard") && pathname.startsWith(`${href}/`));
}

// `items` lets the client portal reuse this chrome with its own links; without
// it the staff navigation is filtered by role as usual.
export default function Sidebar({
  userRole,
  items,
}: {
  userRole?: string;
  items?: SidebarNavEntry[];
}) {
  const pathname = usePathname();
  const guardNavigate = useGuardedNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Only groups the user has toggled appear here; the rest fall back to opening
  // when they hold the current page, so you always land with your section open.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const navigation = items ?? staffNavigationFor(userRole ?? "");

  function toggleGroup(label: string, isOpen: boolean) {
    // There is nowhere to show children while collapsed, so opening a group
    // opens the rail with it.
    if (!sidebarOpen) {
      setSidebarOpen(true);
      setOpenGroups((current) => ({ ...current, [label]: true }));
      return;
    }
    setOpenGroups((current) => ({ ...current, [label]: !isOpen }));
  }

  const rowBase = "group flex h-11 items-center rounded-lg text-sm font-medium transition";
  const rowLayout = sidebarOpen ? "w-full justify-start gap-3 px-3" : "mx-auto w-11 justify-center";

  function iconClass(active: boolean) {
    return `h-4 w-4 shrink-0 transition-colors ${
      active ? "text-[#0D1282]" : "text-slate-500 group-hover:text-[#0D1282]"
    }`;
  }

  return (
    <aside
      className={`flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white transition-all duration-300 ${
        sidebarOpen ? "w-60" : "w-20"
      }`}
    >
      <div
        className={`flex h-20 shrink-0 items-center border-b border-slate-200 px-3 ${
          sidebarOpen ? "justify-between gap-3" : "justify-center"
        }`}
      >
        {sidebarOpen ? (
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/dashboard" onNavigate={guardNavigate("/dashboard")}>
              <Image
                src="/slclogo1.png"
                alt="Swiftline Cargo"
                width={100}
                height={100}
                className="h-17 w-30 rounded-2xl object-contain"
              />
            </Link>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setSidebarOpen((current) => !current)}
          aria-label={sidebarOpen ? "Collapse sidebar" : "Open sidebar"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 text-lg font-semibold text-[#0D1282] transition hover:border-[#0D1282] hover:bg-[#0D1282]/5 focus:outline-none focus:ring-2 focus:ring-[#0D1282]/30"
        >
          {sidebarOpen ? (
            <FiChevronLeft aria-hidden="true" />
          ) : (
            <FiChevronRight aria-hidden="true" />
          )}
        </button>
      </div>

      <nav
        data-dashboard-sidebar-scroll
        className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-5 scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {navigation.map((entry) => {
          const Icon = entry.icon;

          if (!isGroup(entry)) {
            const isActive = matchesRoute(pathname, entry.href);

            return (
              <Link
                key={entry.label}
                href={entry.href}
                // Navigating away from a half-filled form would discard it
                // silently. One guard here covers every form in the portal,
                // because the dirty state is held in a shared registry.
                onNavigate={guardNavigate(entry.href)}
                className={`${rowBase} ${rowLayout} ${
                  isActive
                    ? "bg-[#0D1282]/8 font-semibold text-[#0D1282]"
                    : "text-slate-600 hover:bg-[#0D1282]/8 hover:text-slate-900"
                }`}
                title={sidebarOpen ? undefined : entry.label}
              >
                <Icon aria-hidden="true" className={iconClass(isActive)} />
                {sidebarOpen ? <span className="truncate">{entry.label}</span> : null}
              </Link>
            );
          }

          const holdsCurrentPage = entry.items.some((item) => matchesRoute(pathname, item.href));
          const isOpen = openGroups[entry.label] ?? holdsCurrentPage;

          return (
            <div key={entry.label}>
              <button
                type="button"
                onClick={() => toggleGroup(entry.label, isOpen)}
                aria-expanded={sidebarOpen ? isOpen : false}
                className={`${rowBase} ${rowLayout} ${
                  holdsCurrentPage
                    ? "font-semibold text-[#0D1282]"
                    : "text-slate-600 hover:bg-[#0D1282]/8 hover:text-slate-900"
                }`}
                title={sidebarOpen ? undefined : entry.label}
              >
                <Icon aria-hidden="true" className={iconClass(holdsCurrentPage)} />
                {sidebarOpen ? (
                  <>
                    <span className="flex-1 truncate text-left">{entry.label}</span>
                    <FiChevronDown
                      aria-hidden="true"
                      className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200 ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                  </>
                ) : null}
              </button>

              {/* The rail down the left ties the children to their heading. */}
              {sidebarOpen && isOpen ? (
                <div className="mt-0.5 ml-[26px] space-y-0.5 border-l border-slate-200 pl-3">
                  {entry.items.map((item) => {
                    const isActive = matchesRoute(pathname, item.href);

                    return (
                      <Link
                        key={item.label}
                        href={item.href}
                        onNavigate={guardNavigate(item.href)}
                        className={`flex h-9 items-center rounded-lg px-3 text-[13px] transition ${
                          isActive
                            ? "bg-[#0D1282]/8 font-semibold text-[#0D1282]"
                            : "font-medium text-slate-600 hover:bg-[#0D1282]/8 hover:text-slate-900"
                        }`}
                      >
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
