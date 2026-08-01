"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { IconType } from "react-icons";
import {
  FiArchive,
  FiBriefcase,
  FiChevronLeft,
  FiChevronRight,
  FiClipboard,
  FiCreditCard,
  FiEdit3,
  FiFileText,
  FiGrid,
  FiHelpCircle,
  FiMapPin,
  FiPackage,
  FiTruck,
  FiUsers,
  FiXCircle,


} from "react-icons/fi";
import { BsCurrencyRupee } from "react-icons/bs";
import {
  ALL_STAFF_AREA,
  FINANCE_AREA,
  OPERATIONS_AREA,
  SHIPMENT_VIEW_AREA,
  STAFF_DIRECTORY_AREA,
  withAdmin
} from "@/lib/roles";
export type SidebarNavItem = {
  label: string;
  href: string;
  icon: IconType;
};

// `roles` reuses the access bundles from `@/lib/roles`, which the matching page
// also passes to `useAdminUser` — a link is never shown to a role the page would
// turn away.
const navigationItems = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: FiGrid,
    roles: withAdmin(ALL_STAFF_AREA),
  },
  {
    label: "Business Accounts",
    href: "/dashboard/business-accounts",
    icon: FiBriefcase,
    roles: ["admin"],
  },
  {
    label: "Credit Accounts",
    href: "/dashboard/credit-accounts",
    icon: FiCreditCard,
    roles: withAdmin(FINANCE_AREA),
  },
  {
    label: "Branches",
    href: "/dashboard/branches",
    icon: FiMapPin,
    roles: ["admin"],
  },
  // {
  //   label: "Create Shipment",
  //   href: "/dashboard/dpd-labels",
  //   icon: FiPackage,
  //   roles: ["admin"],
  // },
  {
    label: "Shipments",
    href: "/dashboard/shipments",
    icon: FiPackage,
    roles: withAdmin(SHIPMENT_VIEW_AREA),
  },
  {
    label: "Tracking",
    href: "/dashboard/tracking",
    icon: FiTruck,
    roles: withAdmin(SHIPMENT_VIEW_AREA),
  },
  {
    label: "Shipment Manifests",
    href: "/dashboard/shipment-manifests",
    icon: FiFileText,
    roles: withAdmin(OPERATIONS_AREA),
  },
  {
    label: "Operations Manifests",
    href: "/dashboard/operations-manifests",
    icon: FiArchive,
    roles: withAdmin(OPERATIONS_AREA),
  },
  {
    label: "Amendments",
    href: "/dashboard/amendments",
    icon: FiEdit3,
    roles: withAdmin(OPERATIONS_AREA),
  },
  {
    label: "Cancellations",
    href: "/dashboard/cancellations",
    icon: FiXCircle,
    roles: withAdmin(OPERATIONS_AREA),
  },
  {
    label: "Quote Requests",
    href: "/dashboard/quote-requests",
    icon: FiClipboard,
    roles: withAdmin(OPERATIONS_AREA),
  },
  {
    label: "Country Rate Card",
    href: "/dashboard/country-rate-card",
    icon: BsCurrencyRupee ,
    roles: withAdmin(FINANCE_AREA),
  },
  {
    label: "Users",
    href: "/dashboard/users",
    icon: FiUsers,
    roles: withAdmin(STAFF_DIRECTORY_AREA),
  },
  {
    label: "Help Desk",
    href: "/dashboard/tickets",
    icon: FiHelpCircle,
    roles: withAdmin(OPERATIONS_AREA),
  },
];

// `items` lets the client portal reuse this chrome with its own links; without
// it the staff navigation is filtered by role as usual.
export default function Sidebar({
  userRole,
  items,
}: {
  userRole?: string;
  items?: SidebarNavItem[];
}) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const visibleNavigationItems: SidebarNavItem[] =
    items ??
    navigationItems.filter((item) => item.roles.includes(userRole ?? ""));

  return (
    <aside
      className={`flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white transition-all duration-300 ${
        sidebarOpen ? "w-56" : "w-20"
      }`}
    >
      <div
        className={`flex h-20 shrink-0 items-center border-b border-slate-200 px-3 ${
          sidebarOpen ? "justify-between gap-3" : "justify-center"
        }`}
      >
        {sidebarOpen ? (
          <div className="flex min-w-0 items-center gap-3">
           <Link href="/dashboard">
            <Image
              src="/logo.svg"
              alt="Swiftline Cargo"
              width={124}
              height={214}
              className="h-102 w-102 rounded-2xl object-contain"
            />
           </Link>

            {/*
            <span className="ml-5 truncate text-3xl font-bold tracking-wide text-[#0D1282]">
              Swiftline
            </span>
            */}
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

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-6 scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {visibleNavigationItems.map((item) => {
          const Icon = item.icon;

          // Dashboard roots ("/dashboard", "/client/dashboard") own a whole URL
          // subtree, so only an exact match should light them up.
          const isActive =
            pathname === item.href ||
            (!item.href.endsWith("/dashboard") &&
              pathname.startsWith(`${item.href}/`));

          return (
            <Link
              key={item.label}
              href={item.href}
              className={`group flex h-11 items-center rounded-lg text-sm font-medium transition ${
                isActive
                  ? "text-slate-900"
                  : "text-slate-600 hover:bg-[#0D1282]/8 hover:text-slate-900"
              } ${
                sidebarOpen
                  ? "w-full justify-start gap-3 px-3"
                  : "mx-auto w-11 justify-center"
              }`}
              title={sidebarOpen ? undefined : item.label}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                <Icon
                  aria-hidden="true"
                  className={`h-4 w-4 transition-colors ${
                    isActive
                      ? "text-[#0D1282]"
                      : "text-slate-500 group-hover:text-[#0D1282]"
                  }`}
                />
              </span>

              {sidebarOpen ? (
                <span className="truncate">{item.label}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
