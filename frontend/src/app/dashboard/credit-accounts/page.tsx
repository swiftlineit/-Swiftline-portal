"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FiCheck, FiEdit2, FiEye, FiFileText, FiRefreshCw, FiX } from "react-icons/fi";
import BusinessAccountsShell, { BusinessAccountsLoading } from "@/components/business-accounts/BusinessAccountsShell";
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

  if (loading || !user) return <BusinessAccountsLoading />;

  return (
    <BusinessAccountsShell user={user}>
      <div className="mx-auto max-w-[1500px] space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">Credit Accounts</h1>
            <p className="mt-1 text-sm text-slate-500">Review and configure business credit facilities.</p>
          </div>
          <button type="button" onClick={() => void loadData()} disabled={dataLoading} className="inline-flex h-10 items-center gap-2 border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-50">
            <FiRefreshCw className={dataLoading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {error ? <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
        {message ? <div className="border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{message}</div> : null}

        <section className="overflow-x-auto border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Requested</th>
                <th className="px-4 py-3 text-right">Approved</th>
                <th className="px-4 py-3 text-right">Used</th>
                <th className="px-4 py-3 text-right">Available</th>
                <th className="px-4 py-3 text-right">Advance</th>
                <th className="px-4 py-3 text-right">Capacity</th>
                <th className="px-4 py-3">Terms</th>
                <th className="px-4 py-3">Agreement</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => {
                const agreement = latestAgreementByBusiness.get(account.businessAccountId);
                const canGenerate = ["APPROVED", "ACTIVE"].includes(account.status)
                  && (!agreement || ["DRAFT", "DECLINED", "EXPIRED", "SUPERSEDED"].includes(agreement.status));
                return (
                  <tr key={account.businessAccountId} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-950">{account.businessAccount?.companyName}</p>
                      <p className="mt-1 text-xs text-slate-500">{account.businessAccount?.accountId}</p>
                    </td>
                    <td className="px-4 py-3"><CreditStatusBadge status={account.status} /></td>
                    <td className="px-4 py-3 text-right font-medium">{formatCreditMoney(account.requestedCreditLimitMinor, account.currency)}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatCreditMoney(account.approvedCreditLimitMinor, account.currency)}</td>
                    <td className="px-4 py-3 text-right">{formatCreditMoney(account.usedCreditMinor, account.currency)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatCreditMoney(account.availableCreditMinor, account.currency)}</td>
                    <td className="px-4 py-3 text-right">{formatCreditMoney(account.availableAdvanceMinor, account.currency)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatCreditMoney(account.availableBookingCapacityMinor, account.currency)}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{account.paymentTermsDays ? `${account.paymentTermsDays} days` : "Due immediately"}</p>
                      <p className="mt-1 text-xs text-slate-500">{account.billingCycle}</p>
                    </td>
                    <td className="px-4 py-3">
                      {agreement ? <><p className="font-medium text-slate-900">{agreement.status.replaceAll("_", " ")}</p><p className="mt-1 text-xs text-slate-500">{agreement.agreementNumber}</p></> : <span className="text-slate-500">Not generated</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex min-w-max flex-wrap gap-2">
                        <Link href={`/dashboard/credit-accounts/${account.businessAccountId}`} className="inline-flex h-8 items-center gap-1 border border-slate-200 px-2.5 font-semibold text-blue-900"><FiEye /> Account</Link>
                        <button type="button" onClick={() => setSelected(account)} className="inline-flex h-8 items-center gap-1 border border-slate-200 px-2.5 font-semibold text-blue-900"><FiEdit2 /> Configure</button>
                        {canGenerate ? <button type="button" onClick={() => void generateAgreement(account, agreement)} disabled={busyId === account.businessAccountId} className="inline-flex h-8 items-center gap-1 border border-blue-200 px-2.5 font-semibold text-blue-900 disabled:opacity-50"><FiFileText /> {busyId === account.businessAccountId ? "Generating..." : "Generate Agreement"}</button> : null}
                        {agreement?.generatedDocument ? <button type="button" onClick={() => setPreviewAgreement(agreement)} className="inline-flex h-8 items-center gap-1 border border-blue-200 px-2.5 font-semibold text-blue-900"><FiEye /> View</button> : null}
                        {account.status === "APPROVED" ? <button type="button" onClick={() => void activate(account)} disabled={busyId === account.businessAccountId} className="inline-flex h-8 items-center gap-1 border border-emerald-200 px-2.5 font-semibold text-emerald-700 disabled:opacity-50"><FiCheck /> Activate</button> : null}
                        {['PENDING_REVIEW', 'APPROVED'].includes(account.status) ? <button type="button" onClick={() => void reject(account)} disabled={busyId === account.businessAccountId} className="inline-flex h-8 items-center gap-1 border border-red-200 px-2.5 font-semibold text-red-700 disabled:opacity-50"><FiX /> Reject</button> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!dataLoading && !accounts.length ? <p className="p-8 text-center text-sm text-slate-500">No approved business accounts are available.</p> : null}
        </section>
      </div>

      {selected ? <CreditApprovalDialog account={selected} onClose={() => setSelected(null)} onSaved={saved} /> : null}
      {previewAgreement ? <CreditAgreementPreviewDialog agreement={previewAgreement} onClose={() => setPreviewAgreement(null)} /> : null}
    </BusinessAccountsShell>
  );
}
