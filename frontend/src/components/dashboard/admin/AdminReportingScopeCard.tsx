"use client";

import Link from "next/link";
import { FiArrowRight, FiLock } from "react-icons/fi";
import { SectionCard } from "@/components/dashboard/DashboardWidgets";
import { describeRole } from "@/lib/dashboardOverview";

export default function AdminReportingScopeCard({ role }: { role: string }) {
  return (
    <SectionCard icon={FiLock} title="Reporting scope" subtitle={`Available to the ${describeRole(role)} role`}>
      <div className="flex flex-col items-start gap-3">
        <p className="text-xs leading-6 text-slate-600">
          Shipment, account, and finance reporting is restricted to the roles that own those records, so
          no metrics are shown here. An administrator can widen your access if you need operational figures.
        </p>
        <Link
          href="/dashboard/tickets"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 transition hover:border-[#0D1282] hover:text-[#0D1282]"
        >
          Raise a request
          <FiArrowRight aria-hidden="true" className="h-3 w-3" />
        </Link>
      </div>
    </SectionCard>
  );
}
