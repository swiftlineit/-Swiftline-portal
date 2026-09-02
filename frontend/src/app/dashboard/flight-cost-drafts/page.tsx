"use client";

import { DashboardLoading } from "@/components/DashboardShell";
import FlightCostDraftsPanel from "@/components/profitability/FlightCostDraftsPanel";
import { OPERATIONS_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

export default function FlightCostDraftsPage() {
  const { user, loading } = useAdminUser(OPERATIONS_AREA);

  if (loading || !user) return <DashboardLoading />;

  return (
    <div className="mx-auto max-w-8xl space-y-5">
      <div>
        <p className="text-sm font-semibold text-[#0D1282]">Operations</p>
        <h1 className="mt-0.5 text-2xl font-bold text-slate-950">Flight cost drafts</h1>
        <p className="mt-1 text-sm text-slate-600">Review and remove provisional flight cost records before Finance finalizes them.</p>
      </div>
      <FlightCostDraftsPanel />
    </div>
  );
}
