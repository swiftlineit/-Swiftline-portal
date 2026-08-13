"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FiAlertTriangle, FiChevronDown, FiPlus, FiShield } from "react-icons/fi";
import { ClientDashboardLoading } from "@/components/client/ClientDashboardShell";
import ClaimTable from "@/components/claims/ClaimTable";
import { claimLabel, listClaims, type Claim, type ClaimStatus } from "@/lib/claims";
import { useClientUser } from "@/lib/useClientUser";

/** Statuses worth filtering by. The full set is long and mostly internal. */
const filterableStatuses: ClaimStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "DOCUMENTS_PENDING",
  "UNDER_REVIEW",
  "NEEDS_INFORMATION",
  "DECIDED",
  "PAYMENT_PROCESSING",
  "SETTLED",
  "CLOSED"
];

/** Statuses where the claim is waiting on the client rather than on Swiftline. */
const awaitingClient: ClaimStatus[] = ["DRAFT", "DOCUMENTS_PENDING", "NEEDS_INFORMATION"];

export default function ClientClaimsPage() {
  const { user, loading } = useClientUser();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [status, setStatus] = useState("");
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setDataLoading(true);
    setError("");
    try {
      setClaims(await listClaims("client", { status }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Claims could not be loaded.");
    } finally {
      setDataLoading(false);
    }
  }, [status]);

  useEffect(() => {
    // Deferred off the effect body so the first state update lands in its own
    // render rather than cascading, matching the other client list pages.
    if (user) void Promise.resolve().then(load);
  }, [user, load]);

  if (loading || !user) return <ClientDashboardLoading />;

  const needsAttention = claims.filter((claim) => awaitingClient.includes(claim.status));
  const decisionToAccept = claims.filter(
    (claim) => claim.status === "DECIDED" && claim.acceptanceState === "PENDING"
  );

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Claims</h1>
          <p className="mt-1 text-sm text-slate-500">
            Raise and track compensation claims for shipments that were lost, damaged, short, or
            tampered with.
          </p>
        </div>
        <Link
          href="/client/claims/new"
          className="inline-flex items-center gap-2 rounded-xl bg-blue-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800"
        >
          <FiPlus />
          Raise a claim
        </Link>
      </div>

      {/* Surfaced above the table because a claim waiting on the client is the
          single most common reason one stalls. */}
      {decisionToAccept.length > 0 ? (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-teal-200 bg-teal-50 p-4">
          <FiShield className="mt-0.5 shrink-0 text-teal-700" />
          <p className="text-sm text-teal-900">
            <span className="font-semibold">
              {decisionToAccept.length} claim{decisionToAccept.length === 1 ? "" : "s"} awaiting your
              response.
            </span>{" "}
            A decision has been issued and needs to be accepted before payment can be arranged.
          </p>
        </div>
      ) : null}

      {needsAttention.length > 0 ? (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <FiAlertTriangle className="mt-0.5 shrink-0 text-amber-700" />
          <p className="text-sm text-amber-900">
            <span className="font-semibold">
              {needsAttention.length} claim{needsAttention.length === 1 ? "" : "s"} need your input.
            </span>{" "}
            Documents or information are outstanding.
          </p>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="appearance-none rounded-xl border border-slate-300 bg-white py-2.5 pl-4 pr-10 text-sm font-semibold text-slate-700"
          >
            <option value="">All statuses</option>
            {filterableStatuses.map((value) => (
              <option key={value} value={value}>
                {claimLabel(value)}
              </option>
            ))}
          </select>
          <FiChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <ClaimTable claims={claims} loading={dataLoading} />
    </div>
  );
}
