"use client";

import { FiInfo } from "react-icons/fi";

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
  absolute left-1/2 top-full z-50 mt-2
  hidden w-48
-translate-x-[40%]
  whitespace-normal wrap-break-words
  rounded-xl
  border border-slate-200
  bg-white
  px-3 py-2
  text-xs font-medium normal-case leading-5 text-slate-700
  shadow-xl
  opacity-0
  transition-all duration-200
  group-hover:block
  group-hover:opacity-100
"
      >
        <span className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-l border-t border-slate-200 bg-white" />
        {text}
      </span>
    </span>
  );
}