"use client";

import Link from "next/link";
import { FiArchive, FiCalendar, FiPackage, FiPlus, FiUserPlus } from "react-icons/fi";
import { describeRole } from "@/lib/dashboardOverview";
import type { AuthenticatedUser } from "@/lib/useAdminUser";
import { panelSurface } from "@/components/dashboard/DashboardWidgets";

const quickActions = [
  { label: "Create shipment", href: "/dashboard/dpd-labels", icon: FiPackage, roles: ["admin"], primary: true },
  { label: "New manifest", href: "/dashboard/operations-manifests/new", icon: FiArchive, roles: ["admin", "operations"], primary: false },
  { label: "New business account", href: "/dashboard/business-accounts/create", icon: FiUserPlus, roles: ["admin"], primary: false }
];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function firstName(user: AuthenticatedUser) {
  const name = user.name?.trim();
  if (name) return name.split(/\s+/)[0];
  return user.email.split("@")[0];
}

export default function AdminDashboardHeader({ user }: { user: AuthenticatedUser }) {
  const actions = quickActions.filter((action) => action.roles.includes(user.role));

  return (
    <section className={`flex flex-wrap items-center justify-between gap-6 p-6 ${panelSurface}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-[#0D1282]/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#0D1282]">
            {describeRole(user.role)}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
            <FiCalendar aria-hidden="true" className="h-3.5 w-3.5" />
            {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
          </span>
        </div>

        <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">
          {greeting()}, {firstName(user)}
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
          Here is the state of Swiftline Cargo operations for your role: shipment flow, the queues waiting on
          you, and the modules you use most.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const Icon = action.primary ? FiPlus : action.icon;
          return (
            <Link
              key={action.href}
              href={action.href}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D1282]/40 focus-visible:ring-offset-2 ${
                action.primary
                  ? "bg-[#F0DE36] text-[#0D1282] shadow-sm shadow-black/10 hover:bg-[#e0cf2e]"
                  : "border border-slate-200 bg-white text-slate-700 hover:border-[#0D1282] hover:text-[#0D1282]"
              }`}
            >
              <Icon aria-hidden="true" className="h-4 w-4" />
              {action.label}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
