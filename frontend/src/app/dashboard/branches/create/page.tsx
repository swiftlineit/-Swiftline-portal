"use client";

import BranchForm from "@/components/branches/BranchForm";
import { DashboardLoading } from "@/components/DashboardShell";
import { useAdminUser } from "@/lib/useAdminUser";

export default function CreateBranchPage() {
  const { user, loading } = useAdminUser();

  if (loading || !user) return <DashboardLoading />;

  return (
      <div className="-m-6 min-h-full bg-slate-50 p-6 lg:-m-8 lg:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">Create New Branch</h1>
            <p className="mt-1 text-sm text-slate-500">Create an active branch, or save an incomplete draft to finish later.</p>
          </div>
          </div>

        <BranchForm />
      </div>
  );
}
