"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FiFileText, FiList, FiPlus, FiRefreshCw } from "react-icons/fi";
import { toast } from "react-toastify";
import {
  ClientDashboardLoading,
} from "@/components/client/ClientDashboardShell";
import CreditStatusBadge from "@/components/credit/CreditStatusBadge";
import CreditLimitIncreasePanel from "@/components/credit/CreditLimitIncreasePanel";
import CreditPaymentStatusBanner from "@/components/credit/CreditPaymentStatusBanner";
import CreditSummaryCards from "@/components/credit/CreditSummaryCards";
import {
  CreditAgreement,
  listClientCreditAgreements,
} from "@/lib/creditAgreements";
import {
  CreditAccount,
  CreditPermission,
  getClientCreditAccount,
  MAX_CREDIT_LIMIT_LABEL,
  MAX_CREDIT_LIMIT_RUPEES,
  requestCredit,
} from "@/lib/creditAccounts";
import {
  ClientDashboardAccount,
  getClientDashboard,
} from "@/lib/clientDashboard";
import { useClientUser } from "@/lib/useClientUser";

const REQUESTABLE_STATUSES = new Set(["NOT_REQUESTED", "REJECTED"]);

// `max` on a number input only blocks form submission, not typing, so the value
// is capped as it is entered. Non-numeric and partial entries ("", "1.") pass
// through untouched so the field stays editable while typing.
function clampCreditLimit(value: string) {
  const rupees = Number(value);
  if (!value || !Number.isFinite(rupees)) return value;
  return rupees > MAX_CREDIT_LIMIT_RUPEES
    ? String(MAX_CREDIT_LIMIT_RUPEES)
    : value;
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Credit account details could not be loaded. Please try again.";
}

