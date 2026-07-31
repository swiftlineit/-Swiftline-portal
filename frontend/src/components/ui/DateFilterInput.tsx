"use client";

/**
 * Single-day date filter, styled to match the picker on the Shipments list page.
 * The backend expands the chosen day into a full [00:00:00, 23:59:59] window.
 */
export default function DateFilterInput({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <input
      type="date"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={`h-10 w-44 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-blue-100 ${className}`}
    />
  );
}
