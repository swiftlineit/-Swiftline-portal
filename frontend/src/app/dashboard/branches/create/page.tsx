"use client";

import Link from "next/link";
import BranchForm from "@/components/branches/BranchForm";
import BranchesShell, { BranchesLoading } from "@/components/branches/BranchesShell";
import { useAdminUser } from "@/lib/useAdminUser";

export default function CreateBranchPage() {
  const { user, loading } = useAdminUser();

  if (loading || !user) return <BranchesLoading />;

  return (
    <BranchesShell user={user}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Create Branch</h1>
          <p className="mt-1 text-sm text-slate-500">Create an active branch or save an incomplete draft.</p>
        </div>
        <Link href="/dashboard/branches" className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
          Back to Branches
        </Link>
      </div>

      <BranchForm />
    </BranchesShell>
  );
}
