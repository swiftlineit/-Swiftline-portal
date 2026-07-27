"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FiDownload, FiRefreshCw,FiChevronDown  } from "react-icons/fi";
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
  writeOffAdminStatement,
  type CreditLedgerEntry,
  type CreditPayment,
  type CreditStatement
} from "@/lib/creditBilling";
import {
  closeCreditAccount,
  getAdminCreditAccount,
  reactivateCreditAccount,
  suspendCreditAccount,
  type CreditAccount
} from "@/lib/creditAccounts";
import { formatDashboardDate, formatDashboardDateTime } from "@/lib/dateFormat";
import { useAdminUser } from "@/lib/useAdminUser";

// Formats a minor-unit (paise) integer as an INR currency string.
function money(valueMinor: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2
  }).format(valueMinor / 100);
}

// Converts a SCREAMING_SNAKE_CASE enum value into "Title Case" for display.
function title(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : ""))
    .join(" ");
}

export default function AdminCreditAccountDetailPage() {
  const { user, loading: userLoading } = useAdminUser();
  const params = useParams<{ businessAccountId: string }>();
  const accountId = params.businessAccountId;

  // Core data for the page: account details, statements, payments, ledger.
  const [account, setAccount] = useState<CreditAccount | null>(null);
  const [statements, setStatements] = useState<CreditStatement[]>([]);
  const [payments, setPayments] = useState<CreditPayment[]>([]);
  const [ledger, setLedger] = useState<CreditLedgerEntry[]>([]);

  // "Record Offline Payment" form state.
  const [statementId, setStatementId] = useState("");
  const [amountRupees, setAmountRupees] = useState("");
  const [method, setMethod] = useState<"BANK_TRANSFER" | "UPI" | "CASH" | "CHEQUE">("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  // Page-level UI state.
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Loads the account, statements, payments, and ledger together, then
  // pre-fills the payment form with the oldest outstanding statement.
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

  // Initial load, deferred slightly so it doesn't block first paint.
  useEffect(() => {
    if (!user) return;

    const initialLoad = window.setTimeout(() => {
      void load()
        .catch((caught) => setError(caught instanceof Error ? caught.message : "Credit account could not be loaded."))
        .finally(() => setLoading(false));
    }, 0);

    return () => window.clearTimeout(initialLoad);
  }, [load, user]);

  // Closes the currently completed billing cycle.
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

  // Validates and submits the "Record Offline Payment" form.
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

  // Shared handler for suspend / reactivate / close lifecycle actions,
  // each of which requires the admin to type a reason first.
  async function runLifecycle(kind: "suspend" | "reactivate" | "close") {
    const reason = window.prompt(`Reason to ${kind} this credit facility:`)?.trim();
    if (!reason) return;
    if (reason.length < 5) {
      setError("Provide a reason of at least 5 characters.");
      return;
    }

    setBusy(kind);
    setError("");
    setMessage("");
    try {
      const action = kind === "suspend" ? suspendCreditAccount : kind === "reactivate" ? reactivateCreditAccount : closeCreditAccount;
      const result = await action(accountId, reason);
      setMessage(result.message);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The credit facility could not be updated.");
    } finally {
      setBusy("");
    }
  }

  // Writes off some or all of a statement's outstanding balance.
  async function writeOff(statement: CreditStatement) {
    const rupees = window
      .prompt(`Write-off amount (INR) for ${statement.statementNumber}:`, String(statement.outstandingAmountMinor / 100))
      ?.trim();
    if (!rupees) return;

    const amountMinor = Math.round(Number(rupees) * 100);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      setError("Enter a valid write-off amount.");
      return;
    }

    const reason = window.prompt("Reason for the write-off:")?.trim();
    if (!reason || reason.length < 5) {
      setError("Provide a write-off reason of at least 5 characters.");
      return;
    }

    setBusy(`writeoff:${statement.id}`);
    setError("");
    setMessage("");
    try {
      const result = await writeOffAdminStatement(accountId, statement.id, { amountMinor, reason });
      setMessage(result.message);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The statement could not be written off.");
    } finally {
      setBusy("");
    }
  }

  // Verifies a pending offline payment so it's applied to the account.
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
        {/* Page header: account identity + lifecycle actions */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/dashboard/credit-accounts" className="text-sm font-semibold text-blue-900">
              Back to credit accounts
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">
              {account?.businessAccount?.companyName || "Credit Account"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">{account?.businessAccount?.accountId}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void openAuthenticatedFile(`/api/v1/credit-accounts/${accountId}/ledger/export`, "credit-account-statement.csv")}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-blue-900"
            >
              <FiDownload /> Export Ledger
            </button>

            <button
              type="button"
              onClick={() => void closeCycle()}
              disabled={busy === "cycle"}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-blue-900 disabled:opacity-60"
            >
              <FiRefreshCw className={busy === "cycle" ? "animate-spin" : ""} /> Close Completed Cycle
            </button>

            {/* Lifecycle actions are conditional on the account's current status */}
            {account?.status === "ACTIVE" ? (
              <button
                type="button"
                onClick={() => void runLifecycle("suspend")}
                disabled={busy === "suspend"}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-800 disabled:opacity-60"
              >
                {busy === "suspend" ? "Suspending..." : "Suspend"}
              </button>
            ) : null}

            {account?.status === "SUSPENDED" ? (
              <button
                type="button"
                onClick={() => void runLifecycle("reactivate")}
                disabled={busy === "reactivate"}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 disabled:opacity-60"
              >
                {busy === "reactivate" ? "Reactivating..." : "Reactivate"}
              </button>
            ) : null}

            {account && ["APPROVED", "ACTIVE", "SUSPENDED", "EXPIRED", "REJECTED"].includes(account.status) ? (
              <button
                type="button"
                onClick={() => void runLifecycle("close")}
                disabled={busy === "close"}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 text-sm font-semibold text-red-700 disabled:opacity-60"
              >
                {busy === "close" ? "Closing..." : "Close"}
              </button>
            ) : null}
          </div>
        </div>

        {/* Feedback banners */}
        {error ? (
          <div role="alert" className="border border-red-500  p-3  rounded-xl text-sm text-red-700">
            {error}
          </div>
        ) : null}
        {message ? (
          <div role="status" className="border border-emerald-500   rounded-xl   p-3 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}
        {loading ? (
          <div className="p-10 text-center text-sm font-semibold   rounded-xl  text-slate-500">Loading credit account...</div>
        ) : null}

        {/* Account summary + any active restriction notice */}
        {account ? <CreditSummaryCards account={account} /> : null}
        {account ? <CreditRestrictionAlert restriction={account.restriction} gracePeriodDays={account.gracePeriodDays} /> : null}

        {/* Billing statements table */}
        <section className="overflow-x-auto border border-slate-200 bg-white rounded-2xl">
          <div className="border-b border-slate-200 p-5">
            <h2 className="font-semibold text-slate-950">Billing Statements</h2>
            <p className="mt-1 text-sm text-slate-500">Finalized shipment invoices grouped by completed billing period.</p>
          </div>
          <table className="min-w-full text-left text-sm">
            <thead className=" text-xs uppercase text-slate-900 bg-gray-100">
              <tr>
                <th className="px-4 py-3">Statement</th>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Due</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3 text-right">Outstanding</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {statements.map((statement) => (
                <tr key={statement.id} className="border-t border-slate-100">
                  <td className="px-4 py-4 font-semibold">{statement.statementNumber}</td>
                  <td className="px-4 py-4 text-slate-600">
                    {formatDashboardDate(statement.periodStart)} to{" "}
                    {formatDashboardDate(new Date(new Date(statement.periodEnd).getTime() - 1).toISOString())}
                  </td>
                  <td className="px-4 py-4">{formatDashboardDate(statement.dueAt)}</td>
                  <td className="px-4 py-4 text-right">{money(statement.totalAmountMinor)}</td>
                  <td className="px-4 py-4 text-right font-semibold">{money(statement.outstandingAmountMinor)}</td>
                  <td className="px-4 py-4">{title(statement.status)}</td>
                  <td className="px-4 py-4 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <Link href={`/dashboard/credit-accounts/${accountId}/statements/${statement.id}`} className="font-semibold text-blue-900">
                        View
                      </Link>
                      {statement.outstandingAmountMinor > 0 ? (
                        <button
                          type="button"
                          onClick={() => void writeOff(statement)}
                          disabled={busy === `writeoff:${statement.id}`}
                          className="font-semibold text-red-700 disabled:opacity-60"
                        >
                          Write off
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!statements.length && !loading ? <p className="p-8 text-center text-sm text-slate-500">No billing statements yet.</p> : null}
        </section>

        {/* Payment reconciliation table + offline payment form */}
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="overflow-x-auto border border-slate-200 bg-white rounded-2xl">
            <div className="border-b border-slate-200 p-5">
              <h2 className="font-semibold text-slate-950">Payment Reconciliation</h2>
              <p className="mt-1 text-sm text-slate-500">Verify submitted offline payments and review applied payments.</p>
            </div>
            <table className="min-w-full text- text-sm">
              <thead className="text-xs uppercase text-left text-slate-900 bg-gray-100">
                <tr>
                  <th className="px-4 py-3">Payment</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3 ">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-t border-slate-100">
                    <td className="px-4 py-4">
                      <p className="font-semibold">{payment.internalReference}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatDashboardDateTime(payment.createdAt)}
                        {payment.externalReference ? ` | ${payment.externalReference}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-4">{title(payment.method)}</td>
                    <td className="px-4 py-4 text-right font-semibold">{money(payment.amountMinor)}</td>
                    <td className="px-4 py-4">{title(payment.status)}</td>
                    <td className="px-4 py-4 text-right">
                      {payment.status === "PENDING_VERIFICATION" ? (
                        <button
                          type="button"
                          onClick={() => void verify(payment.id)}
                          disabled={busy === payment.id}
                          className="h-8 bg-emerald-600 px-3 font-semibold text-white disabled:opacity-60"
                        >
                          Verify
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!payments.length ? <p className="p-8 text-center text-sm text-slate-500">No statement payments recorded.</p> : null}
          </div>

         <form onSubmit={recordPayment} className="h-fit border border-slate-400 bg-white p-5 rounded-2xl">
            <h2 className="font-semibold text-slate-950">Record Offline Payment</h2>
            <p className="mt-3 text-sm ">Admin-recorded payments are verified and allocated immediately.</p>

            <label className="mt-4 block text-sm font-semibold text-slate-700 ">
             
              <div className="relative mt-2">
                <select
                  value={statementId}
                  onChange={(event) => {
                    setStatementId(event.target.value);
                    const selected = statements.find((item) => item.id === event.target.value);
                    if (selected) setAmountRupees(String(selected.outstandingAmountMinor / 100));
                  }}
                  className="h-11 w-full border border-slate-300 bg-white px-3 pr-9 font-normal rounded-xl appearance-none"
                >
                  <option value="">Oldest outstanding first</option>
                  {statements
                    .filter((item) => item.outstandingAmountMinor > 0)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.statementNumber} - {money(item.outstandingAmountMinor)}
                      </option>
                    ))}
                </select>
                <FiChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </label>

            <label className="mt-4 block text-sm font-semibold text-slate-700">
              
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amountRupees}
                onChange={(event) => setAmountRupees(event.target.value)}
                className="mt-2 h-11 w-full border border-slate-300 px-3 font-normal rounded-xl"
                placeholder="Payment amount in INR"
              />
            </label>

            <label className="mt-4 block text-sm font-semibold text-slate-700">
           
              <div className="relative mt-2">
                <select
                  value={method}
                  onChange={(event) => setMethod(event.target.value as typeof method)}
                  className="h-11 w-full border border-slate-300 bg-white px-3 pr-9 font-normal rounded-xl appearance-none"
                  aria-label="Payment method"
                >
                  <option value="BANK_TRANSFER">Bank Transfer</option>
                  <option value="UPI">UPI</option>
                  <option value="CASH">Cash</option>
                  <option value="CHEQUE">Cheque</option>
                </select>
                <FiChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              </div>
            </label>

            <label className="mt-4 block text-sm font-semibold text-slate-700">
            
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="UTR, receipt or cheque number"
                className="mt-2 h-11 w-full border border-slate-300 px-3 font-normal rounded-xl"
              />
            </label>

            <label className="mt-4 block text-sm font-semibold text-slate-700">
       
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                className="mt-2 w-full border border-slate-300 p-3 rounded-2xl font-normal"
                placeholder="Optional notes for the payment"
              />
            </label>

            <button
              disabled={busy === "payment"}
              className="mt-4 h-10 bg-green-600 px-5 text-sm font-semibold rounded-2xl text-white disabled:opacity-60"
            >
              {busy === "payment" ? "Applying..." : "Record and Apply"}
            </button>
          </form>
        </section>

        {/* Credit ledger table */}
        <section className="overflow-x-auto border border-slate-200 bg-white rounded-xl">
          <div className="border-b border-slate-200 p-5">
            <h2 className="font-semibold text-slate-950">Credit Ledger</h2>
            <p className="mt-1 text-sm text-slate-500">Latest financial movements and resulting balances.</p>
          </div>
          <table className="min-w-full text-left text-sm">
            <thead className=" text-xs uppercase text-slate-900 bg-gray-100">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Activity</th>
                <th className="px-4 py-3">Reference</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">Available Credit</th>
                <th className="px-4 py-3 text-right">Advance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.slice(0, 50).map((entry) => (
                <tr key={entry.id} className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-4 py-4">{formatDashboardDateTime(entry.createdAt)}</td>
                  <td className="px-4 py-4">
                    <p className="font-semibold">{title(entry.type)}</p>
                    <p className="mt-1 max-w-md text-xs text-slate-500">{entry.description}</p>
                  </td>
                  <td className="px-4 py-4">{entry.reference}</td>
                  <td className="px-4 py-4 text-right font-semibold">{money(entry.amountMinor)}</td>
                  <td className="px-4 py-4 text-right">{money(entry.availableCreditAfterMinor)}</td>
                  <td className="px-4 py-4 text-right">{money(entry.availableAdvanceAfterMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </DashboardShell>
  );
}