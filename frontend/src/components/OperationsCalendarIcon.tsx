"use client";

import Link from "next/link";
import { FiCalendar } from "react-icons/fi";

/**
 * Header quick link to the Holiday & Cut-Off Calendar. Clients land on the
 * read-only calendar page; staff land on the management tab so the same icon
 * serves both audiences.
 */
export default function OperationsCalendarIcon({
  variant = "client",
}: {
  variant?: "client" | "staff";
}) {
  const href = variant === "client"
    ? "/client/operations-calendar"
    : "/dashboard/operations-advisory?tab=calendar";

  return (
    <div className="group relative">
      <Link
        href={href}
        aria-label="Holiday & Cut-Off Calendar"
        className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-[#0D1282] transition hover:border-[#0D1282] hover:bg-[#0D1282]/5 focus:outline-none focus:ring-2 focus:ring-[#0D1282]/30"
      >
        <FiCalendar aria-hidden="true" className="h-5 w-5" />
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
        <div className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-slate-900" />
      </div>
    </div>
  );
}
