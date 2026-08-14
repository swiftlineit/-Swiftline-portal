"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { FiAlertTriangle, FiChevronDown, FiClock, FiRefreshCw, FiSearch } from "react-icons/fi";
import { DashboardLoading } from "@/components/DashboardShell";
import { ClaimStatusBadge } from "@/components/claims/ClaimStatusBadge";
import { formatDashboardDate, formatDashboardDateTime } from "@/lib/dateFormat";
import {
  claimLabel,
  formatClaimAmount,
  claimListPath,
  listStaffClaims,
  claimCategories,
  type ClaimStatus,
  type StaffQueueClaim
} from "@/lib/claims";
import { TableToolbar } from "@/components/ui/TableToolbar";
import { CLAIMS_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";



const queueStatuses: ClaimStatus[] = [
  "SUBMITTED",
  "DOCUMENTS_PENDING",
  "UNDER_REVIEW",
  "NEEDS_INFORMATION",
  "SUBMITTED_TO_CARRIER",
  "PENDING_APPROVAL",
  "DECIDED",
  "PAYMENT_PROCESSING",
  "SETTLED",
  "CLOSED"
];

/** One styled select, so five filters do not repeat the same chevron markup. */
function Dropdown({
  value,
  onChange,
  placeholder,
  children
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="appearance-none rounded-xl border border-slate-300 bg-white py-2.5 pl-4 pr-10 text-sm font-semibold text-slate-700"
      >
        <option value="">{placeholder}</option>
        {children}
      </select>
      <FiChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

/** Statuses where the next move is Swiftline's rather than the client's. */
const actionOnUs: ClaimStatus[] = ["SUBMITTED", "UNDER_REVIEW", "PENDING_APPROVAL", "PAYMENT_PROCESSING"];

export default function StaffClaimsPage() {
  const { user, loading } = useAdminUser(CLAIMS_AREA);
  const [claims, setClaims] = useState<StaffQueueClaim[]>([]);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [outcome, setOutcome] = useState("");
  const [mineOnly, setMineOnly] = useState(false);
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setDataLoading(true);
    setError("");
    try {
      setClaims(
        await listStaffClaims({
          status,
          search: search.trim() || undefined,
          category: category || undefined,
          decisionOutcome: outcome || undefined,
          assignedTo: mineOnly ? "me" : unassignedOnly ? "unassigned" : undefined,
          slaOverdue: overdueOnly ? "1" : undefined
        })
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Claims could not be loaded.");
    } finally {
      setDataLoading(false);
    }
  }, [status, search, category, outcome, mineOnly, unassignedOnly, overdueOnly]);

  useEffect(() => {
    if (user) void Promise.resolve().then(load);
  }, [user, load]);

  if (loading || !user) return <DashboardLoading />;

  const awaitingUs = claims.filter((claim) => actionOnUs.includes(claim.status)).length;
  const overdue = claims.filter(
    (claim) =>
      claim.deadlines?.internalReviewDueAt &&
      new Date(claim.deadlines.internalReviewDueAt) < new Date() &&
      !["SETTLED", "CLOSED", "WITHDRAWN"].includes(claim.status)
  ).length;
  const lateFilings = claims.filter((claim) => claim.filedLate).length;

  return (
    <div className="mx-auto max-w-[1600px]">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Claims</h1>
          <p className="mt-1 text-sm text-slate-500">
            Compensation claims for lost, damaged, short, and tampered shipments.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-10 items-center gap-2 rounded-4xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <FiRefreshCw />
          Refresh
        </button>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Waiting on us", value: awaitingUs, tone: "border-blue-200 bg-blue-50 text-blue-900" },
          { label: "SLA overdue", value: overdue, tone: "border-red-200 bg-red-50 text-red-800" },
          { label: "Filed late", value: lateFilings, tone: "border-amber-200 bg-amber-50 text-amber-900" }
        ].map((tile) => (
          <div key={tile.label} className={`rounded-2xl border p-4 ${tile.tone}`}>
            <p className="text-xs font-semibold uppercase tracking-wide">{tile.label}</p>
            <p className="mt-1 text-2xl font-bold">{tile.value}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Matched as a prefix on both numbers, so a handler can type the last
            few digits they remember rather than the whole reference. */}
        <div className="relative">
          <FiSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Claim or tracking number"
            className="w-64 rounded-xl border border-slate-300 py-2.5 pl-10 pr-4 text-sm"
          />
        </div>

        <Dropdown value={status} onChange={setStatus} placeholder="All statuses">
          {queueStatuses.map((value) => (
            <option key={value} value={value}>
              {claimLabel(value)}
            </option>
          ))}
        </Dropdown>

        <Dropdown value={category} onChange={setCategory} placeholder="All types">
          {claimCategories.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Dropdown>

        <Dropdown value={outcome} onChange={setOutcome} placeholder="Any outcome">
          <option value="FULLY_APPROVED">Approved in full</option>
          <option value="PARTIALLY_APPROVED">Approved in part</option>
          <option value="REJECTED">Rejected</option>
        </Dropdown>

        <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(event) => {
              setMineOnly(event.target.checked);
              // Mutually exclusive: a claim cannot be both mine and unassigned.
              if (event.target.checked) setUnassignedOnly(false);
            }}
            className="h-4 w-4"
          />
          Assigned to me
        </label>

        <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={unassignedOnly}
            onChange={(event) => {
              setUnassignedOnly(event.target.checked);
              if (event.target.checked) setMineOnly(false);
            }}
            className="h-4 w-4"
          />
          Unassigned
        </label>

        <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(event) => setOverdueOnly(event.target.checked)}
            className="h-4 w-4"
          />
          SLA overdue
        </label>
      </div>

      {error ? (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {/* The queue's own filters, so the file matches the reviewer's view. */}
      <div className="mb-3">
        <TableToolbar
          exportPath={claimListPath("staff")}
          exportParams={new URLSearchParams(Object.entries({
            status,
            search: search.trim(),
            category,
            decisionOutcome: outcome,
            assignedTo: mineOnly ? "me" : unassignedOnly ? "unassigned" : "",
            slaOverdue: overdueOnly ? "1" : ""
          }).filter(([, value]) => value) as Array<[string, string]>)}
          exportName="claims"
        />
      </div>

      {dataLoading ? (
        <div className="border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">
          Loading claims...
        </div>
      ) : claims.length === 0 ? (
        <div className="border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="font-semibold text-slate-900">No claims match these filters</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs font-semibold uppercase text-slate-600">
              <tr>
                <th className="px-4 py-3">Claim</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Branch</th>
                <th className="px-4 py-3">Tracking</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Claimed</th>
                <th className="px-4 py-3 text-right">Declared</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Handler</th>
                <th className="px-4 py-3">Review due</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {claims.map((claim) => {
                const declared = claim.shipmentSnapshot?.totalDeclaredValueMinor;
                // Highlighted because approving above the declared value is the
                // decision most likely to be questioned later.
                const overDeclared =
                  claim.requestedAmountMinor !== undefined &&
                  declared !== undefined &&
                  claim.requestedAmountMinor > declared;
                const due = claim.deadlines?.internalReviewDueAt;
                const isOverdue =
                  due &&
                  new Date(due) < new Date() &&
                  !["SETTLED", "CLOSED", "WITHDRAWN"].includes(claim.status);

                return (
                  <tr key={claim.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {claim.claimNumber ?? "Draft"}
                      {claim.filedLate ? (
                        <span
                          className="ml-2 inline-flex items-center text-amber-600"
                          title="Filed after the usual window"
                        >
                          <FiAlertTriangle />
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {claim.businessAccountName || "—"}
                      {claim.businessAccountCode ? (
                        <span className="block text-xs text-slate-400">
                          {claim.businessAccountCode}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{claim.branchName || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {claim.shipmentSnapshot?.trackingNumber || "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{claimLabel(claim.category)}</td>
                    <td
                      className={`px-4 py-3 text-right font-medium ${
                        overDeclared ? "text-amber-700" : "text-slate-900"
                      }`}
                    >
                      {formatClaimAmount(claim.requestedAmountMinor)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      {formatClaimAmount(declared)}
                    </td>
                    <td className="px-4 py-3">
                      <ClaimStatusBadge status={claim.status} decisionOutcome={claim.decisionOutcome} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {claim.assignedToName || (
                        <span className="text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {due ? (
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                            isOverdue ? "text-red-700" : "text-slate-500"
                          }`}
                        >
                          {isOverdue ? <FiClock /> : null}
                          {formatDashboardDate(due)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {formatDashboardDateTime(claim.updatedAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/dashboard/claims/${claim.id}`}
                        className="font-semibold text-blue-900 hover:underline"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
