"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { FiActivity, FiAlertTriangle, FiArchive, FiBriefcase, FiCheckCircle, FiInbox, FiPackage } from "react-icons/fi";
import { EmptyState, RowsSkeleton, SectionCard } from "@/components/dashboard/DashboardWidgets";
import type { ActivityItem, DashboardOverview } from "@/lib/dashboardOverview";

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

const activityIcons: Record<ActivityItem["kind"], IconType> = {
  shipment: FiPackage,
  delivery: FiCheckCircle,
  manifest: FiArchive,
  account: FiBriefcase,
  ticket: FiInbox,
  exception: FiAlertTriangle
};

const activityTones: Record<ActivityItem["kind"], string> = {
  shipment: "bg-slate-100 text-[#0D1282]",
  delivery: "bg-emerald-100 text-emerald-600",
  manifest: "bg-slate-100 text-[#0D1282]",
  account: "bg-[#F0DE36]/25 text-[#7a4f00]",
  ticket: "bg-slate-100 text-slate-600",
  exception: "bg-red-100 text-red-600"
};

function relativeTime(value: string) {
  const minutes = Math.max(Math.floor((Date.now() - new Date(value).getTime()) / 60_000), 0);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

export default function AdminActivityCard({
  overview,
  dataLoading,
  refreshing,
  className = ""
}: {
  overview: DashboardOverview | null;
  dataLoading: boolean;
  refreshing: boolean;
  className?: string;
}) {
  const dim = refreshing ? "opacity-60" : "opacity-100";

  return (
    <SectionCard
      className={className}
      icon={FiActivity}
      title="Recent activity"
      subtitle="The latest movements across shipments, manifests, accounts, and tickets"
    >
      {dataLoading ? <RowsSkeleton rows={6} /> : null}
      {!dataLoading && overview?.activity.length ? (
        <ol className={`relative space-y-1 transition-opacity duration-200 ${dim}`}>
          <span aria-hidden="true" className="absolute bottom-5 left-7 top-5 w-px bg-slate-200" />
          {overview.activity.map((item) => {
            const Icon = activityIcons[item.kind];
            const row = (
              <>
                <span className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-4 ring-white ${activityTones[item.kind]}`}>
                  <Icon aria-hidden="true" className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="truncate text-sm font-semibold text-slate-900">{item.title}</span>
                    <span className="shrink-0 text-[11px] font-medium text-slate-500">{relativeTime(item.at)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{item.detail}</span>
                  <span className="mt-0.5 block truncate text-[11px] font-medium uppercase tracking-wide text-[#0D1282]">{item.actor}</span>
                </span>
              </>
            );

            return (
              <li key={item.id}>
                {item.href ? (
                  <Link
                    href={item.href}
                    className="flex items-start gap-3 rounded-xl p-2 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                  >
                    {row}
                  </Link>
                ) : (
                  <div className="flex items-start gap-3 p-2">{row}</div>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}
      {!dataLoading && !overview?.activity.length ? (
        <EmptyState
          icon={FiActivity}
          title="No activity yet"
          message="Bookings, manifest scans, and account approvals show up here as your team works."
        />
      ) : null}
    </SectionCard>
  );
}
