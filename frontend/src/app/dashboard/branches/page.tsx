"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import BranchesShell, { BranchesLoading } from "@/components/branches/BranchesShell";
import { Branch, formatBranchLabel, listBranches } from "@/lib/branches";
import { useAdminUser } from "@/lib/useAdminUser";

function formatListValue(values: string[]) {
  if (!values.length) return "Not set";
  if (values.length <= 2) return values.map(formatBranchLabel).join(", ");

  return `${values.slice(0, 2).map(formatBranchLabel).join(", ")} +${values.length - 2}`;
}

export default function BranchesPage() {
  const { user, loading } = useAdminUser();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;

    async function loadBranches() {
      setBranchesLoading(true);
      setError("");

      try {
        const data = await listBranches(search, status);
        setBranches(data.branches);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load branches.");
      } finally {
        setBranchesLoading(false);
      }
    }

    const timeout = window.setTimeout(() => {
      void loadBranches();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [search, status, user]);

  if (loading || !user) return <BranchesLoading />;

  return (
    <BranchesShell user={user}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Branches</h1>
          <p className="mt-1 text-sm text-slate-500">Create and manage operating branches.</p>
        </div>
        <Link href="/dashboard/branches/create" className="bg-blue-900 px-4 py-2 text-sm font-semibold text-white">
          Create Branch
        </Link>
      </div>

      <div className="mb-4 grid gap-4 border border-slate-200 bg-white p-4 md:grid-cols-[1fr_220px]">
       
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder=" Search By Branch Name, Code, City, Email"
            className="mt-2 block h-10 w-full border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
          />
        
     
          <select
            value={status}  
            onChange={(event) => setStatus(event.target.value)}
            className="mt-2 block h-10 w-full border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"

          >
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="CLOSED">Closed</option>
          </select>
       
      </div>

      {error ? <div className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

      <div className="overflow-x-auto border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Location</th>
              <th className="px-4 py-3">Currency</th>
              <th className="px-4 py-3">Services</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {branchesLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading branches...</td></tr>
            ) : branches.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No branches found.</td></tr>
            ) : branches.map((branch) => (
              <tr key={branch._id} className="border-b border-slate-100 last:border-b-0">
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-950">{branch.name}</p>
                  <p className="mt-1 text-xs font-semibold text-blue-900">{branch.code}</p>
                </td>
                <td className="px-4 py-3">{formatBranchLabel(branch.status)}</td>
                <td className="px-4 py-3">
                  <p className="text-slate-700">{branch.address.city || "Not set"}</p>
                  <p className="mt-1 text-xs text-slate-500">{branch.address.countryName || branch.address.countryCode || "Not set"}</p>
                </td>
                <td className="px-4 py-3">{branch.baseCurrency || "Not set"}</td>
                <td className="px-4 py-3 text-slate-600">{formatListValue(branch.operations.supportedServices)}</td>
                <td className="px-4 py-3">
                  <Link href={`/dashboard/branches/${branch._id}`} className="font-semibold text-blue-900 hover:text-blue-700">
                    View
                  </Link>
                  <Link href={`/dashboard/branches/${branch._id}/edit`} className="ml-4 font-semibold text-blue-900 hover:text-blue-700">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </BranchesShell>
  );
}
