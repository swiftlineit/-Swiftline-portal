"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import BranchForm from "@/components/branches/BranchForm";
import BranchesShell, { BranchesLoading } from "@/components/branches/BranchesShell";
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

  if (loading || !user) return <BranchesLoading />;

  return (
    <BranchesShell user={user}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Edit Branch</h1>
          <p className="mt-1 text-sm text-slate-500">{branch ? `${branch.name} (${branch.code})` : "Update branch details."}</p>
        </div>
        <Link
          href={branch ? `/dashboard/branches/${branch._id}` : "/dashboard/branches"}
          className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Back to Branch
        </Link>
      </div>

      {error ? <div className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

      {branchLoading ? (
        <div className="border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">Loading branch...</div>
      ) : branch ? (
        <BranchForm
          branchId={branch._id}
          initialData={branchToFormData(branch)}
          initialStatus={branch.status === "ACTIVE" ? "ACTIVE" : "DRAFT"}
        />
      ) : null}
    </BranchesShell>
  );
}
