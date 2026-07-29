"use client";

import { FiAlertTriangle } from "react-icons/fi";

export default function ClientUnavailableNotice({ sections }: { sections: string[] }) {
  if (!sections.length) return null;

  return (
    <p className="flex items-start gap-2 rounded-xl border border-[#fab219]/40 bg-[#fab219]/[0.08] px-4 py-3 text-xs font-medium text-[#7a4f00]">
      <FiAlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      These sections could not be loaded and read as empty: {sections.join(", ")}.
    </p>
  );
}
