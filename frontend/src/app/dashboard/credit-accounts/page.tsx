"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FiCheck, FiEdit2, FiEye, FiFileText, FiRefreshCw, FiX } from "react-icons/fi";
import DashboardShell, { DashboardLoading } from "@/components/DashboardShell";
import CreditAgreementPreviewDialog from "@/components/credit/CreditAgreementPreviewDialog";
import CreditApprovalDialog from "@/components/credit/CreditApprovalDialog";
import CreditStatusBadge from "@/components/credit/CreditStatusBadge";
import {
  createAdminCreditAgreementDraft,
  CreditAgreement,
  generateAdminCreditAgreement,
  listAdminCreditAgreements
} from "@/lib/creditAgreements";
import {
  activateCreditAccount,
  CreditAccount,
  formatCreditMoney,
  listAdminCreditAccounts,
  rejectCreditAccount
} from "@/lib/creditAccounts";
import { useAdminUser } from "@/lib/useAdminUser";

export default function AdminCreditAccountsPage() {
  const { user, loading } = useAdminUser();
  const [accounts, setAccounts] = useState<CreditAccount[]>([]);
  const [agreements, setAgreements] = useState<CreditAgreement[]>([]);
  const [selected, setSelected] = useState<CreditAccount | null>(null);
  const [previewAgreement, setPreviewAgreement] = useState<CreditAgreement | null>(null);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dataLoading, setDataLoading] = useState(true);

  const latestAgreementByBusiness = useMemo(() => {
    const entries = new Map<string, CreditAgreement>();
    for (const agreement of agreements) {
      if (!entries.has(agreement.businessAccountId)) entries.set(agreement.businessAccountId, agreement);
    }
    return entries;
  }, [agreements]);

  async function loadData() {
    setDataLoading(true);
    setError("");
    try {
      const [creditResult, agreementResult] = await Promise.all([
        listAdminCreditAccounts(),
        listAdminCreditAgreements()
      ]);
      setAccounts(creditResult.creditAccounts);
      setAgreements(agreementResult.agreements);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load credit accounts.");
    } finally {
      setDataLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    let active = true;
    Promise.all([listAdminCreditAccounts(), listAdminCreditAgreements()])
      .then(([creditResult, agreementResult]) => {
        if (!active) return;
        setAccounts(creditResult.creditAccounts);
        setAgreements(agreementResult.agreements);
      })
      .catch((caughtError: unknown) => {
        if (active) setError(caughtError instanceof Error ? caughtError.message : "Unable to load credit accounts.");
      })
      .finally(() => {
        if (active) setDataLoading(false);
      });
    return () => { active = false; };
  }, [user]);

  async function saved(notice: string) {
    setSelected(null);
    setMessage(notice);
    await loadData();
  }

  async function activate(account: CreditAccount) {
    setBusyId(account.businessAccountId);
    setError("");
    setMessage("");
    try {
      const result = await activateCreditAccount(account.businessAccountId);
      setMessage(result.message);
      await loadData();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to activate credit.");
    } finally {
      setBusyId("");
    }
  }

  async function reject(account: CreditAccount) {
    const reason = window.prompt("Reason for rejecting this credit request:")?.trim();
    if (!reason) return;
    setBusyId(account.businessAccountId);
    setError("");
    setMessage("");
    try {
      const result = await rejectCreditAccount(account.businessAccountId, reason);
      setMessage(result.message);
      await loadData();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to reject credit.");
    } finally {
      setBusyId("");
    }
  }

  async function generateAgreement(account: CreditAccount, existing?: CreditAgreement) {
    setBusyId(account.businessAccountId);
    setError("");
    setMessage("");
    try {
      const draft = existing?.status === "DRAFT"
        ? existing
        : (await createAdminCreditAgreementDraft(account.businessAccountId)).agreement;
      const result = await generateAdminCreditAgreement(draft.id);
      setMessage(result.message);
      setPreviewAgreement(result.agreement);
      await loadData();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to generate the credit agreement.");
    } finally {
      setBusyId("");
    }
  }

  if (loading || !user) return <DashboardLoading />;

  return (
    <DashboardShell user={user}>
      <div className="mx-auto max-w-[1500px] space-y-6" style={{ backgroundColor: "#EEEDED" }}>
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#0D1282" }}>
              Business Accounts
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">Credit Accounts</h1>
            <p className="mt-1 text-sm text-slate-500">Review, approve, and manage business credit facilities.</p>
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={dataLoading}
            className="inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: "#0D1282" }}
          >
            <FiRefreshCw className={dataLoading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* Alerts */}
        {error ? (
          <div
            className="flex items-center gap-3 rounded-xl border-l-4 bg-white px-4 py-3 text-sm font-semibold shadow-sm"
            style={{ borderColor: "#D71313", color: "#D71313" }}
          >
            <FiX className="shrink-0" />
            {error}
          </div>
        ) : null}
        {message ? (
          <div
            className="flex items-center gap-3 rounded-xl border-l-4 bg-white px-4 py-3 text-sm font-semibold shadow-sm"
            style={{ borderColor: "#0D1282", color: "#0D1282" }}
          >
            <FiCheck className="shrink-0" />
            {message}
          </div>
        ) : null}

        {/* Table card */}
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr style={{ backgroundColor: "#0D1282" }}>
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-white">Customer</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-white">Status</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-white">Used</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-white">Available</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-white">Advance</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-white">Capacity</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-white">Terms</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-white">Agreement</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-white">Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account, index) => {
                  const agreement = latestAgreementByBusiness.get(account.businessAccountId);
                  const canGenerate = ["APPROVED", "ACTIVE"].includes(account.status)
                    && (!agreement || ["DRAFT", "DECLINED", "EXPIRED", "SUPERSEDED"].includes(agreement.status));
                  const isBusy = busyId === account.businessAccountId;
                  return (
                    <tr
                      key={account.businessAccountId}
                      className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50"
                      style={{ backgroundColor: index % 2 === 0 ? "#FFFFFF" : "#FAFAFA" }}
                    >
                      <td className="px-4 py-4 text-left">
                        <p className="font-semibold text-slate-900">{account.businessAccount?.companyName}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{account.businessAccount?.accountId}</p>
                      </td>
                      <td className="px-4 py-4 text-left">
                        <CreditStatusBadge status={account.status} />
                      </td>
                      <td className="px-4 py-4 text-left text-slate-600">
                        {formatCreditMoney(account.usedCreditMinor, account.currency)}
                      </td>
                      <td className="px-4 py-4 text-lefttext-slate-600  ">
                        {formatCreditMoney(account.availableCreditMinor, account.currency)}
                      </td>
                      <td className="px-4 py-4 text-left text-slate-600">
                        {formatCreditMoney(account.availableAdvanceMinor, account.currency)}
                      </td>
                      <td className="px-4 py-4 text-left text-slate-600">
                        {formatCreditMoney(account.availableBookingCapacityMinor, account.currency)}
                      </td>
                      <td className="px-4 py-4 text-left">
                        <p className="font-medium text-slate-800">
                          {account.paymentTermsDays ? `${account.paymentTermsDays} days` : "Due immediately"}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">{account.billingCycle}</p>
                      </td>
                      <td className="px-4 py-4 text-left">
                        {agreement ? (
                          <>
                            <p className="font-medium text-slate-800">{agreement.status.replaceAll("_", " ")}</p>
                            <p className="mt-0.5 text-xs text-slate-400">{agreement.agreementNumber}</p>
                          </>
                        ) : (
                          <span
                            className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold"
                            style={{ backgroundColor: "#F0DE36", color: "#5a4e00" }}
                          >
                            Not generated
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-left">
                        <div className="flex min-w-max flex-wrap gap-1.5">
                          <Link
                            href={`/dashboard/credit-accounts/${account.businessAccountId}`}
                            title="Account"
                            className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition hover:bg-slate-50"
                            style={{ borderColor: "#0D1282", color: "#0D1282" }}
                          >
                            <FiEye size={12} /> Account
                          </Link>
                          <button
                            type="button"
                            onClick={() => setSelected(account)}
                            title="Configure"
                            className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition hover:bg-slate-50"
                            style={{ borderColor: "#0D1282", color: "#0D1282" }}
                          >
                            <FiEdit2 size={12} /> Configure
                          </button>
                          {canGenerate ? (
                            <button
                              type="button"
                              onClick={() => void generateAgreement(account, agreement)}
                              disabled={isBusy}
                              title="Generate Agreement"
                              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-slate-900 shadow-sm transition hover:opacity-90 disabled:opacity-50"
                              style={{ backgroundColor: "#F0DE36" }}
                            >
                              <FiFileText size={12} /> {isBusy ? "..." : "Generate"}
                            </button>
                          ) : null}
                          {agreement?.generatedDocument ? (
                            <button
                              type="button"
                              onClick={() => setPreviewAgreement(agreement)}
                              title="View Agreement"
                              className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition hover:bg-slate-50"
                              style={{ borderColor: "#0D1282", color: "#0D1282" }}
                            >
                              <FiEye size={12} /> View
                            </button>
                          ) : null}
                          {account.status === "APPROVED" ? (
                            <button
                              type="button"
                              onClick={() => void activate(account)}
                              disabled={isBusy}
                              title="Activate"
                              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
                              style={{ backgroundColor: "#0D1282" }}
                            >
                              <FiCheck size={12} /> Activate
                            </button>
                          ) : null}
                          {['PENDING_REVIEW', 'APPROVED'].includes(account.status) ? (
                            <button
                              type="button"
                              onClick={() => void reject(account)}
                              disabled={isBusy}
                              title="Reject"
                              className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition hover:bg-red-50 disabled:opacity-50"
                              style={{ borderColor: "#D71313", color: "#D71313" }}
                            >
                              <FiX size={12} /> Reject
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!dataLoading && !accounts.length ? (
            <div className="flex flex-col items-center gap-2 p-14 text-center">
              <div
                className="flex h-12 w-12 items-center justify-center rounded-full"
                style={{ backgroundColor: "#EEEDED" }}
              >
                <FiFileText style={{ color: "#0D1282" }} />
              </div>
              <p className="text-sm font-medium text-slate-600">No approved business accounts are available.</p>
              <p className="text-xs text-slate-400">New credit requests will appear here once submitted.</p>
            </div>
          ) : null}
          {dataLoading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-400">
              <FiRefreshCw className="animate-spin" style={{ color: "#0D1282" }} />
              Loading credit accounts...
            </div>
          ) : null}
        </section>
      </div>

      {selected ? <CreditApprovalDialog account={selected} onClose={() => setSelected(null)} onSaved={saved} /> : null}
      {previewAgreement ? <CreditAgreementPreviewDialog agreement={previewAgreement} onClose={() => setPreviewAgreement(null)} /> : null}
    </DashboardShell>
  );
}