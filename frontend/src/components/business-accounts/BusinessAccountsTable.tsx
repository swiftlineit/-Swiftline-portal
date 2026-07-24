"use client";

import { FiChevronDown } from "react-icons/fi";
import {
  BusinessAccount,
  BusinessAccountOperationalAction,
  BusinessAccountStatus,
  businessAccountStatusTransitions
} from "@/lib/businessAccounts";

// Shared business-account table used by the accounts list and the branch detail
// page, so both stay in step instead of drifting as two hand-maintained copies.

const lifecycleActions: { label: string; status: BusinessAccountStatus }[] = [
  { label: "Approve", status: "approved" },
  { label: "Reject", status: "rejected" },
  { label: "Activate Account", status: "active" },
  { label: "Suspend Account", status: "suspended" }
];

const operationalActions: { label: string; action: BusinessAccountOperationalAction }[] = [
  { label: "Deposit Required", action: "deposit_required" },
  { label: "Deposit Received", action: "deposit_received" },
  { label: "View Ledger", action: "ledger_viewed" }
];

export function formatAccountStatus(status: string) {
  return status.replaceAll("_", " ");
}

function getStatusBadgeClasses(status: string) {
  switch (status) {
    case "active":
      return "bg-[#0D1282]/10 text-[#0D1282] ring-1 ring-[#0D1282]/20";
    case "approved":
    case "pending_review":
      return "bg-[#F0DE36]/25 text-[#8a7a00] ring-1 ring-[#F0DE36]/50";
    case "rejected":
    case "suspended":
      return "bg-[#D71313]/10 text-[#D71313] ring-1 ring-[#D71313]/20";
    default:
      return "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
  }
}

function getKycBadgeClasses(status?: string) {
  if (!status) return "bg-slate-100 text-slate-500 ring-1 ring-slate-200";
  if (status === "verified") return "bg-[#0D1282]/10 text-[#0D1282] ring-1 ring-[#0D1282]/20";
  if (status === "additional_information_required") return "bg-[#F0DE36]/25 text-[#8a7a00] ring-1 ring-[#F0DE36]/50";
  if (status === "rejected") return "bg-[#D71313]/10 text-[#D71313] ring-1 ring-[#D71313]/20";
  return "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
}

function formatDeposit(account: BusinessAccount) {
  if (account.depositStatus === "required") return "Required";
  if (account.depositStatus === "received") return "Received";
  if (account.depositStatus === "not_required") return "Not required";
  return "—";
}

function formatKycStatus(account: BusinessAccount) {
  return account.kycReview?.overallStatus ? formatAccountStatus(account.kycReview.overallStatus) : "—";
}

// Only checks flagged as information_required carry a reason worth surfacing.
function getKycReason(account: BusinessAccount) {
  return Object.values(account.kycReview?.checks ?? {})
    .find((check) => check?.status === "information_required" && check?.note)?.note ?? "";
}

export function getAssignedBranch(account: BusinessAccount) {
  return account.assignedBranch && typeof account.assignedBranch === "object" ? account.assignedBranch : null;
}

export function BusinessAccountsTable({
  accounts,
  loading = false,
  updatingAccountId,
  emptyMessage = "No business accounts found.",
  onAccountMenuChange
}: {
  accounts: BusinessAccount[];
  loading?: boolean;
  updatingAccountId: string | null;
  emptyMessage?: string;
  onAccountMenuChange: (account: BusinessAccount, value: string) => void | Promise<void>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-[#0D1282] text-xs uppercase tracking-wide text-white">
          <tr>
            <th className="px-4 py-3.5 font-semibold">Company</th>
            <th className="px-4 py-3.5 font-semibold">Credit</th>
            <th className="px-4 py-3.5 font-semibold">Outstanding</th>
            <th className="px-4 py-3.5 font-semibold">Status</th>
            <th className="px-4 py-3.5 font-semibold">Deposit</th>
            <th className="px-4 py-3.5 font-semibold">Branch</th>
            <th className="px-4 py-3.5 font-semibold">KYC</th>
            <th className="px-4 py-3.5 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading ? (
            <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">Loading accounts...</td></tr>
          ) : accounts.length === 0 ? (
            <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">{emptyMessage}</td></tr>
          ) : accounts.map((account) => {
            const assignedBranch = getAssignedBranch(account);
            const isUpdating = updatingAccountId === account.accountId;

            return (
              <tr key={account.accountId} className="transition-colors hover:bg-[#EEEDED]/40">
                <td className="px-4 py-3.5">
                  <p className="font-semibold text-slate-900">{account.company.companyName}</p>
                  <p className="mt-1 text-xs font-semibold text-[#0D1282]">{account.accountId}</p>
                  <p className="mt-1 text-xs text-slate-500">{account.contact.firstName} {account.contact.lastName}</p>
                </td>
                <td className="px-4 py-3.5 text-slate-400">—</td>
                <td className="px-4 py-3.5 text-slate-400">—</td>
                <td className="px-4 py-3.5">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${getStatusBadgeClasses(account.status)}`}>
                    {formatAccountStatus(account.status)}
                  </span>
                </td>
                <td className="px-4 py-3.5 text-slate-700">{formatDeposit(account)}</td>
                <td className="px-4 py-3.5">
                  {assignedBranch ? (
                    <>
                      <p className="font-semibold text-slate-700">{assignedBranch.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{assignedBranch.code}</p>
                    </>
                  ) : (
                    <span className="text-slate-400">Not assigned</span>
                  )}
                </td>
                <td className="px-4 py-3.5">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${getKycBadgeClasses(account.kycReview?.overallStatus)}`}>
                    {formatKycStatus(account)}
                  </span>
                  {account.kycReview?.overallStatus === "additional_information_required" && getKycReason(account) ? (
                    <p className="mt-1.5 max-w-40 text-xs font-medium text-[#8a7a00]">{getKycReason(account)}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3.5">
                  <div className="relative w-48">
                    <select
                      value={`current:${account.status}`}
                      onChange={(event) => void onAccountMenuChange(account, event.target.value)}
                      disabled={isUpdating}
                      aria-label={`Actions for ${account.company.companyName}`}
                      className="h-10 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-10 text-sm font-semibold capitalize text-slate-700 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-[#0D1282]/15 disabled:opacity-60"
                    >
                      <option value={`current:${account.status}`}>
                        {isUpdating ? "Updating..." : formatAccountStatus(account.status)}
                      </option>
                      <option value="view">View</option>
                      <option value="kyc">KYC</option>
                      <option value="assign_branch">Assign Branch</option>
                      {account.status === "draft" ? <option value="submit">Submit for Review</option> : null}
                      {lifecycleActions
                        .filter((action) => businessAccountStatusTransitions[account.status].includes(action.status))
                        .map((action) => (
                          <option key={action.status} value={`status:${action.status}`}>
                            {action.label}
                          </option>
                        ))}
                      {["approved", "active"].includes(account.status)
                        ? operationalActions.map((action) => (
                            <option key={action.action} value={`operation:${action.action}`}>
                              {action.label}
                            </option>
                          ))
                        : null}
                    </select>
                    <FiChevronDown
                      aria-hidden="true"
                      className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0D1282]"
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
