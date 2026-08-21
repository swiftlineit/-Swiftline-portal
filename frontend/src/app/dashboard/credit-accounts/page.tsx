"use client";

import { useEffect, useMemo, useState } from "react";
import { FiCheck, FiEye, FiFileText, FiRefreshCw, FiX } from "react-icons/fi";
import { GrDocumentConfig } from "react-icons/gr";
import { toast } from "react-toastify";

import { DashboardLoading } from "@/components/DashboardShell";
import CreditAgreementPreviewDialog from "@/components/credit/CreditAgreementPreviewDialog";
import CreditApprovalDialog from "@/components/credit/CreditApprovalDialog";
import CreditRowActions from "@/components/credit/CreditRowActions";
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
  CreditAccountStatus,
  formatCreditMoney,
  listAdminCreditAccounts,
  rejectCreditAccount
} from "@/lib/creditAccounts";
import { CREDIT_VIEW_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

const creditAccountStatuses: CreditAccountStatus[] = [
  "NOT_REQUESTED",
  "PENDING_REVIEW",
  "APPROVED",
  "ACTIVE",
  "ON_HOLD",
  "SUSPENDED",
  "EXPIRED",
  "REJECTED",
  "CLOSED"
];

export default function AdminCreditAccountsPage() {
  // Operations reads credit records; approving, activating, and rejecting stay
  // with finance, matching the write guards on the credit router.
  const { user, loading } = useAdminUser(CREDIT_VIEW_AREA);
  const canSettle = user?.role === "admin" || user?.role === "finance";
  const [accounts, setAccounts] = useState<CreditAccount[]>([]);
  const [agreements, setAgreements] = useState<CreditAgreement[]>([]);
  const [status, setStatus] = useState<CreditAccountStatus | "">("");
  const [selected, setSelected] = useState<CreditAccount | null>(null);
  const [previewAgreement, setPreviewAgreement] = useState<CreditAgreement | null>(null);
  const [busyId, setBusyId] = useState("");
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
    try {
      const [creditResult, agreementResult] = await Promise.all([
        listAdminCreditAccounts(status),
        listAdminCreditAgreements()
      ]);
      setAccounts(creditResult.creditAccounts);
      setAgreements(agreementResult.agreements);
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : "Unable to load credit accounts.");
    } finally {
      setDataLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    let active = true;
    Promise.all([listAdminCreditAccounts(status), listAdminCreditAgreements()])
      .then(([creditResult, agreementResult]) => {
        if (!active) return;
        setAccounts(creditResult.creditAccounts);
        setAgreements(agreementResult.agreements);
      })
      .catch((caughtError: unknown) => {
        if (active) toast.error(caughtError instanceof Error ? caughtError.message : "Unable to load credit accounts.");
      })
      .finally(() => {
        if (active) setDataLoading(false);
      });
    return () => { active = false; };
  }, [user, status]);

  async function saved(notice: string) {
    setSelected(null);
    toast.success(notice);
    await loadData();
  }

  async function activate(account: CreditAccount) {
    setBusyId(account.businessAccountId);
    try {
      const result = await activateCreditAccount(account.businessAccountId);
      // Fired on the response, before the refetch: awaiting the reload first
      // is what made these appear seconds after the click.
      toast.success(result.message);
      await loadData();
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : "Unable to activate credit.");
    } finally {
      setBusyId("");
    }
  }

  async function reject(account: CreditAccount) {
    const reason = window.prompt("Reason for rejecting this credit request:")?.trim();
    if (!reason) return;
    setBusyId(account.businessAccountId);
    try {
      const result = await rejectCreditAccount(account.businessAccountId, reason);
      toast.success(result.message);
      await loadData();
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : "Unable to reject credit.");
    } finally {
      setBusyId("");
    }
  }

  async function generateAgreement(account: CreditAccount, existing?: CreditAgreement) {
    setBusyId(account.businessAccountId);
    try {
      const draft = existing?.status === "DRAFT"
        ? existing
        : (await createAdminCreditAgreementDraft(account.businessAccountId)).agreement;
      const result = await generateAdminCreditAgreement(draft.id);
      toast.success(result.message);
      setPreviewAgreement(result.agreement);
      await loadData();
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : "Unable to generate the credit agreement.");
    } finally {
      setBusyId("");
    }
  }

  if (loading || !user) return <DashboardLoading />;

  return (
    <>
      <div className="mx-auto max-w-375 space-y-6" style={{ backgroundColor: "#EEEDED" }}>
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#0D1282" }}>
              Business Accounts
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">Credit Accounts</h1>
            <p className="mt-1 text-sm text-slate-500">Review, approve, and manage business credit facilities.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
  <select
    value={status}
    onChange={(event) => setStatus(event.target.value as CreditAccountStatus | "")}
    className="h-10 w-full appearance-none rounded-lg border border-slate-300 bg-white pl-3 pr-8 text-sm font-semibold text-slate-700 outline-none focus:border-[#0D1282]"
  >
    <option value="">All Status</option>
    {creditAccountStatuses.map((item) => (
      <option key={item} value={item}>{item.replaceAll("_", " ")}</option>
    ))}
  </select>
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
</div>
            {/* <button
              type="button"
              onClick={() => void loadData()}
              disabled={dataLoading}
              className="inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "#0D1282" }}
            >
              <FiRefreshCw className={dataLoading ? "animate-spin" : ""} />
              Refresh
            </button> */}
          </div>
        </div>

        {/* Table card */}
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="bg-slate-100 text-black">
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide ">Customer</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide ">Status</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide ">Used</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide ">Outstanding</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide ">Total Owed</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide ">Available</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide ">Advance</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide ">Terms</th>
                  <th className="whitespace-nowrap px-4 py-3.5 text-left text-xs font-semibold uppercase tracking-wide ">Actions</th>
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
                      id={`credit-account-${account.businessAccountId}`}
                      className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50"
                      style={{ backgroundColor: index % 2 === 0 ? "#FFFFFF" : "#FAFAFA" }}
                    >
                      <td className="px-4 py-4 text-left">
                        <p className="font-semibold text-slate-900 capitalize">{account.businessAccount?.companyName}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{account.businessAccount?.accountId}</p>
                        {/* Agreement state sits with the customer it belongs to, rather
                            than taking a column of its own. */}
                        <p className="mt-1 text-[11px] font-medium capitalize text-slate-500">
                          {agreement ? agreement.status.replaceAll("_", " ") : "Not generated"}
                        </p>
                        {account.limitIncreaseRequest ? (
                          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                            Wants {formatCreditMoney(account.limitIncreaseRequest.requestedLimitMinor, account.currency)}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-4 text-left">
                        <CreditStatusBadge status={account.status} />
                      </td>
                      <td className="px-4 py-4 text-left text-slate-600">
                        {formatCreditMoney(account.usedCreditMinor, account.currency)}
                      </td>
                      <td className="px-4 py-4 text-left text-slate-600">
                        {formatCreditMoney(account.invoicedOutstandingMinor, account.currency)}
                      </td>
                      {/* Unbilled plus invoiced. Outstanding alone reads as zero until a
                          cycle closes, so it hid balances that were genuinely owed. */}
                      <td className="px-4 py-4 text-left font-medium text-slate-800">
                        {formatCreditMoney(account.totalOwedMinor, account.currency)}
                      </td>
                      <td className="px-4 py-4 text-left text-slate-600">
                        {formatCreditMoney(account.availableCreditMinor, account.currency)}
                      </td>
                      <td className="px-4 py-4 text-left text-slate-600">
                        {formatCreditMoney(account.availableAdvanceMinor, account.currency)}
                      </td>
                      <td className="px-4 py-4 text-left">
                        <p className="font-medium text-slate-800">
                          {account.paymentTermsDays ? `${account.paymentTermsDays} days` : "Due immediately"}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">{account.billingCycle}</p>
                      </td>
                      <td className="px-4 py-4 text-left">
                        <CreditRowActions
                          actions={[
                            {
                              label: "View account",
                              icon: <FiEye size={13} aria-hidden="true" />,
                              href: `/dashboard/credit-accounts/${account.businessAccountId}`
                            },
                            ...(canSettle
                              ? [{
                                  label: "Configure",
                                  icon: <GrDocumentConfig size={13} aria-hidden="true" />,
                                  onClick: () => setSelected(account)
                                }]
                              : []),
                            ...(canSettle && canGenerate
                              ? [{
                                  label: isBusy ? "Generating..." : "Generate agreement",
                                  icon: <FiFileText size={13} aria-hidden="true" />,
                                  disabled: isBusy,
                                  onClick: () => void generateAgreement(account, agreement)
                                }]
                              : []),
                            ...(agreement?.generatedDocument
                              ? [{
                                  label: "View agreement",
                                  icon: <FiEye size={13} aria-hidden="true" />,
                                  onClick: () => setPreviewAgreement(agreement)
                                }]
                              : []),
                            ...(canSettle && account.status === "APPROVED"
                              ? [{
                                  label: "Activate",
                                  icon: <FiCheck size={13} aria-hidden="true" />,
                                  disabled: isBusy,
                                  onClick: () => void activate(account)
                                }]
                              : []),
                            ...(canSettle && ["PENDING_REVIEW", "APPROVED"].includes(account.status)
                              ? [{
                                  label: "Reject",
                                  icon: <FiX size={13} aria-hidden="true" />,
                                  danger: true,
                                  disabled: isBusy,
                                  onClick: () => void reject(account)
                                }]
                              : [])
                          ]}
                        />
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
    </>
  );
}