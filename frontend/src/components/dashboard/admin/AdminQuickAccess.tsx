"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { FiArchive, FiArrowRight, FiBriefcase, FiCreditCard, FiGrid, FiInbox, FiMapPin, FiPackage, FiTruck } from "react-icons/fi";
import { panelLift, panelSurface } from "@/components/dashboard/DashboardWidgets";
import type { QuickLink } from "@/lib/dashboardOverview";

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

const quickLinkIcons: Record<string, IconType> = {
  "/dashboard/dpd-labels": FiPackage,
  "/dashboard/tracking": FiTruck,
  "/dashboard/operations-manifests": FiArchive,
  "/dashboard/business-accounts": FiBriefcase,
  "/dashboard/credit-accounts": FiCreditCard,
  "/dashboard/branches": FiMapPin,
  "/dashboard/tickets": FiInbox
};

export default function AdminQuickAccess({ links }: { links: QuickLink[] }) {
  if (!links.length) return null;

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight text-slate-900">Quick access</h2>
        <p className="text-xs text-slate-500">Modules available to your role</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {links.map((link) => {
          const Icon = quickLinkIcons[link.href] ?? FiGrid;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`group flex items-start gap-3 p-4 ${panelSurface} ${panelLift} focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[#0D1282] transition group-hover:bg-[#0D1282] group-hover:text-white">
                <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1 text-sm font-semibold text-slate-900">
                  {link.label}
                  <FiArrowRight aria-hidden="true" className="h-3 w-3 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-[#0D1282]" />
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-500">{link.description}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
