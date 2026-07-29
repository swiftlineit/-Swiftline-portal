"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FiArrowLeft, FiDownload, FiRefreshCw } from "react-icons/fi";
import {
  ClientDashboardLoading,
  ClientDashboardShell,
} from "@/components/client/ClientDashboardShell";
import {
  listClientLedger,
  openAuthenticatedFile,
  type CreditLedgerEntry,
} from "@/lib/creditBilling";
import {
  getClientDashboard,
  type ClientDashboardAccount,
} from "@/lib/clientDashboard";
import { formatDashboardDateTime } from "@/lib/dateFormat";
import { useClientUser } from "@/lib/useClientUser";

function money(valueMinor: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(valueMinor / 100);
}

function label(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ""))
    .join(" ");
}

export default function ClientCreditLedgerPage() {
  const { user, loading: userLoading } = useClientUser();
  const router = useRouter();
  const [accounts, setAccounts] = useState<ClientDashboardAccount[]>([]);
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [entries, setEntries] = useState<CreditLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let active = true;
    void (async () => {
      try {
        const dashboard = await getClientDashboard();
        const eligible = dashboard.accounts.filter((item) =>
          ["account_owner", "account_admin", "finance"].includes(
            item.membership.role,
          ),
        );
        const requestedId =
          new URLSearchParams(window.location.search).get(
            "businessAccountId",
          ) || "";
        const selectedId = eligible.some(
          (item) => item.account.id === requestedId,
        )
          ? requestedId
          : (eligible[0]?.account.id ?? "");
        if (!selectedId)
          throw new Error(
            "No business account with financial access was found.",
          );
        const result = await listClientLedger(selectedId);
        if (!active) return;
        setAccounts(eligible);
        setBusinessAccountId(selectedId);
        setEntries(result.entries);
        if (selectedId !== requestedId) {
          router.replace(
            `/client/credit/ledger?businessAccountId=${selectedId}`,
          );
        }
      } catch (caught) {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Account statement could not be loaded.",
          );
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router, user]);

  async function changeAccount(accountId: string) {
    setBusinessAccountId(accountId);
    setLoading(true);
    setError("");
    try {
      const result = await listClientLedger(accountId);
      setEntries(result.entries);
      router.replace(`/client/credit/ledger?businessAccountId=${accountId}`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Account statement could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (userLoading || !user) return <ClientDashboardLoading />;

  return (
    <ClientDashboardShell user={user}>
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href="/client/credit/statements"
              className="text-sm font-semibold flex gap-2 justify text-blue-900"
            >
              <FiArrowLeft /> Back to statements
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">
              Account Statement
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Credit activity and resulting available balances.
            </p>
          </div>
          {businessAccountId ? (
            <button
              type="button"
              onClick={() =>
                void openAuthenticatedFile(
                  `/api/v1/client/credit/ledger/export?businessAccountId=${businessAccountId}`,
                  "credit-account-statement.csv",
                )
              }
              className="inline-flex h-10 items-center rounded-4xl gap-2 border border-slate-300 bg-white px-4 text-sm font-semibold text-blue-900"
            >
              <FiDownload /> Export CSV
            </button>
          ) : null}
        </div>
        {accounts.length > 1 ? (
          <select
            value={businessAccountId}
            onChange={(event) => void changeAccount(event.target.value)}
            className="h-11 w-full max-w-md border border-slate-300 bg-white px-3 text-sm font-semibold"
          >
            {accounts.map((account) => (
              <option key={account.account.id} value={account.account.id}>
                {account.account.company.companyName} (
                {account.account.accountId})
              </option>
            ))}
          </select>
        ) : null}
        {error ? (
          <div
            role="alert"
            className="border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </div>
        ) : null}
        <section className="overflow-x-auto border border-slate-200 bg-white rounded-2xl">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Activity</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">Available Credit</th>
                <th className="px-4 py-3 text-right">Customer Advance</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-4 py-4 text-slate-600">
                    {formatDashboardDateTime(entry.createdAt)}
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-semibold text-slate-900">
                      {label(entry.type)}
                    </p>
                    <p className="mt-1 max-w-md text-xs text-slate-500">
                      {entry.description}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-slate-700">
                    {entry.reference}
                  </td>
                  <td className="px-4 py-4 text-right font-semibold">
                    {money(entry.amountMinor)}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {money(entry.availableCreditAfterMinor)}
                  </td>
                  <td className="px-4 py-4 text-right">
                    {money(entry.availableAdvanceAfterMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading ? (
            <p className="p-10 text-center text-sm font-semibold text-slate-500">
              <FiRefreshCw className="mr-2 inline animate-spin" />
              Loading account statement...
            </p>
          ) : null}
          {!loading && !entries.length ? (
            <p className="p-10 text-center text-sm text-slate-500">
              No credit activity has been recorded.
            </p>
          ) : null}
        </section>
      </div>
    </ClientDashboardShell>
  );
}
