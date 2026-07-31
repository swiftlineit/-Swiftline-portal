"use client";

import { FiInfo } from "react-icons/fi";

/**
 * A hover hint next to a label. CSS-only, so it carries no state and works inside
 * table headers and form labels alike. The text resets case and tracking because
 * the labels it sits beside are usually uppercase.
 */

export default function InfoTooltip({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  return (
    <span className={`group relative inline-flex items-center ${className}`}>
      <FiInfo
        aria-hidden="true"
        className="h-3.5 w-3.5 cursor-help text-slate-400 transition-colors duration-200 hover:text-[#0D1282]"
      />

      <span className="sr-only">{text}</span>

      <span
        role="tooltip"
        title={text}
        className="
          pointer-events-none
          absolute left-full top-1/2 z-50 ml-3
          -translate-y-1/2
          whitespace-nowrap
          rounded-xl
          border border-slate-200
          bg-white
          px-3 py-2
          text-xs font-medium normal-case leading-5 text-slate-700
          shadow-xl
          opacity-0
          transition-all duration-200
          group-hover:translate-x-1
          group-hover:opacity-100
          group-hover:block
          hidden
        "
      >
        <span className="absolute -left-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-b border-l border-slate-200 bg-white" />
        {text}
      </span>
    </span>
  );
}