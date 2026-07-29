"use client";

import { FiAlertTriangle } from "react-icons/fi";
import type { ClientDashboardAccount } from "@/lib/clientDashboard";

export default function ClientAccessBlocked({ account }: { account: ClientDashboardAccount }) {
  return (
    <section className="rounded-2xl border border-[#fab219]/40 bg-[#fab219]/[0.08] p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-[#fab219]/20 text-[#7a4f00]">
          <FiAlertTriangle aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-[#7a4f00]">Dashboard access is not ready</h2>
          <p className="mt-1 text-sm font-medium text-[#7a4f00]">
            {account.account.company.companyName || account.account.accountId} cannot load the normal dashboard yet.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-[#7a4f00]">
            {account.dashboardAccess.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}
