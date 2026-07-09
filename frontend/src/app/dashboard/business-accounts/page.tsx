"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FiChevronDown } from "react-icons/fi";
import BusinessAccountsShell, { BusinessAccountsLoading } from "@/components/business-accounts/BusinessAccountsShell";
import {
  assignBusinessAccountBranch,
  BusinessAccount,
  BusinessAccountStatus,
  listBusinessAccounts,
  submitBusinessAccount,
  updateBusinessAccountStatus
} from "@/lib/businessAccounts";
import { Branch, listBranches } from "@/lib/branches";
import { useAdminUser } from "@/lib/useAdminUser";

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

function formatDeposit(account: BusinessAccount) {
  if (account.status === "deposit_required") return "Required";
  if (account.status === "deposit_received") return "Received";
  return "Not set";
}

function formatKycStatus(account: BusinessAccount) {
  return account.kycReview?.overallStatus ? formatStatus(account.kycReview.overallStatus) : "null";
}

function getKycReason(account: BusinessAccount) {
  return Object.values(account.kycReview?.checks ?? {}).find((check) => check?.note)?.note ?? "";
}

function getAssignedBranch(account: BusinessAccount) {
  return account.assignedBranch && typeof account.assignedBranch === "object" ? account.assignedBranch : null;
}

const accountActions: { label: string; status: BusinessAccountStatus }[] = [
  { label: "Approve", status: "approved" },
  { label: "Reject", status: "rejected" },
  { label: "Credit Limit Approved", status: "credit_limit_approved" },
  { label: "Credit Limit Not Approved", status: "credit_limit_not_approved" },
  { label: "Deposit Required", status: "deposit_required" },
  { label: "Deposit Received", status: "deposit_received" },
  { label: "Activate Account", status: "active" },
  { label: "Suspend Account", status: "suspended" },
  { label: "Generate Agreement", status: "agreement_generated" },
  { label: "View Ledger", status: "ledger_viewed" }
];

