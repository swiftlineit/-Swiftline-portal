"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FiAlertTriangle, FiArrowRight, FiCheckCircle, FiSearch,FiChevronDown } from "react-icons/fi";
import { ClientDashboardLoading } from "@/components/client/ClientDashboardShell";
import { getClientDashboard } from "@/lib/clientDashboard";
import {
  listClientActions,
  listClientExceptions,
  severityStyles,
  type ClientAction,
  type ShipmentException
} from "@/lib/clientOverview";
import { formatDashboardDateTime } from "@/lib/dateFormat";
import { useClientUser } from "@/lib/useClientUser";

/**
 * The Exceptions centre and Action Required, which are the same feed split by
 * who has to do something: Swiftline, or the customer.
 *
 * Both resolve their own account rather than taking one from a parent, so each
 * page works when opened directly from a notification or a bookmark.
 */

function useAccountId() {
  const [accountId, setAccountId] = useState("");
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let active = true;

    getClientDashboard()
      .then((dashboard) => {
        if (!active) return;
        const account = dashboard.accounts.find((item) => item.dashboardAccess.state === "READY")
          ?? dashboard.accounts[0];
        setAccountId(account?.account.id ?? "");
      })
      .catch(() => undefined)
      .finally(() => { if (active) setResolved(true); });

    return () => { active = false; };
  }, []);

  return { accountId, resolved };
}

function PageHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </div>
  );
}

function LoadError({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
      <FiAlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      {message}
    </p>
  );
}

