"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FiCalendar } from "react-icons/fi";
import {
  isNewAdvisory,
  listClientRegulatoryUpdates,
  listClientServiceDisruptions,
  listRegulatoryUpdates,
  listServiceDisruptions
} from "@/lib/operationsAdvisory";

/**
 * Header quick link to the Holiday & Cut-Off Calendar. Clients land on the
 * read-only calendar page; staff land on the management tab, so the same icon
 * serves both audiences.
 *
 * The badge counts advisories published inside the freshness window shared with
 * the marquee- service disruptions plus customs & regulatory updates. It is
 * deliberately time-based rather than read-tracked: it draws the eye when
 * something actually changed and clears itself once the news is stale, with no
 * per-user state to keep.
 *
 * The staff endpoints behind the badge are gated to admin and operations, so
 * `role` decides whether to poll at all: a finance or HR login still gets the
 * link, just without a minute-by-minute 403.
 */
export default function OperationsCalendarIcon({
  variant = "client",
  role,
}: {
  variant?: "client" | "staff";
  role?: string;
}) {
  const href = variant === "client"
    ? "/client/operations-calendar"
    : "/dashboard/operations-advisory?tab=calendar";

  const [newCount, setNewCount] = useState(0);
  const canReadAdvisories = variant === "client" || role === "admin" || role === "operations";

  const load = useCallback(async () => {
    try {
      const [disruptionData, regulatoryData] = variant === "client"
        ? await Promise.all([listClientServiceDisruptions(), listClientRegulatoryUpdates()])
        : await Promise.all([
          listServiceDisruptions({ scope: "live" }),
          listRegulatoryUpdates({ active: true })
        ]);

      const now = Date.now();
      const freshDisruptions = disruptionData.disruptions
        .filter((disruption) => isNewAdvisory(disruption.createdAt, now));
      const freshRegulatory = regulatoryData.updates
        .filter((update) => update.status !== "EXPIRED" && isNewAdvisory(update.createdAt, now));

      setNewCount(freshDisruptions.length + freshRegulatory.length);
    } catch {
      // A header ornament must never break the header: on a failed poll the
      // badge simply keeps its last known value.
    }
  }, [variant]);

  useEffect(() => {
    if (!canReadAdvisories) return;

    const initialLoad = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 60_000);

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [canReadAdvisories, load]);

  const badgeLabel = newCount > 99 ? "99+" : String(newCount);
  const ariaLabel = newCount
    ? `Holiday & Cut-Off Calendar, ${newCount} new ${newCount === 1 ? "update" : "updates"}`
    : "Holiday & Cut-Off Calendar";

  return (
    <div className="group relative">
      <Link
        href={href}
        aria-label={ariaLabel}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-[#0D1282] transition hover:border-[#0D1282] hover:bg-[#0D1282]/5 focus:outline-none focus:ring-2 focus:ring-[#0D1282]/30"
      >
        <FiCalendar aria-hidden="true" className="h-5 w-5" />
        {newCount ? (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#D71313] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white"
          >
            {badgeLabel}
          </span>
        ) : null}
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
        Holiday & Cut-Off Calendar
        {newCount ? ` · ${badgeLabel} new` : ""}
        <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900" />
      </div>
    </div>
  );
}
