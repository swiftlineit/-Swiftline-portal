"use client";

import Link from "next/link";
import { FiCheckCircle, FiClock } from "react-icons/fi";
import { EmptyState, RowsSkeleton, SectionCard, SeverityChip, severityStyles } from "@/components/dashboard/DashboardWidgets";
import type { DashboardOverview } from "@/lib/dashboardOverview";

export default function AdminTasksCard({
  overview,
  dataLoading,
  refreshing
}: {
  overview: DashboardOverview | null;
  dataLoading: boolean;
  refreshing: boolean;
}) {
  const dim = refreshing ? "opacity-60" : "opacity-100";

  return (
    <SectionCard icon={FiClock} title="Upcoming tasks" subtitle="Approvals, queues, and deadlines for your role">
      {dataLoading ? <RowsSkeleton rows={5} /> : null}
      {!dataLoading && overview?.tasks.length ? (
        <ul className={`space-y-1 transition-opacity duration-200 ${dim}`}>
          {overview.tasks.map((task) => (
            <li key={task.id}>
              <Link
                href={task.href}
                className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
              >
                <span className={`mt-1 h-8 w-1 shrink-0 rounded-full ${severityStyles[task.tone].rail}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">{task.label}</span>
                    <SeverityChip tone={task.tone}>{task.count}</SeverityChip>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{task.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {!dataLoading && !overview?.tasks.length ? (
        <EmptyState
          icon={FiCheckCircle}
          title="Your queue is clear"
          message="No approvals, holds, or dispatches are waiting on you right now."
        />
      ) : null}
    </SectionCard>
  );
}
