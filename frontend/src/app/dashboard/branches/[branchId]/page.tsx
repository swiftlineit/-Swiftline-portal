"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FiChevronDown } from "react-icons/fi";
import BranchesShell, { BranchesLoading } from "@/components/branches/BranchesShell";
import { Branch, formatBranchLabel, getBranch, listBranches } from "@/lib/branches";
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
import { useAdminUser } from "@/lib/useAdminUser";

type BranchTab = "overview" | "businessAccounts" | "shipments" | "finance" | "tickets";

const branchTabs: Array<{ id: BranchTab; label: string; enabled: boolean }> = [
  { id: "overview", label: "Overview", enabled: true },
  { id: "businessAccounts", label: "Business Accounts", enabled: true },
  { id: "shipments", label: "Shipments", enabled: false },
  { id: "finance", label: "Finance", enabled: false },
  { id: "tickets", label: "Tickets", enabled: false }
];

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

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value || "Not Set"}</p>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-2 text-lg font-semibold text-slate-950">{value || "Not Set"}</p>
    </div>
  );
}

function formatStatus(status: string) {
  return formatBranchLabel(status);
}

function formatValues(values: string[]) {
  return values.length ? values.map(formatBranchLabel).join(", ") : "Not Set";
}

function formatDeposit(account: BusinessAccount) {
  if (account.depositStatus === "required") return "Required";
  if (account.depositStatus === "received") return "Received";
  if (account.depositStatus === "not_required") return "Not Required";
  return "Not Set";
}

function formatKycStatus(account: BusinessAccount) {
  return account.kycReview?.overallStatus ? formatStatus(account.kycReview.overallStatus) : "Not Set";
}

function getKycReason(account: BusinessAccount) {
  return Object.values(account.kycReview?.checks ?? {}).find((check) => check?.note)?.note ?? "";
}

function getAssignedBranch(account: BusinessAccount) {
  return account.assignedBranch && typeof account.assignedBranch === "object" ? account.assignedBranch : null;
}

