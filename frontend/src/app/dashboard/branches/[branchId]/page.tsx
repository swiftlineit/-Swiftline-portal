"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FiArrowLeft, FiChevronDown, FiEdit2 } from "react-icons/fi";
import DashboardShell, { DashboardLoading } from "@/components/DashboardShell";
import { AssignBranchModal } from "@/components/business-accounts/AssignBranchModal";
import { BusinessAccountsTable, getAssignedBranch } from "@/components/business-accounts/BusinessAccountsTable";
import {
  Branch,
  BranchStatus,
  branchStatusTransitions,
  formatBranchLabel,
  getBranch,
  listBranches,
  updateBranchStatus
} from "@/lib/branches";
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
import { CreditAccount, listAdminCreditAccounts } from "@/lib/creditAccounts";
import { useAdminUser } from "@/lib/useAdminUser";

type BranchTab = "overview" | "businessAccounts" | "shipments" | "finance" | "tickets";

const branchTabs: Array<{ id: BranchTab; label: string; enabled: boolean }> = [
  { id: "overview", label: "Overview", enabled: true },
  { id: "businessAccounts", label: "Business Accounts", enabled: true },
  { id: "shipments", label: "Shipments", enabled: false },
  { id: "finance", label: "Finance", enabled: false },
  { id: "tickets", label: "Tickets", enabled: false }
];

// Human labels for the branch lifecycle actions offered per status.
const branchStatusActionLabels: Record<BranchStatus, string> = {
  DRAFT: "Move to Draft",
  ACTIVE: "Activate",
  INACTIVE: "Deactivate",
  SUSPENDED: "Suspend",
  CLOSED: "Close"
};

function getBranchStatusBadgeClasses(status: BranchStatus) {
  switch (status) {
    case "ACTIVE":
      return "bg-[#0D1282] text-white";
    case "DRAFT":
      return "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
    case "INACTIVE":
      return "bg-[#F0DE36]/25 text-[#8a7a00] ring-1 ring-[#F0DE36]/50";
    case "SUSPENDED":
    case "CLOSED":
      return "bg-[#D71313]/10 text-[#D71313] ring-1 ring-[#D71313]/20";
    default:
      return "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
  }
}

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-lg bg-[#EEEDED]/40 px-3.5 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-slate-800">{value || "—"}</p>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value?: string | number | null }) {
  // A numeric zero is a real value, so only null/undefined/"" fall back to the dash.
  const display = value === null || value === undefined || value === "" ? "—" : value;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-lg font-bold text-[#0D1282]">{display}</p>
    </div>
  );
}

