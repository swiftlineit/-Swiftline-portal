"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FiChevronRight, FiSearch } from "react-icons/fi";
import { getBranchUsers, type BranchUserRow, type BranchUsersResult } from "@/lib/branchReporting";
import { formatDashboardDateTime } from "@/lib/dateFormat";
import { roleLabels, type PortalRole } from "@/lib/roles";

const businessRoleLabels: Record<string, string> = {
  account_owner: "Account Owner",
  account_admin: "Account Administrator",
  operations: "Business Operations",
  finance: "Business Finance",
  tracking_only: "Tracking Only"
};

const kindLabels: Record<BranchUserRow["kind"], string> = {
  BUSINESS_ACCOUNT: "Business Account",
  INTERNAL_STAFF: "Internal Staff",
  ADMINISTRATOR: "Administrator"
};

const accessLabels: Record<BranchUserRow["branchAccess"], string> = {
  ASSIGNED: "Assigned",
  INHERITED: "Account default",
  GLOBAL: "All branches"
};

function statusTone(status: string) {
  switch (status) {
    case "active": return "bg-emerald-50 text-emerald-700";
    case "invited": return "bg-blue-50 text-blue-700";
    case "suspended": return "bg-amber-50 text-amber-700";
    case "disabled": return "bg-red-50 text-red-700";
    default: return "bg-slate-100 text-slate-700";
  }
}

function roleLabel(user: BranchUserRow) {
  return user.kind === "BUSINESS_ACCOUNT"
    ? businessRoleLabels[user.role] ?? user.role.replaceAll("_", " ")
    : roleLabels[user.role as PortalRole] ?? user.role;
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-lg font-bold text-[#0D1282]">{value}</p>
    </div>
  );
}

export default function BranchUsersSection({
  branchId,
  viewerRole
}: {
  branchId: string;
  viewerRole: PortalRole;
}) {
  const [result, setResult] = useState<BranchUsersResult | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function loadUsers() {
      setLoading(true);
      setError("");
      try {
        const data = await getBranchUsers(branchId);
        if (active) setResult(data);
      } catch (caughtError) {
        if (active) setError(caughtError instanceof Error ? caughtError.message : "Branch users could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadUsers();
    return () => { active = false; };
  }, [branchId]);

  const query = search.trim().toLowerCase();
  const users = (result?.users ?? []).filter((user) => !query || [
    user.name,
    user.email,
    user.phone,
    user.organization,
    roleLabel(user),
    kindLabels[user.kind]
  ].some((value) => value.toLowerCase().includes(query)));

  return (
    <section className="space-y-5">
      {result ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryCard label="All Users" value={result.totals.all} />
          <SummaryCard label="Business Users" value={result.totals.businessAccounts} />
          <SummaryCard label="Internal Staff" value={result.totals.internalStaff} />
          <SummaryCard label="Global Admins" value={result.totals.administrators} />
          <SummaryCard label="Active / Inactive" value={`${result.totals.active} / ${result.totals.inactive}`} />
        </div>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-[#0D1282]">Branch Users</h2>
            <p className="mt-1 text-sm text-slate-500">Business-account members, assigned staff and administrators with global access.</p>
          </div>
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Search branch users</span>
            <FiSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, company or role"
              className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#0D1282]"
            />
          </label>
        </div>

        {error ? (
          <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">{error}</div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Name and Contact</th>
                <th className="px-4 py-3">User Type</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Company / Designation</th>
                <th className="px-4 py-3">Branch Access</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Login</th>
                <th className="px-4 py-3 text-right">Record</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">Loading branch users…</td></tr>
              ) : users.length ? users.map((user) => {
                const href = user.kind === "BUSINESS_ACCOUNT"
                  ? `/dashboard/business-accounts/${encodeURIComponent(user.detailId)}`
                  : `/dashboard/users/${encodeURIComponent(user.detailId)}`;
                const canOpenRecord = user.kind === "BUSINESS_ACCOUNT"
                  ? viewerRole === "admin" || viewerRole === "operations"
                  : viewerRole === "admin" || viewerRole === "hr";
                return (
                  <tr key={`${user.kind}-${user.id}`} className="border-b border-slate-100 align-middle last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{user.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{user.email}</p>
                      {user.phone ? <p className="text-xs text-slate-500">{user.phone}</p> : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{kindLabels[user.kind]}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">{roleLabel(user)}</td>
                    <td className="px-4 py-3 text-slate-700">
                      <p>{user.organization || "—"}</p>
                      {user.accountId ? <p className="text-xs text-slate-500">{user.accountId}</p> : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">{accessLabels[user.branchAccess]}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusTone(user.accessStatus)}`}>
                          {user.accessStatus}
                        </span>
                        {user.loginStatus !== user.accessStatus ? (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${statusTone(user.loginStatus)}`}>
                            Login {user.loginStatus}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {user.lastLogin ? formatDashboardDateTime(user.lastLogin) : "Never"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canOpenRecord ? (
                        <Link href={href} className="inline-flex items-center gap-1 font-semibold text-[#0D1282] hover:underline">
                          View <FiChevronRight className="h-4 w-4" />
                        </Link>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">No branch users match this search.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
