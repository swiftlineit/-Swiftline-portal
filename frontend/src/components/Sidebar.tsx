"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FiBriefcase, FiChevronLeft, FiChevronRight, FiGrid, FiUsers } from "react-icons/fi";

const navigationItems = [
  { label: "Dashboard", href: "/dashboard", icon: FiGrid, adminOnly: false },
  { label: "Business Accounts", href: "/dashboard/business-accounts", icon: FiBriefcase, adminOnly: true },
  { label: "Users", href: "/dashboard/users", icon: FiUsers, adminOnly: true }
];

export default function Sidebar({ userRole }: { userRole?: string }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const visibleNavigationItems = navigationItems.filter((item) => !item.adminOnly || userRole === "admin");

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-slate-200 bg-white shadow-sm transition-all duration-300  ${
        sidebarOpen ? "w-56" : "w-20"
      }`}
    >
      <div
        className={`flex h-20 items-center border-b border-gray-200  shadow-sm px-3 ${
          sidebarOpen ? "justify-between gap-3" : "justify-center"
        }`}
      >
        {sidebarOpen ? (
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src="/Slogo.png"
              alt="Swiftline Cargo"
              width={40}
              height={40}
              className="h-10 w-10 rounded"
            />
            <span className="truncate text-lg  font-semibold ">
              Swiftline 
            </span>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setSidebarOpen((current) => !current)}
          aria-label={sidebarOpen ? "Collapse sidebar" : "Open sidebar"}
          className="flex h-8 w-8 shrink-0 items-center justify-center border border-gray-200 text-lg font-semibold text-blue-700 transition hover:border-blue-200 hover:text-black focus:outline-none focus:ring-2 focus:ring-sky-300/60"
        >
          {sidebarOpen ? <FiChevronLeft aria-hidden="true" /> : <FiChevronRight aria-hidden="true" />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-6">
        {visibleNavigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex h-11 items-center text-sm font-medium transition hover:text-blue-900 ${
                isActive ? "text-blue-900" : "text-black"
              } ${sidebarOpen ? "w-full justify-start gap-3" : "mx-auto w-11 justify-center"}`}
              title={sidebarOpen ? undefined : item.label}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                <Icon aria-hidden="true" className="h-4 w-4" />
              </span>
              {sidebarOpen ? <span className="truncate">{item.label}</span> : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