function formatValues(values: string[]) {
  return values.length ? values.map(formatBranchLabel).join(", ") : "";
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
  const [updatingBranchStatus, setUpdatingBranchStatus] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchSearch, setBranchSearch] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [assigningAccount, setAssigningAccount] = useState<BusinessAccount | null>(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  // Credit facilities keyed by business account _id, so the linked-accounts table
  // can show available credit and outstanding alongside each account.
  const [creditByBusinessId, setCreditByBusinessId] = useState<Map<string, CreditAccount>>(new Map());

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
    // Supporting detail for the table, so a failure leaves the credit columns
    // blank rather than breaking the branch page.
    void listAdminCreditAccounts()
      .then((data) => {
        if (active) {
          setCreditByBusinessId(new Map(data.creditAccounts.map((account) => [account.businessAccountId, account])));
        }
      })
      .catch(() => {
        if (active) setCreditByBusinessId(new Map());
      });

    return () => {
      active = false;
    };
  }, [params.branchId, user]);

  async function handleBranchStatusChange(nextStatus: BranchStatus) {
    if (!branch) return;

    setUpdatingBranchStatus(true);
    setError("");

    try {
      const data = await updateBranchStatus(branch._id, nextStatus);
      setBranch(data.branch);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to update branch status.");
    } finally {
      setUpdatingBranchStatus(false);
    }
  }

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

  if (loading || !user) return <DashboardLoading />;

  const filteredBranches = branches.filter((item) =>
    `${item.name} ${item.code} ${item.address.city} ${item.address.countryName}`
      .toLowerCase()
      .includes(branchSearch.toLowerCase())
  );

  return (
    <DashboardShell user={user}>
      <div className="min-h-full bg-[#EEEDED]/60 -m-6 p-6 lg:-m-8 lg:p-8">
        {/* Branch header and lifecycle actions */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Link href="/dashboard/branches" className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 transition hover:text-[#0D1282]">
                <FiArrowLeft aria-hidden="true" className="h-3.5 w-3.5" /> All Branches
              </Link>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold text-slate-950">{branch?.name ?? "Branch Details"}</h1>
                {branch ? (
                  <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${getBranchStatusBadgeClasses(branch.status)}`}>
                    {formatBranchLabel(branch.status)}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm font-semibold text-[#0D1282]">{branch?.code ?? "Review branch profile and operating setup."}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {branch && branchStatusTransitions[branch.status].length ? (
                <div className="relative w-44">
                  <select
                    value=""
                    onChange={(event) => {
                      if (event.target.value) void handleBranchStatusChange(event.target.value as BranchStatus);
                    }}
                    disabled={updatingBranchStatus}
                    aria-label="Change branch status"
                    className="h-10 w-full appearance-none rounded-lg border border-slate-200 bg-white px-3 pr-10 text-sm font-semibold text-slate-700 outline-none transition focus:border-[#0D1282] focus:ring-2 focus:ring-[#0D1282]/15 disabled:opacity-60"
                  >
                    <option value="">{updatingBranchStatus ? "Updating..." : "Change Status"}</option>
                    {branchStatusTransitions[branch.status].map((nextStatus) => (
                      <option key={nextStatus} value={nextStatus}>{branchStatusActionLabels[nextStatus]}</option>
                    ))}
                  </select>
                  <FiChevronDown
                    aria-hidden="true"
                    className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0D1282]"
                  />
                </div>
              ) : null}
              {branch ? (
                <Link
                  href={`/dashboard/branches/${branch._id}/edit`}
                  className="inline-flex items-center gap-2 rounded-4xl border border-slate-200 px-4 py-2.5 text-sm font-semibold shadow-sm shadow-[#0D1282]/20 transition hover:bg-[#0a0d63]"
                >
                  <FiEdit2 aria-hidden="true" className="h-4 w-4" /> Edit Branch
                </Link>
              ) : null}
            </div>
          </div>

          {/* Tab navigation */}
          {branch ? (
            <div className="mt-5 flex flex-wrap gap-1 border-t border-slate-200 pt-4">
              {branchTabs.map((tab) => {
                const isActive = activeTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    disabled={!tab.enabled}
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                      isActive
                        ? "bg-[#0D1282] text-white shadow-sm shadow-[#0D1282]/25"
                        : tab.enabled
                          ? "text-slate-600 hover:bg-[#0D1282]/8 hover:text-[#0D1282]"
                          : "cursor-not-allowed text-slate-300"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="mt-5 rounded-xl border border-[#D71313]/25 bg-[#D71313]/5 px-4 py-3 text-sm font-medium text-[#D71313]">
            {error}
          </div>
        ) : null}

        <div className="mt-5">
          {branchLoading ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500 shadow-sm">
              Loading branch...
            </div>
          ) : branch ? (
            <>
              {activeTab === "overview" ? <BranchOverview branch={branch} accountCount={linkedAccounts.length} /> : null}
              {activeTab === "businessAccounts" ? (
                <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                    <div>
                      <h2 className="text-base font-bold text-[#0D1282]">Business Accounts</h2>
                      <p className="mt-1 text-sm text-slate-500">{linkedAccounts.length} linked to this branch.</p>
                    </div>
                    <Link
                      href="/dashboard/business-accounts/create"
                      className="inline-flex items-center gap-2 rounded-4xl border border-slate-200  px-4 py-2.5 text-sm font-semibold shadow-sm shadow-[#0D1282]/20 transition "
                    >
                      <span className="text-base leading-none">+</span> Create Business Account
                    </Link>
                  </div>
                  <BusinessAccountsTable
                    accounts={linkedAccounts}
                    updatingAccountId={updatingAction}
                    creditByBusinessId={creditByBusinessId}
                    onAccountMenuChange={handleAccountMenuChange}
                  />
                </section>
              ) : null}
            </>
          ) : (
            <div className="rounded-xl border border-[#D71313]/25 bg-[#D71313]/5 p-5">
              <p className="text-sm font-semibold text-[#D71313]">Branch not found.</p>
              <Link href="/dashboard/branches" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#0D1282] hover:underline">
                <FiArrowLeft aria-hidden="true" className="h-4 w-4" /> Back to Branches
              </Link>
            </div>
          )}
        </div>

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

function BranchOverview({ branch, accountCount }: { branch: Branch; accountCount: number }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryTile label="Status" value={formatBranchLabel(branch.status)} />
        <SummaryTile label="Base Currency" value={branch.baseCurrency} />
        <SummaryTile label="Linked Accounts" value={accountCount} />
        <SummaryTile label="Opening Date" value={branch.openingDate ? new Date(branch.openingDate).toLocaleDateString() : ""} />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold text-[#0D1282]">Branch Profile</h2>
        <p className="mt-1 text-sm text-slate-500">{branch.description || "No branch description added."}</p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DetailRow label="Branch Name" value={branch.name} />
          <DetailRow label="Branch Code" value={branch.code} />
          <DetailRow label="Station Code" value={branch.labelCode} />
          <DetailRow label="Created By" value={branch.createdBy?.name || branch.createdBy?.email || ""} />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-bold text-[#0D1282]">Address and Contact</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <DetailRow label="Country" value={branch.address.countryName || branch.address.countryCode} />
            <DetailRow label="City" value={branch.address.city} />
            <DetailRow label="Postal Code" value={branch.address.postalCode} />
            <DetailRow label="State or Province" value={branch.address.stateOrProvince} />
            <DetailRow label="Email" value={branch.contact.email} />
            <DetailRow label="Phone" value={branch.contact.phone} />
            <div className="sm:col-span-2">
              <DetailRow label="Full Address" value={branch.address.address} />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-base font-bold text-[#0D1282]">Operations and Tax</h2>
          <div className="grid gap-4">
            <DetailRow label="Supported Services" value={formatValues(branch.operations.supportedServices)} />
            <DetailRow label="Shipment Coverage" value={formatValues(branch.operations.shipmentCoverage)} />
            <DetailRow label="Operating Countries" value={branch.operations.operatingCountries.join(", ")} />
            <DetailRow label="Working Days" value={formatValues(branch.operations.workingDays)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <DetailRow label="GSTIN" value={branch.gstin} />
              <DetailRow label="Invoice SAC Code" value={branch.invoiceSacCode} />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
