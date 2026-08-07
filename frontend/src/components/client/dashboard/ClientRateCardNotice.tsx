"use client";

import { FiAlertTriangle } from "react-icons/fi";
import type { ClientDashboardAccount } from "@/lib/clientDashboard";

export default function ClientRateCardNotice({ account }: { account: ClientDashboardAccount }) {
  if (account.bookingAccess.state === "READY") return null;

  return (
    <section className="rounded-2xl border border-[#fab219]/40 bg-[#fab219]/[0.08] px-4 py-3">
      <p className="flex items-start gap-2 text-sm font-medium text-[#7a4f00]">
        <FiAlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
        {account.bookingAccess.message}
      </p>
    </section>
  );
}