export default function BranchDetailPage() {
  const params = useParams<{ branchId: string }>();
  const router = useRouter();
  const { user, loading } = useAdminUser();
  const [branch, setBranch] = useState<Branch | null>(null);
  const [linkedAccounts, setLinkedAccounts] = useState<BusinessAccount[]>([]);
  const [activeTab, setActiveTab] = useState<BranchTab>("overview");
  const [branchLoading, setBranchLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingAction, setUpdatingAction] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchSearch, setBranchSearch] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [assigningAccount, setAssigningAccount] = useState<BusinessAccount | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);

  useEffect(() => {
    if (!user || !params.branchId) return;

    let active = true;

    async function loadBranchForRoute() {
      await Promise.resolve();
      if (!active) return;

      setBranchLoading(true);
      setError("");

      try {
        const [branchData, accountsData] = await Promise.all([
          getBranch(params.branchId),
          listBusinessAccounts("", params.branchId)
        ]);

        if (!active) return;
        setBranch(branchData.branch);
        setLinkedAccounts(accountsData.accounts);
      } catch (caughtError) {
        if (!active) return;
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load branch.");
      } finally {
        if (active) setBranchLoading(false);
      }
    }

    void loadBranchForRoute();

    return () => {
      active = false;
    };
  }, [params.branchId, user]);

  async function refreshAccount(accountId: string, updater: () => Promise<{ account: BusinessAccount }>) {
    setUpdatingAction(accountId);
    setError("");

    try {
      const data = await updater();
      const assignedBranch = getAssignedBranch(data.account);
      setLinkedAccounts((current) => {
        if (assignedBranch && assignedBranch._id !== params.branchId) {
          return current.filter((account) => account.accountId !== accountId);
        }

        return current.map((account) => account.accountId === accountId ? data.account : account);
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to update business account.");
    } finally {
      setUpdatingAction(null);
    }
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

  async function handleAccountMenuChange(account: BusinessAccount, value: string) {
    if (!value || value.startsWith("current:")) return;

    if (value === "view" || value === "kyc") {
      router.push(`/dashboard/business-accounts/${account.accountId}`);
      return;
    }

    if (value === "submit") {
      await refreshAccount(account.accountId, () => submitBusinessAccount(account.accountId));
      return;
    }

    if (value === "assign_branch") {
      await openAssignBranchModal(account);
      return;
    }

    if (value.startsWith("status:")) {
      await refreshAccount(account.accountId, () => updateBusinessAccountStatus(account.accountId, value.replace("status:", "") as BusinessAccountStatus));
      return;
    }

    if (value.startsWith("operation:")) {
      await refreshAccount(account.accountId, () => updateBusinessAccountOperationalAction(account.accountId, value.replace("operation:", "") as BusinessAccountOperationalAction));
    }
  }

  if (loading || !user) return <BranchesLoading />;

  const filteredBranches = branches.filter((item) =>
    `${item.name} ${item.code} ${item.address.city} ${item.address.countryName}`
      .toLowerCase()
      .includes(branchSearch.toLowerCase())
  );

  return (
    <BranchesShell user={user}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">{branch?.name ?? "Branch Details"}</h1>
          <p className="mt-1 text-sm text-slate-500">{branch?.code ?? "Review branch profile and operating setup."}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {branch ? (
            <Link href={`/dashboard/branches/${branch._id}/edit`} className="bg-blue-900 px-4 py-2 text-sm font-semibold text-white">
              Edit Branch
            </Link>
          ) : null}
          <Link href="/dashboard/branches" className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
            Back to Branches
          </Link>
        </div>
      </div>

      {error ? <div className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

      {branchLoading ? (
        <div className="border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">Loading branch...</div>
      ) : branch ? (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
            {branchTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                disabled={!tab.enabled}
                onClick={() => setActiveTab(tab.id)}
                className={[
                  "border px-4 py-2 text-sm font-semibold transition",
                  activeTab === tab.id
                    ? "border-blue-900 bg-blue-900 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-blue-900 hover:text-blue-900",
                  !tab.enabled ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 hover:border-slate-200 hover:text-slate-400" : ""
                ].join(" ")}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "overview" ? <BranchOverview branch={branch} accountCount={linkedAccounts.length} /> : null}
          {activeTab === "businessAccounts" ? (
            <BranchBusinessAccounts
              accounts={linkedAccounts}
              updatingAction={updatingAction}
              onAccountMenuChange={handleAccountMenuChange}
            />
          ) : null}
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
    </BranchesShell>
  );
}

function BranchOverview({ branch, accountCount }: { branch: Branch; accountCount: number }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <SummaryTile label="Status" value={formatBranchLabel(branch.status)} />
        <SummaryTile label="Base Currency" value={branch.baseCurrency} />
        <SummaryTile label="Linked Accounts" value={accountCount} />
        <SummaryTile label="Opening Date" value={branch.openingDate ? new Date(branch.openingDate).toLocaleDateString() : ""} />
      </div>

      <section className="border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Branch Profile</h2>
            <p className="mt-1 text-sm text-slate-500">{branch.description || "No branch description added."}</p>
          </div>
          <span className="border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase text-slate-600">
            {formatBranchLabel(branch.status)}
          </span>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <DetailRow label="Branch Name" value={branch.name} />
          <DetailRow label="Branch Code" value={branch.code} />
          <DetailRow label="Created By" value={branch.createdBy?.name || branch.createdBy?.email || ""} />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-950">Address and Contact</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <DetailRow label="Country" value={branch.address.countryName || branch.address.countryCode} />
            <DetailRow label="City" value={branch.address.city} />
            <DetailRow label="Postal Code" value={branch.address.postalCode} />
            <DetailRow label="Email" value={branch.contact.email} />
            <DetailRow label="Phone" value={branch.contact.phone} />
            <div className="md:col-span-2">
              <DetailRow label="Full Address" value={branch.address.address} />
            </div>
          </div>
        </section>

        <section className="border border-slate-200 bg-white p-5">
          <h2 className="text-base font-semibold text-slate-950">Operations</h2>
          <div className="mt-4 grid gap-4">
            <DetailRow label="Supported Services" value={formatValues(branch.operations.supportedServices)} />
            <DetailRow label="Shipment Coverage" value={formatValues(branch.operations.shipmentCoverage)} />
            <DetailRow label="Operating Countries" value={branch.operations.operatingCountries.join(", ") || "Not Set"} />
            <DetailRow label="Working Days" value={formatValues(branch.operations.workingDays)} />
          </div>
        </section>
      </div>
    </div>
  );
}

function BranchBusinessAccounts({
  accounts,
  updatingAction,
  onAccountMenuChange
}: {
  accounts: BusinessAccount[];
  updatingAction: string | null;
  onAccountMenuChange: (account: BusinessAccount, value: string) => Promise<void>;
}) {
  return (
    <section className="border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Business Accounts</h2>
          <p className="mt-1 text-sm text-slate-500">{accounts.length} linked to this branch.</p>
        </div>
        <Link href="/dashboard/business-accounts/create" className="bg-blue-900 px-4 py-2 text-sm font-semibold text-white">
          Create Business Account
        </Link>
      </div>
      <div className="overflow-x-auto">
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
            {accounts.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No business accounts found.</td></tr>
            ) : accounts.map((account) => {
              const assignedBranch = getAssignedBranch(account);

              return (
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
                    {assignedBranch ? (
                      <>
                        <p className="font-semibold text-slate-700">{assignedBranch.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{assignedBranch.code}</p>
                      </>
                    ) : (
                      <span className="text-slate-500">Not Assigned</span>
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
                        onChange={(event) => void onAccountMenuChange(account, event.target.value)}
                        disabled={updatingAction === account.accountId}
                        aria-label={`Actions for ${account.company.companyName}`}
                        className="h-10 w-full appearance-none border border-slate-300 bg-white px-3 pr-11 text-sm font-semibold capitalize text-slate-700 outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
                      >
                        <option value={`current:${account.status}`}>{updatingAction === account.accountId ? "Updating..." : formatStatus(account.status)}</option>
                        <option value="view">View</option>
                        <option value="kyc">KYC</option>
                        <option value="assign_branch">Assign Branch</option>
                        {account.status === "draft" ? <option value="submit">Submit for Review</option> : null}
                        {lifecycleActions.map((action) => (
                          <option key={action.status} value={`status:${action.status}`}>
                            {action.label}
                          </option>
                        ))}
                        {operationalActions.map((action) => (
                          <option key={action.action} value={`operation:${action.action}`}>
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
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AssignBranchModal({
  account,
  branches,
  branchSearch,
  selectedBranchId,
  branchesLoading,
  updating,
  onSearchChange,
  onSelectBranch,
  onCancel,
  onAssign
}: {
  account: BusinessAccount;
  branches: Branch[];
  branchSearch: string;
  selectedBranchId: string;
  branchesLoading: boolean;
  updating: boolean;
  onSearchChange: (value: string) => void;
  onSelectBranch: (value: string) => void;
  onCancel: () => void;
  onAssign: () => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/40 px-4">
      <div className="w-full max-w-xl border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-950">Assign Branch</h2>
          <p className="mt-1 text-sm text-slate-500">
            {account.company.companyName} - {account.accountId}
          </p>
        </div>

        <div className="space-y-4 p-5">
          <label className="block text-sm font-semibold text-slate-700">
            Search Branch
            <input
              value={branchSearch}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Branch name, code, city, country"
              className="mt-2 block h-10 w-full border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <div className="max-h-72 overflow-y-auto border border-slate-200">
            {branchesLoading ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">Loading active branches...</p>
            ) : branches.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">No active branches found.</p>
            ) : branches.map((branch) => (
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
                  onChange={() => onSelectBranch(branch._id)}
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
            onClick={onCancel}
            disabled={updating}
            className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-blue-900 hover:text-blue-900 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onAssign()}
            disabled={!selectedBranchId || updating}
            className="bg-blue-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {updating ? "Assigning..." : "Assign Branch"}
          </button>
        </div>
      </div>
    </div>
  );
}
