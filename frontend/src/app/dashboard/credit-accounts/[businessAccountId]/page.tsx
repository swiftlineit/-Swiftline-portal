"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FiDownload, FiRefreshCw } from "react-icons/fi";
import DashboardShell, { DashboardLoading } from "@/components/DashboardShell";
import CreditSummaryCards from "@/components/credit/CreditSummaryCards";
import CreditRestrictionAlert from "@/components/credit/CreditRestrictionAlert";
import {
  closeAdminCycle,
  listAdminCreditPayments,
  listAdminLedger,
  listAdminStatements,
  openAuthenticatedFile,
  recordAdminOfflinePayment,
  verifyAdminOfflinePayment,
  type CreditLedgerEntry,
  type CreditPayment,
  type CreditStatement
} from "@/lib/creditBilling";
import { getAdminCreditAccount, type CreditAccount } from "@/lib/creditAccounts";
import { formatDashboardDate, formatDashboardDateTime } from "@/lib/dateFormat";
import { useAdminUser } from "@/lib/useAdminUser";

function money(valueMinor: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(valueMinor / 100);
}

function title(value: string) {
  return value.toLowerCase().split("_")
    .map((word) => word ? word[0].toUpperCase() + word.slice(1) : "")
    .join(" ");
}

export default function AdminCreditAccountDetailPage() {
  const { user, loading: userLoading } = useAdminUser();
  const params = useParams<{ businessAccountId: string }>();
  const accountId = params.businessAccountId;
  const [account, setAccount] = useState<CreditAccount | null>(null);
  const [statements, setStatements] = useState<CreditStatement[]>([]);
  const [payments, setPayments] = useState<CreditPayment[]>([]);
  const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);
  const [statementId, setStatementId] = useState("");
  const [amountRupees, setAmountRupees] = useState("");
  const [method, setMethod] = useState<"BANK_TRANSFER" | "UPI" | "CASH" | "CHEQUE">("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [accountResult, statementResult, paymentResult, ledgerResult] = await Promise.all([
      getAdminCreditAccount(accountId),
      listAdminStatements(accountId),
      listAdminCreditPayments(accountId),
      listAdminLedger(accountId)
    ]);
    setAccount(accountResult.creditAccount);
    setStatements(statementResult.statements);
    setPayments(paymentResult.payments);
    setLedger(ledgerResult.entries);
    const unpaid = statementResult.statements.find((item) => item.outstandingAmountMinor > 0);
    setStatementId((current) => current || unpaid?.id || "");
    setAmountRupees((current) => current || (unpaid ? String(unpaid.outstandingAmountMinor / 100) : ""));
  }, [accountId]);

  useEffect(() => {
    if (!user) return;
    const initialLoad = window.setTimeout(() => {
      void load()
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Credit account could not be loaded."))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(initialLoad);
  }, [load, user]);

  async function closeCycle() {
    setBusy("cycle");
    setError("");
    setMessage("");
    try {
      const result = await closeAdminCycle(accountId);
      setMessage(result.message);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Billing cycle could not be closed.");
    } finally {
      setBusy("");
    }
  }

  async function recordPayment(event: FormEvent) {
    event.preventDefault();
    const amountMinor = Math.round(Number(amountRupees) * 100);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      setError("Enter a valid payment amount.");
      return;
    }
    if (reference.trim().length < 3) {
      setError("Enter the offline payment reference.");
      return;
    }
    setBusy("payment");
    setError("");
    setMessage("");
    try {
      const result = await recordAdminOfflinePayment(accountId, {
        requestedStatementId: statementId,
        amountMinor,
        method,
        externalReference: reference.trim(),
        notes: notes.trim()
      });
      setMessage(result.message);
      setReference("");
      setNotes("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Offline payment could not be recorded.");
    } finally {
      setBusy("");
    }
  }

  async function verify(paymentId: string) {
    setBusy(paymentId);
    setError("");
    setMessage("");
    try {
      const result = await verifyAdminOfflinePayment(accountId, paymentId);
      setMessage(result.message);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Offline payment could not be verified.");
    } finally {
      setBusy("");
    }
  }

  if (userLoading || !user) return <DashboardLoading />;

  return (
    <DashboardShell user={user}>
      <div className="mx-auto max-w-[1500px] space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/dashboard/credit-accounts" className="text-sm font-semibold text-blue-900">Back to credit accounts</Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">{account?.businessAccount?.companyName || "Credit Account"}</h1>
            <p className="mt-1 text-sm text-slate-500">{account?.businessAccount?.accountId}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void openAuthenticatedFile(`/api/v1/credit-accounts/${accountId}/ledger/export`, "credit-account-statement.csv")} className="inline-flex h-10 items-center gap-2 border border-slate-300 bg-white px-4 text-sm font-semibold text-blue-900"><FiDownload /> Export Ledger</button>
            <button type="button" onClick={() => void closeCycle()} disabled={busy === "cycle"} className="inline-flex h-10 items-center gap-2 bg-blue-900 px-4 text-sm font-semibold text-white disabled:opacity-60"><FiRefreshCw className={busy === "cycle" ? "animate-spin" : ""} /> Close Completed Cycle</button>
          </div>
        </div>
        {error ? <div role="alert" className="border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
        {message ? <div role="status" className="border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div> : null}
        {loading ? <div className="p-10 text-center text-sm font-semibold text-slate-500">Loading credit account...</div> : null}
        {account ? <CreditSummaryCards account={account} /> : null}
        {account ? (
          <CreditRestrictionAlert
            restriction={account.restriction}
            gracePeriodDays={account.gracePeriodDays}
          />
        ) : null}

        <section className="overflow-x-auto border border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-5"><h2 className="font-semibold text-slate-950">Billing Statements</h2><p className="mt-1 text-sm text-slate-500">Finalized shipment invoices grouped by completed billing period.</p></div>
          <table className="min-w-full text-left text-sm"><thead className="bg-slate-100 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Statement</th><th className="px-4 py-3">Period</th><th className="px-4 py-3">Due</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Outstanding</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th></tr></thead>
            <tbody>{statements.map((statement) => <tr key={statement.id} className="border-t border-slate-100"><td className="px-4 py-4 font-semibold">{statement.statementNumber}</td><td className="px-4 py-4 text-slate-600">{formatDashboardDate(statement.periodStart)} to {formatDashboardDate(new Date(new Date(statement.periodEnd).getTime() - 1).toISOString())}</td><td className="px-4 py-4">{formatDashboardDate(statement.dueAt)}</td><td className="px-4 py-4 text-right">{money(statement.totalAmountMinor)}</td><td className="px-4 py-4 text-right font-semibold">{money(statement.outstandingAmountMinor)}</td><td className="px-4 py-4">{title(statement.status)}</td><td className="px-4 py-4 text-right"><Link href={`/dashboard/credit-accounts/${accountId}/statements/${statement.id}`} className="font-semibold text-blue-900">View</Link></td></tr>)}</tbody>
          </table>
          {!statements.length && !loading ? <p className="p-8 text-center text-sm text-slate-500">No billing statements yet.</p> : null}
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="overflow-x-auto border border-slate-200 bg-white">
            <div className="border-b border-slate-200 p-5"><h2 className="font-semibold text-slate-950">Payment Reconciliation</h2><p className="mt-1 text-sm text-slate-500">Verify submitted offline payments and review applied payments.</p></div>
            <table className="min-w-full text-left text-sm"><thead className="bg-slate-100 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Payment</th><th className="px-4 py-3">Method</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th></tr></thead>
              <tbody>{payments.map((payment) => <tr key={payment.id} className="border-t border-slate-100"><td className="px-4 py-4"><p className="font-semibold">{payment.internalReference}</p><p className="mt-1 text-xs text-slate-500">{formatDashboardDateTime(payment.createdAt)}{payment.externalReference ? ` | ${payment.externalReference}` : ""}</p></td><td className="px-4 py-4">{title(payment.method)}</td><td className="px-4 py-4 text-right font-semibold">{money(payment.amountMinor)}</td><td className="px-4 py-4">{title(payment.status)}</td><td className="px-4 py-4 text-right">{payment.status === "PENDING_VERIFICATION" ? <button type="button" onClick={() => void verify(payment.id)} disabled={busy === payment.id} className="h-8 bg-emerald-600 px-3 font-semibold text-white disabled:opacity-60">Verify</button> : null}</td></tr>)}</tbody>
            </table>
            {!payments.length ? <p className="p-8 text-center text-sm text-slate-500">No statement payments recorded.</p> : null}
          </div>

          <form onSubmit={recordPayment} className="h-fit border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-950">Record Offline Payment</h2>
            <p className="mt-1 text-sm text-slate-500">Admin-recorded payments are verified and allocated immediately.</p>
            <label className="mt-4 block text-sm font-semibold text-slate-700">Statement<select value={statementId} onChange={(event) => { setStatementId(event.target.value); const selected = statements.find((item) => item.id === event.target.value); if (selected) setAmountRupees(String(selected.outstandingAmountMinor / 100)); }} className="mt-2 h-11 w-full border border-slate-300 bg-white px-3 font-normal"><option value="">Oldest outstanding first</option>{statements.filter((item) => item.outstandingAmountMinor > 0).map((item) => <option key={item.id} value={item.id}>{item.statementNumber} - {money(item.outstandingAmountMinor)}</option>)}</select></label>
            <label className="mt-4 block text-sm font-semibold text-slate-700">Amount (INR)<input type="number" min="0.01" step="0.01" value={amountRupees} onChange={(event) => setAmountRupees(event.target.value)} className="mt-2 h-11 w-full border border-slate-300 px-3 font-normal" /></label>
            <label className="mt-4 block text-sm font-semibold text-slate-700">Method<select value={method} onChange={(event) => setMethod(event.target.value as typeof method)} className="mt-2 h-11 w-full border border-slate-300 bg-white px-3 font-normal"><option value="BANK_TRANSFER">Bank Transfer</option><option value="UPI">UPI</option><option value="CASH">Cash</option><option value="CHEQUE">Cheque</option></select></label>
            <label className="mt-4 block text-sm font-semibold text-slate-700">Reference<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="UTR, receipt or cheque number" className="mt-2 h-11 w-full border border-slate-300 px-3 font-normal" /></label>
            <label className="mt-4 block text-sm font-semibold text-slate-700">Note<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-2 w-full border border-slate-300 p-3 font-normal" /></label>
            <button disabled={busy === "payment"} className="mt-4 h-10 bg-blue-900 px-5 text-sm font-semibold text-white disabled:opacity-60">{busy === "payment" ? "Applying..." : "Record and Apply"}</button>
          </form>
        </section>

        <section className="overflow-x-auto border border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-5"><h2 className="font-semibold text-slate-950">Credit Ledger</h2><p className="mt-1 text-sm text-slate-500">Latest financial movements and resulting balances.</p></div>
          <table className="min-w-full text-left text-sm"><thead className="bg-slate-100 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Activity</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3 text-right">Available Credit</th><th className="px-4 py-3 text-right">Advance</th></tr></thead>
            <tbody>{ledger.slice(0, 50).map((entry) => <tr key={entry.id} className="border-t border-slate-100"><td className="whitespace-nowrap px-4 py-4">{formatDashboardDateTime(entry.createdAt)}</td><td className="px-4 py-4"><p className="font-semibold">{title(entry.type)}</p><p className="mt-1 max-w-md text-xs text-slate-500">{entry.description}</p></td><td className="px-4 py-4">{entry.reference}</td><td className="px-4 py-4 text-right font-semibold">{money(entry.amountMinor)}</td><td className="px-4 py-4 text-right">{money(entry.availableCreditAfterMinor)}</td><td className="px-4 py-4 text-right">{money(entry.availableAdvanceAfterMinor)}</td></tr>)}</tbody>
          </table>
        </section>
      </div>
    </DashboardShell>
  );
}
