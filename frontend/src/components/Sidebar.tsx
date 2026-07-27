"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FiBriefcase, FiChevronLeft,FiArchive, FiChevronRight, FiClipboard, FiCreditCard, FiDollarSign, FiEdit3, FiFileText, FiGrid, FiHelpCircle, FiMapPin, FiUsers, FiPackage, FiTruck, FiXCircle } from "react-icons/fi";

const navigationItems = [
  { label: "Dashboard", href: "/dashboard", icon: FiGrid, roles: ["admin", "operations", "accounts", "delivery", "hr"] },
  { label: "Business Accounts", href: "/dashboard/business-accounts", icon: FiBriefcase, roles: ["admin"] },
  { label: "Credit Accounts", href: "/dashboard/credit-accounts", icon: FiCreditCard, roles: ["admin"] },
  { label: "Branches", href: "/dashboard/branches", icon: FiMapPin, roles: ["admin"] },
  { label: "Shipments", href: "/dashboard/dpd-labels", icon: FiPackage, roles: ["admin"] },
  { label: "Tracking", href: "/dashboard/tracking", icon: FiTruck, roles: ["admin"] },
  { label: "Manifests", href: "/dashboard/operations-manifests", icon: FiArchive, roles: ["admin", "operations"] },
  { label: "Amendments", href: "/dashboard/amendments", icon: FiEdit3, roles: ["admin"] },
  { label: "Cancellations", href: "/dashboard/cancellations", icon: FiXCircle, roles: ["admin"] },
  { label: "Quote Requests", href: "/dashboard/quote-requests", icon: FiClipboard, roles: ["admin"] },
  { label: "Support Tickets", href: "/dashboard/tickets", icon: FiHelpCircle, roles: ["admin"] },
  { label: "Country Rate Card", href: "/dashboard/country-rate-card", icon: FiDollarSign, roles: ["admin"] },
  { label: "Tax Invoices", href: "/dashboard/tax-invoices", icon: FiFileText, roles: ["admin"] },
  { label: "Users", href: "/dashboard/users", icon: FiUsers, roles: ["admin"] },
];

export default function Sidebar({ userRole }: { userRole?: string }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const visibleNavigationItems = navigationItems.filter((item) => item.roles.includes(userRole ?? ""));

return (
  <aside
    className={`sticky top-0 flex h-screen shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white transition-all duration-300 ${
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
          {/* <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg  text-base font-bold text-white">
            <Image
              src="/Slogo.png"
              alt="Swiftline Cargo"
              width={24}
              height={24}
              className="h-8 w-8 object-contain rounded-2xl"
            />
          </span> */}

          <span className="truncate text-3xl font-[times] ml-5 tracking-wide font-bold  text-[#0D1282]">
            Swiftline
          </span>
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

    <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      {visibleNavigationItems.map((item) => {
        const Icon = item.icon;
        const isActive =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));

        return (
          <Link
            key={item.label}
            href={item.href}
            className={`flex h-11 items-center rounded-lg text-sm font-medium transition ${
              isActive
                ? "bg-[#0D1282] text-white shadow-sm shadow-[#0D1282]/30"
                : "text-slate-600 hover:bg-[#0D1282]/8 hover:text-[#0D1282]"
            } ${
              sidebarOpen
                ? "w-full justify-start gap-3 px-3"
                : "mx-auto w-11 justify-center"
            }`}
            title={sidebarOpen ? undefined : item.label}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center">
              <Icon aria-hidden="true" className="h-4 w-4" />
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
