"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DashboardShell, { DashboardLoading } from "@/components/DashboardShell";
import { AssignBranchModal } from "@/components/business-accounts/AssignBranchModal";
import { BusinessAccountsTable, getAssignedBranch } from "@/components/business-accounts/BusinessAccountsTable";
import {
  assignBusinessAccountBranch,
  BusinessAccount,
  BusinessAccountOperationalAction,
  BusinessAccountStatus,
  listBusinessAccounts,
  submitBusinessAccount,
  updateBusinessAccountOperationalAction,
  updateBusinessAccountStatus
} from "@/lib/businessAccounts";
import { Branch, listBranches } from "@/lib/branches";
import { CreditAccount, listAdminCreditAccounts } from "@/lib/creditAccounts";
import { useAdminUser } from "@/lib/useAdminUser";

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
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  // Credit facilities keyed by business account _id, loaded once: the endpoint
  // returns every account with credit, so it needs no search or page argument.
  const [creditByBusinessId, setCreditByBusinessId] = useState<Map<string, CreditAccount>>(new Map());
  const pageSize = 10;

  useEffect(() => {
    if (!user) return;

    async function loadAccounts() {
      setAccountsLoading(true);
      setError("");

      try {
        const data = await listBusinessAccounts(search, "", page, pageSize);
        setAccounts(data.accounts);
        setTotal(data.total ?? data.accounts.length);
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
  }, [search, user, page]);

  useEffect(() => {
    if (!user) return;
    // The credit columns are supporting detail, so a failure here leaves them
    // blank rather than blocking the accounts list.
    void listAdminCreditAccounts()
      .then((data) => setCreditByBusinessId(
        new Map(data.creditAccounts.map((account) => [account.businessAccountId, account]))
      ))
      .catch(() => setCreditByBusinessId(new Map()));
  }, [user]);

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

  async function handleOperationalAction(account: BusinessAccount, action: BusinessAccountOperationalAction) {
    await refreshAccount(account.accountId, () => updateBusinessAccountOperationalAction(account.accountId, action));
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
      return;
    }

    if (value.startsWith("operation:")) {
      await handleOperationalAction(account, value.replace("operation:", "") as BusinessAccountOperationalAction);
    }
  }

  if (loading || !user) return <DashboardLoading />;

  // The server returns the current page of accounts; totals drive the pager.
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const visibleAccounts = accounts;
  const filteredBranches = branches.filter((branch) =>
    `${branch.name} ${branch.code} ${branch.address.city} ${branch.address.countryName}`
      .toLowerCase()
      .includes(branchSearch.toLowerCase())
  );

  return (
    <DashboardShell user={user}>
      <div className="min-h-full bg-[#EEEDED]/60 -m-6 p-6 lg:-m-8 lg:p-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#0D1282]">Business Accounts</h1>
            <p className="mt-1 text-sm text-slate-500">Create, view, and manage draft or pending-review accounts.</p>
          </div>
          <Link
            href="/dashboard/business-accounts/create"
            className="inline-flex items-center gap-2 rounded-4xl bg-[#0D1282] px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-[#0D1282]/20 transition hover:bg-[#0a0d63] focus:outline-none focus:ring-2 focus:ring-[#0D1282]/40 focus:ring-offset-2"
          >
            <span className="text-base leading-none">+</span> Create Business Account
          </Link>
        </div>

        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="block text-sm font-semibold text-slate-700">
            Search
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Account ID, company, contact, email, mobile, registration ID"
              className="mt-2 block w-full rounded-lg border border-slate-200 bg-[#EEEDED]/50 px-3 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#0D1282] focus:bg-white focus:ring-2 focus:ring-[#0D1282]/15"
            />
          </label>
        </div>

        {error ? (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-[#D71313]/25 bg-[#D71313]/5 px-4 py-3 text-sm font-medium text-[#D71313]">
            {error}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <BusinessAccountsTable
            accounts={visibleAccounts}
            loading={accountsLoading}
            updatingAccountId={updatingAction}
            creditByBusinessId={creditByBusinessId}
            onAccountMenuChange={handleAccountMenuChange}
          />
        </div>

        {total > pageSize ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm text-slate-600 shadow-sm">
            <p>
              Showing <span className="font-semibold text-slate-800">{startIndex + 1}-{Math.min(startIndex + pageSize, total)}</span> of{" "}
              <span className="font-semibold text-slate-800">{total}</span> accounts
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={safePage === 1}
                className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:text-slate-700"
              >
                Previous
              </button>
              <span className="rounded-lg bg-[#0D1282]/10 px-3 py-2 font-semibold text-[#0D1282]">Page {safePage} of {totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={safePage === totalPages}
                className="rounded-lg border border-slate-200 px-3.5 py-2 font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:text-slate-700"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}

        {assigningAccount ? (
          <AssignBranchModal
            account={assigningAccount}
            branches={filteredBranches}
            branchSearch={branchSearch}
            selectedBranchId={selectedBranchId}
            branchesLoading={branchesLoading}
            updating={updatingAction === assigningAccount.accountId}
            onSearchChange={setBranchSearch}
            onSelectBranch={setSelectedBranchId}
            onCancel={closeAssignBranchModal}
            onAssign={handleAssignBranch}
          />
        ) : null}
      </div>
    </DashboardShell>
  );
}