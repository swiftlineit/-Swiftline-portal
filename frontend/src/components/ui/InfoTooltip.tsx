"use client";

import { FiInfo } from "react-icons/fi";

/**
 * A hover hint next to a label. CSS-only, so it carries no state and works inside
 * table headers and form labels alike. The text resets case and tracking because
 * the labels it sits beside are usually uppercase.
 */
export default function InfoTooltip({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`group relative inline-flex align-middle ${className}`}>
      <FiInfo aria-hidden="true" className="h-3.5 w-3.5 cursor-help text-slate-400" />
      <span className="sr-only">{text}</span>
      <span
        role="tooltip"
        title={text}
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-60 -translate-x-1/2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium normal-case leading-snug tracking-normal text-white shadow-lg group-hover:block"
      >
        {text}
      </span>
    </span>
  );
}
