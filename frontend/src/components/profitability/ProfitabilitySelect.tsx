import { FiChevronDown } from "react-icons/fi";
import type { SelectHTMLAttributes } from "react";

export default function ProfitabilitySelect({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select
        {...props}
        className={`h-10 w-full appearance-none rounded-lg border border-slate-300 bg-white pl-3 pr-10 text-sm font-medium text-slate-900 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-[#0D1282]/10 disabled:bg-slate-100 disabled:text-slate-500 ${className}`}
      >
        {children}
      </select>
      <FiChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0D1282]"
      />
    </span>
  );
}
