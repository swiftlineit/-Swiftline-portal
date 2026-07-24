"use client";

import Link from "next/link";
import BranchForm from "@/components/branches/BranchForm";
import DashboardShell, { DashboardLoading } from "@/components/DashboardShell";
import { useAdminUser } from "@/lib/useAdminUser";

export default function CreateBranchPage() {
  const { user, loading } = useAdminUser();

  if (loading || !user) return <DashboardLoading />;

  return (
    <DashboardShell user={user}>
      <div className="min-h-full bg-[#EEEDED]/60 -m-6 p-6 lg:-m-8 lg:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="border-l-4 border-[#F0DE36] pl-4">
            <h1 className="text-2xl font-bold tracking-tight text-[#0D1282]">Create Branch</h1>
            <p className="mt-1 text-sm text-slate-500">Create an active branch, or save an incomplete draft to finish later.</p>
          </div>
          <Link
            href="/dashboard/branches"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[#0D1282] hover:text-[#0D1282]"
          >
            Back to Branches
          </Link>
        </div>

        <BranchForm />
      </div>
    </DashboardShell>
  );
}