export default function BusinessAccountsPage() {
  const router = useRouter();
  const { user, loading } = useAdminUser();
  const [accounts, setAccounts] = useState<BusinessAccount[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [updatingAction, setUpdatingAction] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchSearch, setBranchSearch] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [assigningAccount, setAssigningAccount] = useState<BusinessAccount | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);

  useEffect(() => {
    if (!user) return;

    async function loadAccounts() {
      setAccountsLoading(true);
      setError("");

      try {
        const data = await listBusinessAccounts(search);
        setAccounts(data.accounts);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load business accounts.");
      } finally {
        setAccountsLoading(false);
      }
    }

    const timeout = window.setTimeout(() => {
      void loadAccounts();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [search, user]);

  async function refreshAccount(accountId: string, updater: () => Promise<{ account: BusinessAccount }>) {
    setUpdatingAction(accountId);
    setError("");

    try {
      const data = await updater();
      setAccounts((current) => current.map((account) => account.accountId === accountId ? data.account : account));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to update business account.");
    } finally {
      setUpdatingAction(null);
    }
  }

  async function handleStatusAction(account: BusinessAccount, status: BusinessAccountStatus) {
    await refreshAccount(account.accountId, () => updateBusinessAccountStatus(account.accountId, status));
  }

  async function openAssignBranchModal(account: BusinessAccount) {
    const assignedBranch = getAssignedBranch(account);

    setAssigningAccount(account);
    setSelectedBranchId(assignedBranch?._id ?? "");
    setBranchSearch("");
    setBranchesLoading(true);
    setError("");

    try {
      const data = await listBranches("", "ACTIVE");
      setBranches(data.branches);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load branches.");
    } finally {
      setBranchesLoading(false);
    }
  }

  function closeAssignBranchModal() {
    setAssigningAccount(null);
    setSelectedBranchId("");
    setBranchSearch("");
  }

  async function handleAssignBranch() {
    if (!assigningAccount || !selectedBranchId) return;

    await refreshAccount(assigningAccount.accountId, () => assignBusinessAccountBranch(assigningAccount.accountId, selectedBranchId));
    closeAssignBranchModal();
  }

  async function handleSubmitForReview(account: BusinessAccount) {
    await refreshAccount(account.accountId, () => submitBusinessAccount(account.accountId));
  }

  async function handleAccountMenuChange(account: BusinessAccount, value: string) {
    if (!value || value.startsWith("current:")) return;

    if (value === "view") {
      router.push(`/dashboard/business-accounts/${account.accountId}`);
      return;
    }

    if (value === "kyc") {
      router.push(`/dashboard/business-accounts/${account.accountId}`);
      return;
    }

    if (value === "submit") {
      await handleSubmitForReview(account);
      return;
    }

    if (value === "assign_branch") {
      await openAssignBranchModal(account);
      return;
    }

    if (value.startsWith("status:")) {
      await handleStatusAction(account, value.replace("status:", "") as BusinessAccountStatus);
    }
  }

  if (loading || !user) return <BusinessAccountsLoading />;

  const filteredBranches = branches.filter((branch) =>
    `${branch.name} ${branch.code} ${branch.address.city} ${branch.address.countryName}`
      .toLowerCase()
      .includes(branchSearch.toLowerCase())
  );

  return (
    <BusinessAccountsShell user={user}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Business Accounts</h1>
          <p className="mt-1 text-sm text-slate-500">Create, view, and manage draft or pending-review accounts.</p>
        </div>
        <Link href="/dashboard/business-accounts/create" className="bg-blue-900 px-4 py-2 text-sm font-semibold text-white">
          Create Business Account
        </Link>
      </div>

      <div className="mb-4 border border-slate-200 bg-white p-4">
        <label className="block text-sm font-semibold text-slate-700">
          Search
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Account ID, company, contact, email, mobile, registration ID"
            className="mt-2 block w-full border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
          />
        </label>
      </div>

      {error ? <div className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

      <div className="overflow-x-auto border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Credit</th>
              <th className="px-4 py-3">Outstanding</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Deposit</th>
              <th className="px-4 py-3">Branch</th>
              <th className="px-4 py-3">KYC</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {accountsLoading ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">Loading accounts...</td></tr>
            ) : accounts.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No business accounts found.</td></tr>
            ) : accounts.map((account) => (
              <tr key={account.accountId} className="border-b border-slate-100 last:border-b-0">
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-950">{account.company.companyName}</p>
                  <p className="mt-1 text-xs font-semibold text-blue-900">{account.accountId}</p>
                  <p className="mt-1 text-xs text-slate-500">{account.contact.firstName} {account.contact.lastName}</p>
                </td>
                <td className="px-4 py-3 text-slate-500">null</td>
                <td className="px-4 py-3 text-slate-500">Not available</td>
                <td className="px-4 py-3 capitalize">{formatStatus(account.status)}</td>
                <td className="px-4 py-3">{formatDeposit(account)}</td>
                <td className="px-4 py-3">
                  {getAssignedBranch(account) ? (
                    <>
                      <p className="font-semibold text-slate-700">{getAssignedBranch(account)?.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{getAssignedBranch(account)?.code}</p>
                    </>
                  ) : (
                    <span className="text-slate-500">Not assigned</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <p className="capitalize text-slate-700">{formatKycStatus(account)}</p>
                  {account.kycReview?.overallStatus === "additional_information_required" && getKycReason(account) ? (
                    <p className="mt-1 max-w-40 text-xs font-semibold text-orange-700">{getKycReason(account)}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <div className="relative w-48">
                    <select
                      value={`current:${account.status}`}
                      onChange={(event) => void handleAccountMenuChange(account, event.target.value)}
                      disabled={updatingAction === account.accountId}
                      aria-label={`Actions for ${account.company.companyName}`}
                      className="h-10 w-full appearance-none border border-slate-300 bg-white px-3 pr-11 text-sm font-semibold capitalize text-slate-700 outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                    >
                      <option value={`current:${account.status}`}>{updatingAction === account.accountId ? "Updating..." : formatStatus(account.status)}</option>
                      <option value="view">View</option>
                      <option value="kyc">KYC</option>
                      <option value="assign_branch">Assign Branch</option>
                      {account.status === "draft" ? <option value="submit">Submit for Review</option> : null}
                      {accountActions.map((action) => (
                        <option key={action.status} value={`status:${action.status}`}>
                          {action.label}
                        </option>
                      ))}
                    </select>
                    <FiChevronDown
                      aria-hidden="true"
                      className="pointer-events-none absolute right-5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {assigningAccount ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-950">Assign Branch</h2>
              <p className="mt-1 text-sm text-slate-500">
                {assigningAccount.company.companyName} - {assigningAccount.accountId}
              </p>
            </div>

            <div className="space-y-4 p-5">
              <label className="block text-sm font-semibold text-slate-700">
                Search Branch
                <input
                  value={branchSearch}
                  onChange={(event) => setBranchSearch(event.target.value)}
                  placeholder="Branch name, code, city, country"
                  className="mt-2 block h-10 w-full border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
                />
              </label>

              <div className="max-h-72 overflow-y-auto border border-slate-200">
                {branchesLoading ? (
                  <p className="px-4 py-6 text-center text-sm text-slate-500">Loading active branches...</p>
                ) : filteredBranches.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-slate-500">No active branches found.</p>
                ) : filteredBranches.map((branch) => (
                  <label
                    key={branch._id}
                    className={`flex cursor-pointer items-start gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 ${
                      selectedBranchId === branch._id ? "bg-blue-50" : "bg-white hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="assignedBranch"
                      checked={selectedBranchId === branch._id}
                      onChange={() => setSelectedBranchId(branch._id)}
                      className="mt-1 h-4 w-4"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">{branch.name}</span>
                      <span className="mt-1 block text-xs font-semibold text-blue-900">{branch.code}</span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {[branch.address.city, branch.address.countryName].filter(Boolean).join(", ") || "Location not set"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={closeAssignBranchModal}
                disabled={updatingAction === assigningAccount.accountId}
                className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-blue-900 hover:text-blue-900 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleAssignBranch()}
                disabled={!selectedBranchId || updatingAction === assigningAccount.accountId}
                className="bg-blue-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-950 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {updatingAction === assigningAccount.accountId ? "Assigning..." : "Assign Branch"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </BusinessAccountsShell>
  );
}