function TableSkeleton({ columns }: { columns: number }) {
  return (
    <>
      {[0, 1, 2, 3].map((row) => (
        <tr key={row} className="border-b border-slate-100 last:border-b-0">
          {Array.from({ length: columns }, (_, cell) => (
            <td key={cell} className="px-4 py-4">
              <div className="h-3 w-full animate-pulse rounded bg-slate-100" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ── Exceptions ────────────────────────────────────────────────────────────────

export function ClientExceptionsPage() {
  const { user, loading } = useClientUser();
  const { accountId, resolved } = useAccountId();
  const [exceptions, setExceptions] = useState<ShipmentException[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!accountId) return;
    let active = true;

    listClientExceptions({ businessAccountId: accountId })
      .then((result) => {
        if (!active) return;
        setExceptions(result.exceptions);
        setCounts(result.exceptionCountsByType);
        setError("");
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Exceptions could not be loaded.");
      })
      .finally(() => { if (active) setBusy(false); });

    return () => { active = false; };
  }, [accountId]);

  if (loading || !user) return <ClientDashboardLoading />;

  const term = search.trim().toLowerCase();
  const visible = exceptions.filter((item) => {
    if (typeFilter && item.type !== typeFilter) return false;
    if (!term) return true;
    return item.awb.toLowerCase().includes(term) || item.problem.toLowerCase().includes(term);
  });

  const showEmpty = resolved && !busy && !visible.length;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        title="Exceptions"
        description="Shipments that have stopped moving normally, and what Swiftline is doing about each one."
      />

      {error ? <div className="mb-5"><LoadError message={error} /></div> : null}

      <div className="mb-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-[minmax(0,1fr)_260px]">
        <label className="relative">
          <span className="sr-only">Search exceptions</span>
          <FiSearch aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search AWB or problem"
            className="h-10 w-full rounded-xl border border-slate-300 pl-10 pr-3 text-sm outline-none focus:border-blue-900"
          />
        </label>
     <div className="relative">
  <select
    value={typeFilter}
    onChange={(event) => setTypeFilter(event.target.value)}
    className="h-10 w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-10 text-sm"
  >
    <option value="">All exception types</option>

    {Object.entries(counts).map(([type, count]) => (
      <option key={type} value={type}>
        {type
          .replaceAll("_", " ")
          .toLowerCase()
          .replace(/\b\w/g, (c) => c.toUpperCase())}{" "}
        ({count})
      </option>
    ))}
  </select>

  <FiChevronDown
    aria-hidden="true"
    className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
  />
</div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-215 text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase text-slate-500">
              <th className="px-4 py-3">AWB</th>
              <th className="px-4 py-3">Problem</th>
              <th className="px-4 py-3">Last update</th>
              <th className="px-4 py-3">Required action</th>
              <th className="px-4 py-3 text-right">Details</th>
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <TableSkeleton columns={5} />
            ) : showEmpty ? (
              <tr>
                <td colSpan={5} className="px-4 py-14 text-center">
                  <FiCheckCircle aria-hidden="true" className="mx-auto h-8 w-8 text-emerald-500" />
                  <p className="mt-3 text-sm font-semibold text-slate-800">
                    {exceptions.length ? "No exceptions match this filter" : "No exceptions right now"}
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                    {exceptions.length
                      ? "Clear the search or type filter to see the rest."
                      : "Every shipment is moving normally. Customs holds, address problems, failed delivery attempts and returns all appear here the moment they happen."}
                  </p>
                </td>
              </tr>
            ) : (
              visible.map((item) => {
                const tone = severityStyles[item.severity];
                return (
                  <tr key={item.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <span className="font-semibold text-slate-900">{item.awb || "—"}</span>
                      <span className={`mt-1 block w-fit rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${tone.chip}`}>
                        {item.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{item.problem}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                      {formatDashboardDateTime(item.lastUpdateAt)}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{item.requiredAction}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={item.href}
                        className="inline-flex items-center gap-1 rounded-4xl border border-[#0D1282]/30 px-3 py-1.5 text-xs font-semibold text-[#0D1282] transition hover:bg-[#0D1282]/5"
                      >
                        View
                        <FiArrowRight aria-hidden="true" className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Action Required ───────────────────────────────────────────────────────────

export function ClientActionsPage() {
  const { user, loading } = useClientUser();
  const { accountId, resolved } = useAccountId();
  const [actions, setActions] = useState<ClientAction[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!accountId) return;
    let active = true;

    listClientActions({ businessAccountId: accountId })
      .then((result) => {
        if (!active) return;
        setActions(result.actions);
        setError("");
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Actions could not be loaded.");
      })
      .finally(() => { if (active) setBusy(false); });

    return () => { active = false; };
  }, [accountId]);

  if (loading || !user) return <ClientDashboardLoading />;

  return (
    <div className="mx-auto max-w-8xl">
      <PageHeading
        title="Action Required"
        description="Everything waiting on you. Each one can be cleared from here."
      />

      {error ? <div className="mb-5"><LoadError message={error} /></div> : null}

      {busy ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((row) => (
            <div key={row} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100" />
              <div className="mt-3 h-3 w-2/3 animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      ) : resolved && !actions.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center">
          <FiCheckCircle aria-hidden="true" className="mx-auto h-10 w-10 text-emerald-500" />
          <p className="mt-4 text-base font-semibold text-slate-900">Nothing is waiting on you</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            When customs asks for a document, an address needs confirming, an invoice falls due, or
            a claim or ticket needs your reply, it appears here with the control that clears it.
          </p>
          <Link
            href="/client/shipments"
            className="mt-6 inline-flex h-10 items-center rounded-4xl bg-blue-950 px-5 text-sm font-semibold text-white transition hover:bg-blue-900"
          >
            View my shipments
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {actions.map((action) => {
            const tone = severityStyles[action.severity];
            return (
              <li
                key={action.id}
                className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center"
              >
                <span aria-hidden="true" className={`hidden h-10 w-1 shrink-0 rounded-full sm:block ${tone.bar}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900">{action.label}</p>
                    {action.awb ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                        {action.awb}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{action.detail}</p>
                </div>
                <Link
                  href={action.href}
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-4xl bg-blue-950 px-4 text-sm font-semibold text-white transition hover:bg-blue-900"
                >
                  {action.actionLabel}
                  <FiArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