export default function ClientCreditPage() {
  const { user, loading: userLoading } = useClientUser();
  const [accounts, setAccounts] = useState<ClientDashboardAccount[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [creditAccount, setCreditAccount] = useState<CreditAccount | null>(
    null,
  );
  const [agreement, setAgreement] = useState<CreditAgreement | null>(null);
  const [permissions, setPermissions] = useState<CreditPermission[]>([]);
  const [requestedAmount, setRequestedAmount] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const loadCredit = useCallback(async (businessAccountId: string) => {
    const result = await getClientCreditAccount(businessAccountId);
    setCreditAccount(result.creditAccount);
    setPermissions(result.permissions);
    if (result.permissions.includes("viewCreditDetails")) {
      const agreementResult =
        await listClientCreditAgreements(businessAccountId);
      setAgreement(agreementResult.agreements[0] ?? null);
    } else {
      setAgreement(null);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    async function load() {
      setLoading(true);
      try {
        const dashboard = await getClientDashboard();
        setAccounts(dashboard.accounts);
        const firstId = dashboard.accounts[0]?.account.id ?? "";
        setSelectedId(firstId);
        if (firstId) await loadCredit(firstId);
      } catch (loadError) {
        toast.error(errorMessage(loadError));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [loadCredit, user]);

  async function handleAccountChange(businessAccountId: string) {
    setSelectedId(businessAccountId);
    setLoading(true);
    try {
      await loadCredit(businessAccountId);
    } catch (loadError) {
      toast.error(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const rupees = Number(requestedAmount);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      toast.error("Enter a valid credit limit greater than zero.");
      return;
    }
    if (rupees > MAX_CREDIT_LIMIT_RUPEES) {
      toast.error(`Requested credit limit cannot exceed ${MAX_CREDIT_LIMIT_LABEL}.`);
      return;
    }
    if (reason.trim().length < 10) {
      toast.error(
        "Briefly explain the expected shipment volume or business need.",
      );
      return;
    }

    setSubmitting(true);
    try {
      const result = await requestCredit({
        businessAccountId: selectedId,
        requestedCreditLimitMinor: Math.round(rupees * 100),
        reason: reason.trim(),
      });
      setCreditAccount(result.creditAccount);
      setRequestedAmount("");
      setReason("");
      toast.success(result.message);
    } catch (requestError) {
      toast.error(errorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  if (userLoading || !user) return <ClientDashboardLoading />;
  const selectedAccount = accounts.find(
    (item) => item.account.id === selectedId,
  );
  const canRequest =
    permissions.includes("requestCredit") &&
    creditAccount &&
    REQUESTABLE_STATUSES.has(creditAccount.status);

  return (
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-wrap items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">
              Credit Account
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              View the shared booking capacity for your business account.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/client/credit/payment-terms"
              className="inline-flex rounded-4xl h-10 items-center gap-2 border border-slate-300 bg-white px-4 text-sm font-semibold text-blue-900 hover:border-blue-300"
            >
              <FiFileText aria-hidden="true" />
              View Payment Terms
            </Link>
            {/* add credit button */}

            <Link
              href={selectedId ? `/client/credit/ledger?businessAccountId=${selectedId}` : "/client/credit/ledger"}
              className="inline-flex rounded-4xl h-10 items-center gap-2 border border-slate-300 bg-white px-4 text-sm font-semibold text-blue-900 hover:border-blue-300"
            >
              <FiList aria-hidden="true" />
              View Ledger
            </Link>
            <Link
              href="/client/payments"
              className="inline-flex rounded-4xl h-10 items-center gap-2 border border-slate-300 bg-white px-4 text-sm font-semibold text-blue-900 hover:border-blue-300"
            >
              <FiPlus aria-hidden="true" />
              Add Credit
            </Link>
          </div>
        </div>

        {accounts.length > 1 ? (
          <label className="block max-w-md text-sm font-semibold text-slate-700">
            Business account
            <select
              value={selectedId}
              onChange={(event) => void handleAccountChange(event.target.value)}
              className="mt-2 h-11 w-full border border-slate-300 bg-white px-3 font-normal text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              {accounts.map((item) => (
                <option key={item.account.id} value={item.account.id}>
                  {item.account.company.companyName} ({item.account.accountId})
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {loading ? (
          <div className="flex min-h-48 items-center justify-center border border-slate-200 bg-white text-sm font-semibold text-slate-500">
            <FiRefreshCw className="mr-2 animate-spin" /> Loading credit
            account...
          </div>
        ) : creditAccount && selectedAccount ? (
          <>
            {/* <section className="flex flex-wrap items-center justify-between gap-4 border border-slate-200 bg-white p-5">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">{selectedAccount.account.accountId}</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">{selectedAccount.account.company.companyName}</h2>
              </div>
              <CreditStatusBadge status={creditAccount.status} />
            </section> */}

            <CreditSummaryCards account={creditAccount} />

            {/* Shown only when the customer is at or near their ceiling- the
                moment a higher limit is worth asking for. */}
            <CreditLimitIncreasePanel
              account={creditAccount}
              canRequest={permissions.includes("requestCredit")}
            />

            <CreditPaymentStatusBanner account={creditAccount} businessAccountId={selectedId} />

            {permissions.includes("viewCreditDetails") ? (
              <section className="flex flex-wrap items-center justify-between gap-4 border rounded-2xl border-slate-200 bg-white p-5">
                <div>
                  <h2 className="font-semibold text-slate-950">
                    Statements and Account Activity
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Review billing statements, payments, and credit movements.
                  </p>
                </div>
                <Link
                  href="/client/credit/statements"
                  className="inline-flex rounded-4xl h-10 items-center gap-2 bg-blue-900 px-4 text-sm font-semibold text-white"
                >
                  <FiFileText /> View Statements
                </Link>
              </section>
            ) : null}

            {creditAccount.securityDepositRequiredMinor &&
            creditAccount.businessAccount?.depositStatus !== "received" ? (
              <section className="flex flex-wrap items-center justify-between gap-4 border rounded-2xl border-amber-200 bg-amber-50 p-5">
                <div>
                  <p className="text-xs font-semibold uppercase text-amber-700">
                    Required Deposit
                  </p>
                  <h2 className="mt-1 font-semibold text-slate-950">
                    Deposit needed before activation
                  </h2>
                  <p className="mt-1 text-sm text-slate-700">
                    {new Intl.NumberFormat("en-IN", {
                      style: "currency",
                      currency: "INR",
                      minimumFractionDigits: 2,
                    }).format(
                      creditAccount.securityDepositRequiredMinor / 100,
                    )}{" "}
                    is required for this credit facility.
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
              <section className="flex flex-wrap items-center justify-between rounded-2xl gap-4 border border-slate-200 bg-white p-5">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    Credit Agreement
                  </p>
                  <h2 className="mt-1 font-semibold text-slate-950">
                    {agreement.agreementNumber}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {agreement.status === "SIGNED"
                      ? "Signed agreement available"
                      : "Review and signature required before credit activation"}
                  </p>
                </div>
                <Link
                  href={`/client/credit/agreements/${agreement.id}`}
                  className="inline-flex rounded-4xl h-10 items-center gap-2 bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800"
                >
                  <FiFileText />{" "}
                  {agreement.status === "SIGNED"
                    ? "View Signed Agreement"
                    : "Review and Sign"}
                </Link>
              </section>
            ) : null}

            <section className="grid gap-4 border border-slate-200 rounded-2xl bg-white p-5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">
                  Payment Terms
                </p>
                <p className="mt-2 font-semibold text-slate-900">
                  {creditAccount.paymentTermsDays === 0
                    ? "Due immediately"
                    : `${creditAccount.paymentTermsDays} days`}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">
                  Billing Cycle
                </p>
                <p className="mt-2 font-semibold text-slate-900">
                  {creditAccount.billingCycle}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">
                  Valid Until
                </p>
                <p className="mt-2 font-semibold text-slate-900">
                  {creditAccount.validUntil
                    ? new Date(creditAccount.validUntil)
                        .toLocaleDateString("en-GB")
                        .replaceAll("/", "-")
                    : "Not assigned"}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">
                  Credit Use
                </p>
                <p className="mt-2 font-semibold text-slate-900">
                  {creditAccount.canUseCredit ? "Available" : "Not available"}
                </p>
              </div>
            </section>

            {canRequest ? (
              <form
                onSubmit={handleRequest}
                className="max-w-2xl border border-slate-200 bg-white p-5"
              >
                <h2 className="text-lg font-semibold text-slate-950">
                  Request Credit Limit
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Finance will review the request before any credit becomes
                  available.
                </p>
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-semibold text-slate-700">
                    Requested limit (INR)
                    <input
                      type="number"
                      min="1"
                      max={MAX_CREDIT_LIMIT_RUPEES}
                      step="0.01"
                      value={requestedAmount}
                      onChange={(event) =>
                        setRequestedAmount(clampCreditLimit(event.target.value))
                      }
                      inputMode="decimal"
                      placeholder="100000"
                      className="mt-2 h-11 w-full border border-slate-300 px-3 font-normal focus:border-blue-500 focus:outline-none"
                    />
                    <span className="mt-1 block text-xs font-normal text-slate-500">
                      Maximum {MAX_CREDIT_LIMIT_LABEL}
                    </span>
                  </label>
                  <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
                    Business reason
                    <textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      rows={4}
                      placeholder="Expected monthly shipment volume and reason for requesting credit"
                      className="mt-2 w-full resize-y border border-slate-300 p-3 font-normal focus:border-blue-500 focus:outline-none"
                    />
                  </label>
                </div>
                <button
                  disabled={submitting}
                  className="mt-4 h-10 bg-blue-900 px-5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Submitting..." : "Submit Request"}
                </button>
              </form>
            ) : null}
          </>
        ) : (
          <div className="border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
            No eligible business account is available.
          </div>
        )}
      </div>
  );
}
