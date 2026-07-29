"use client";

import Link from "next/link";
import { FiCheckCircle, FiClock } from "react-icons/fi";
import { EmptyState, SectionCard, SeverityChip, severityStyles } from "@/components/dashboard/DashboardWidgets";
import { buildClientTasks, type ClientExtras } from "@/lib/clientDashboardOverview";
import type { ClientShipmentSummary } from "@/lib/clientDashboard";

export default function ClientTasksCard({
  summary,
  extras,
  refreshing
}: {
  summary: ClientShipmentSummary;
  extras: ClientExtras;
  refreshing: boolean;
}) {
  const tasks = buildClientTasks({ summary, extras });
  const dim = refreshing ? "opacity-60" : "opacity-100";

  return (
    <SectionCard icon={FiClock} title="Upcoming tasks" subtitle="Approvals and follow-ups on your side">
      {tasks.length ? (
        <ul className={`space-y-1 transition-opacity duration-200 ${dim}`}>
          {tasks.map((task) => (
            <li key={task.id}>
              <Link
                href={task.href}
                className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition"
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
      ) : (
        <EmptyState icon={FiCheckCircle} title="You're all caught up" message="No approvals, reviews, or payments are waiting on you right now." />
      )}
    </SectionCard>
  );
}
