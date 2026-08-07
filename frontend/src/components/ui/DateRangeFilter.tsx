"use client";

import type { DateRange } from "@/lib/dateRange";

/**
 * From/to date filter shared by every list page, replacing the earlier
 * single-day picker. Either side can be left empty for an open-ended range;
 * the backend expands the pair into a full [from 00:00:00, to 23:59:59] window.
 */
export default function DateRangeFilter({
  value,
  onChange,
  className = "",
}: {
  value: DateRange;
  onChange: (value: DateRange) => void;
  className?: string;
}) {
  const inputClass =
    "h-10 w-40 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-blue-100";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <input
        type="date"
        value={value.from}
        max={value.to || undefined}
        onChange={(event) => onChange({ ...value, from: event.target.value })}
        aria-label="From date"
        className={inputClass}
      />
      <span className="text-sm font-medium text-slate-500">to</span>
      <input
        type="date"
        value={value.to}
        min={value.from || undefined}
        onChange={(event) => onChange({ ...value, to: event.target.value })}
        aria-label="To date"
        className={inputClass}
      />
    </div>
  );
}
