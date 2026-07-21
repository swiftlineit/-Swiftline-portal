"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FiAlertCircle, FiFileText, FiRefreshCw } from "react-icons/fi";
import { ClientDashboardLoading, ClientDashboardShell } from "@/components/client/ClientDashboardShell";
import CreditStatusBadge from "@/components/credit/CreditStatusBadge";
import CreditSummaryCards from "@/components/credit/CreditSummaryCards";
import { CreditAgreement, listClientCreditAgreements } from "@/lib/creditAgreements";
import {
  CreditAccount,
  CreditPermission,
  getClientCreditAccount,
  MAX_CREDIT_LIMIT_RUPEES,
  requestCredit
} from "@/lib/creditAccounts";
import { ClientDashboardAccount, getClientDashboard } from "@/lib/clientDashboard";
import { useClientUser } from "@/lib/useClientUser";

const REQUESTABLE_STATUSES = new Set(["NOT_REQUESTED", "REJECTED"]);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Credit account details could not be loaded. Please try again.";
}

export default function ClientCreditPage() {
  const { user, loading: userLoading } = useClientUser();
  const [accounts, setAccounts] = useState<ClientDashboardAccount[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [creditAccount, setCreditAccount] = useState<CreditAccount | null>(null);
  const [agreement, setAgreement] = useState<CreditAgreement | null>(null);
  const [permissions, setPermissions] = useState<CreditPermission[]>([]);
  const [requestedAmount, setRequestedAmount] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadCredit = useCallback(async (businessAccountId: string) => {
    const result = await getClientCreditAccount(businessAccountId);
    setCreditAccount(result.creditAccount);
    setPermissions(result.permissions);
    if (result.permissions.includes("viewCreditDetails")) {
      const agreementResult = await listClientCreditAgreements(businessAccountId);
      setAgreement(agreementResult.agreements[0] ?? null);
    } else {
      setAgreement(null);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const dashboard = await getClientDashboard();
        setAccounts(dashboard.accounts);
        const firstId = dashboard.accounts[0]?.account.id ?? "";
        setSelectedId(firstId);
        if (firstId) await loadCredit(firstId);
      } catch (loadError) {
        setError(errorMessage(loadError));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [loadCredit, user]);

  async function handleAccountChange(businessAccountId: string) {
    setSelectedId(businessAccountId);
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      await loadCredit(businessAccountId);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rupees = Number(requestedAmount);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setError("Enter a valid credit limit greater than zero.");
      return;
    }
    if (rupees > MAX_CREDIT_LIMIT_RUPEES) {
      setError("Requested credit limit cannot exceed INR 1,00,000.");
      return;
    }
    if (reason.trim().length < 10) {
      setError("Briefly explain the expected shipment volume or business need.");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const result = await requestCredit({
        businessAccountId: selectedId,
        requestedCreditLimitMinor: Math.round(rupees * 100),
        reason: reason.trim()
      });
      setCreditAccount(result.creditAccount);
      setRequestedAmount("");
      setReason("");
      setSuccess(result.message);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  if (userLoading || !user) return <ClientDashboardLoading />;
  const selectedAccount = accounts.find((item) => item.account.id === selectedId);
  const canRequest = permissions.includes("requestCredit") && creditAccount && REQUESTABLE_STATUSES.has(creditAccount.status);

  return (
    <ClientDashboardShell user={user}>
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">Credit Account</h1>
            <p className="mt-1 text-sm text-slate-600">View the shared booking capacity for your business account.</p>
          </div>
          <Link href="/client/credit/payment-terms" className="inline-flex h-10 items-center gap-2 border border-slate-300 bg-white px-4 text-sm font-semibold text-blue-900 hover:border-blue-300">
            <FiFileText aria-hidden="true" /> Payment Terms
          </Link>
        </div>

        {accounts.length > 1 ? (
          <label className="block max-w-md text-sm font-semibold text-slate-700">
            Business account
            <select value={selectedId} onChange={(event) => void handleAccountChange(event.target.value)} className="mt-2 h-11 w-full border border-slate-300 bg-white px-3 font-normal text-slate-900 focus:border-blue-500 focus:outline-none">
              {accounts.map((item) => <option key={item.account.id} value={item.account.id}>{item.account.company.companyName} ({item.account.accountId})</option>)}
            </select>
          </label>
        ) : null}

        {error ? <div role="alert" className="flex items-start gap-2 border border-red-200 bg-red-50 p-3 text-sm text-red-700"><FiAlertCircle className="mt-0.5 shrink-0" />{error}</div> : null}
        {success ? <div role="status" className="border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{success}</div> : null}

        {loading ? (
          <div className="flex min-h-48 items-center justify-center border border-slate-200 bg-white text-sm font-semibold text-slate-500"><FiRefreshCw className="mr-2 animate-spin" /> Loading credit account...</div>
        ) : creditAccount && selectedAccount ? (
          <>
            <section className="flex flex-wrap items-center justify-between gap-4 border border-slate-200 bg-white p-5">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">{selectedAccount.account.accountId}</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">{selectedAccount.account.company.companyName}</h2>
              </div>
              <CreditStatusBadge status={creditAccount.status} />
            </section>

            <CreditSummaryCards account={creditAccount} />

            {creditAccount.restriction && creditAccount.restriction.level !== "NONE" ? (
              <section className={`border p-4 text-sm ${creditAccount.restriction.level === "GRACE_WARNING" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-700"}`}>
                <p className="font-semibold">Overdue credit statement</p>
                <p className="mt-1">{creditAccount.restriction.message}</p>
                <Link href="/client/credit/statements" className="mt-3 inline-flex font-semibold text-blue-900">Review statements</Link>
              </section>
            ) : null}

            {permissions.includes("viewCreditDetails") ? (
              <section className="flex flex-wrap items-center justify-between gap-4 border border-slate-200 bg-white p-5">
                <div><h2 className="font-semibold text-slate-950">Statements and Account Activity</h2><p className="mt-1 text-sm text-slate-600">Review billing statements, payments, and credit movements.</p></div>
                <Link href="/client/credit/statements" className="inline-flex h-10 items-center gap-2 bg-blue-900 px-4 text-sm font-semibold text-white"><FiFileText /> View Statements</Link>
              </section>
            ) : null}

            {creditAccount.securityDepositRequiredMinor && creditAccount.businessAccount?.depositStatus !== "received" ? (
              <section className="flex flex-wrap items-center justify-between gap-4 border border-amber-200 bg-amber-50 p-5">
                <div>
                  <p className="text-xs font-semibold uppercase text-amber-700">Required Deposit</p>
                  <h2 className="mt-1 font-semibold text-slate-950">Deposit needed before activation</h2>
                  <p className="mt-1 text-sm text-slate-700">
                    {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(creditAccount.securityDepositRequiredMinor / 100)} is required for this credit facility.
                  </p>
                </div>
                <Link
                  href={`/client/payments?businessAccountId=${selectedAccount.account.id}&purpose=SECURITY_DEPOSIT`}
                  className="inline-flex h-10 items-center gap-2 bg-amber-500 px-4 text-sm font-semibold text-slate-950 hover:bg-amber-400"
                >
                  <FiFileText /> Pay Required Deposit
                </Link>
              </section>
            ) : null}

            {agreement ? (
              <section className="flex flex-wrap items-center justify-between gap-4 border border-slate-200 bg-white p-5">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">Credit Agreement</p>
                  <h2 className="mt-1 font-semibold text-slate-950">{agreement.agreementNumber}</h2>
                  <p className="mt-1 text-sm text-slate-600">{agreement.status === "SIGNED" ? "Signed agreement available" : "Review and signature required before credit activation"}</p>
                </div>
                <Link href={`/client/credit/agreements/${agreement.id}`} className="inline-flex h-10 items-center gap-2 bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800">
                  <FiFileText /> {agreement.status === "SIGNED" ? "View Signed Agreement" : "Review and Sign"}
                </Link>
              </section>
            ) : null}

            <section className="grid gap-4 border border-slate-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-xs font-semibold uppercase text-slate-500">Payment Terms</p><p className="mt-2 font-semibold text-slate-900">{creditAccount.paymentTermsDays === 0 ? "Due immediately" : `${creditAccount.paymentTermsDays} days`}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-500">Billing Cycle</p><p className="mt-2 font-semibold text-slate-900">{creditAccount.billingCycle}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-500">Valid Until</p><p className="mt-2 font-semibold text-slate-900">{creditAccount.validUntil ? new Date(creditAccount.validUntil).toLocaleDateString("en-GB").replaceAll("/", "-") : "Not assigned"}</p></div>
              <div><p className="text-xs font-semibold uppercase text-slate-500">Credit Use</p><p className="mt-2 font-semibold text-slate-900">{creditAccount.canUseCredit ? "Available" : "Not available"}</p></div>
            </section>

            {canRequest ? (
              <form onSubmit={handleRequest} className="max-w-2xl border border-slate-200 bg-white p-5">
                <h2 className="text-lg font-semibold text-slate-950">Request Credit Limit</h2>
                <p className="mt-1 text-sm text-slate-600">Finance will review the request before any credit becomes available.</p>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-700">Requested limit (INR)<input type="number" min="1" max={MAX_CREDIT_LIMIT_RUPEES} step="0.01" value={requestedAmount} onChange={(event) => setRequestedAmount(event.target.value)} inputMode="decimal" placeholder="100000" className="mt-2 h-11 w-full border border-slate-300 px-3 font-normal focus:border-blue-500 focus:outline-none" /></label>
                  <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Business reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} placeholder="Expected monthly shipment volume and reason for requesting credit" className="mt-2 w-full resize-y border border-slate-300 p-3 font-normal focus:border-blue-500 focus:outline-none" /></label>
                </div>
                <button disabled={submitting} className="mt-4 h-10 bg-blue-900 px-5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60">{submitting ? "Submitting..." : "Submit Request"}</button>
              </form>
            ) : null}
          </>
        ) : (
          <div className="border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">No eligible business account is available.</div>
        )}
      </div>
    </ClientDashboardShell>
  );
}
