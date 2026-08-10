"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import BranchForm from "@/components/branches/BranchForm";
import { DashboardLoading } from "@/components/DashboardShell";
import { Branch, branchToFormData, getBranch } from "@/lib/branches";
import { useAdminUser } from "@/lib/useAdminUser";

export default function EditBranchPage() {
  const params = useParams<{ branchId: string }>();
  const { user, loading } = useAdminUser();
  const [branch, setBranch] = useState<Branch | null>(null);
  const [branchLoading, setBranchLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user || !params.branchId) return;

    async function loadBranch() {
      setBranchLoading(true);
      setError("");

      try {
        const data = await getBranch(params.branchId);
        setBranch(data.branch);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load branch.");
      } finally {
        setBranchLoading(false);
      }
    }

    void loadBranch();
  }, [params.branchId, user]);

  if (loading || !user) return <DashboardLoading />;

  return (
      <div className="-m-6 min-h-full bg-slate-50 p-6 lg:-m-8 lg:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">Edit Branch</h1>
            <p className="mt-1 text-sm text-slate-500">{branch ? `${branch.name} (${branch.code})` : "Update branch details."}</p>
          </div>
          <Link
            href={branch ? `/dashboard/branches/${branch._id}` : "/dashboard/branches"}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-[#0D1282] hover:text-[#0D1282]"
          >
            Back to Branch
          </Link>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-[#D71313]/25 bg-[#D71313]/5 px-4 py-3 text-sm font-medium text-[#D71313]">
            {error}
          </div>
        ) : null}

        {branchLoading ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500 shadow-sm">
            Loading branch...
          </div>
        ) : branch ? (
          <BranchForm
            branchId={branch._id}
            initialData={branchToFormData(branch)}
            initialStatus={branch.status}
            identityLocked={Boolean(branch.activatedAt)}
          />
        ) : null}
      </div>
  );
}
