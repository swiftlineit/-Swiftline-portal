"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FiAlertTriangle, FiBriefcase, FiCheckCircle, FiClock, FiCreditCard, FiDownload, FiFileText, FiPrinter, FiRefreshCw, FiTruck } from "react-icons/fi";
import {
  ClientDashboardLoading,
  ClientDashboardShell,
  ClientShellUser
} from "@/components/client/ClientDashboardShell";
import { apiUrl } from "@/lib/api";
import { getAccessToken, logout, refreshAccessToken } from "@/lib/auth";
import {
  ClientDashboardAccount,
  ClientPrepaidAccount,
  ClientRecentShipment,
  ClientShipmentSummary,
  getClientDashboard,
  getClientPrepaidAccount
} from "@/lib/clientDashboard";
import { formatDashboardDate, formatDashboardDateTime } from "@/lib/dateFormat";
import { downloadShipmentInvoicePdf, shipmentInvoicePageUrl } from "@/lib/shipmentInvoices";

function formatDate(value?: string | null) {
  return formatDashboardDate(value);
}

function formatDateTime(value?: string | null) {
  return formatDashboardDateTime(value);
}

function formatMoney(currency?: string, amount?: number | null) {
  if (!currency || amount === null || amount === undefined) return "Not assigned";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

function formatMinorMoney(amountMinor: number, currency = "INR") {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2
  }).format(amountMinor / 100);
}

function formatRegistrationLabel(value?: string) {
  if (!value) return "Registration ID";
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getDisplayName(user: ClientShellUser) {
  return user.name || user.email.split("@")[0] || "Customer";
}

function getBranchLabel(branch?: { name?: string; code?: string } | null) {
  if (!branch) return "Account-level access";
  return `${branch.name || "Branch"}${branch.code ? ` (${branch.code})` : ""}`;
}

function canCreateShipment(account: ClientDashboardAccount) {
  return ["account_owner", "account_admin", "operations"].includes(account.membership.role)
    && account.assignedBranches.length > 0;
}

function canMakePayment(account: ClientDashboardAccount) {
  return ["account_owner", "account_admin", "finance"].includes(account.membership.role);
}

type DashboardAction = {
  label: string;
  href: string;
  icon: ReactNode;
  description: string;
};

function emptyShipmentSummary(branchId = ""): ClientShipmentSummary {
  return {
    branchId,
    totalShipments: 0,
    readyForLabel: 0,
    labelsCreated: 0,
    validationFailed: 0,
    needsReview: 0,
    addressValidated: 0,
    lastActivityAt: null
  };
}

function getShipmentDashboard(account: ClientDashboardAccount | null) {
  return account?.shipments ?? {
    summary: emptyShipmentSummary(),
    branchSummaries: [],
    recentShipments: []
  };
}

async function loadCurrentUser() {
  let token = getAccessToken() ?? await refreshAccessToken();
  if (!token) return null;

  let response = await fetch(apiUrl("/api/v1/auth/me"), {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (response.status === 401) {
    token = await refreshAccessToken();
    if (!token) return null;

    response = await fetch(apiUrl("/api/v1/auth/me"), {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  const data = await response.json();
  return data.success ? data.user as ClientShellUser : null;
}

export default function ClientDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<ClientShellUser | null>(null);
  const [accounts, setAccounts] = useState<ClientDashboardAccount[]>([]);
  const [walletsByAccountId, setWalletsByAccountId] = useState<Record<string, ClientPrepaidAccount>>({});
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const selectedAccountIdRef = useRef("");
  const selectedBranchIdRef = useRef("");

  const selectedAccount = useMemo(
    () => accounts.find((item) => item.account.id === selectedAccountId) ?? accounts[0] ?? null,
    [accounts, selectedAccountId]
  );

  const selectedBranch = useMemo(() => {
    if (!selectedAccount || !selectedBranchId) return null;
    return selectedAccount.assignedBranches.find((branch) => branch._id === selectedBranchId) ?? null;
  }, [selectedAccount, selectedBranchId]);
  const selectedShipmentSummary = useMemo(() => {
    if (!selectedAccount) return null;
    const shipments = getShipmentDashboard(selectedAccount);
    if (!selectedBranchId) return shipments.summary;
    return shipments.branchSummaries.find((summary) => summary.branchId === selectedBranchId)
      ?? shipments.summary;
  }, [selectedAccount, selectedBranchId]);
  const recentShipments = useMemo(() => {
    if (!selectedAccount) return [];
    const shipments = getShipmentDashboard(selectedAccount);
    return selectedBranchId
      ? shipments.recentShipments.filter((shipment) => shipment.branchId === selectedBranchId)
      : shipments.recentShipments;
  }, [selectedAccount, selectedBranchId]);

  const loadDashboardData = useCallback(async (options: { quiet?: boolean } = {}) => {
    if (options.quiet) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const currentUser = await loadCurrentUser();
      if (!currentUser) {
        await logout();
        router.replace("/");
        return;
      }

      if (currentUser.role !== "client") {
        router.replace("/dashboard");
        return;
      }

      const dashboard = await getClientDashboard();
      const walletEntries = await Promise.all(
        dashboard.accounts.map(async (item) => {
          try {
            const wallet = await getClientPrepaidAccount(item.account.id);
            return [item.account.id, wallet.prepaidAccount] as const;
          } catch {
            return null;
          }
        })
      );
      const nextSelectedAccount = dashboard.accounts.find((item) => item.account.id === selectedAccountIdRef.current)
        ?? dashboard.accounts.find((item) => item.dashboardAccess.state === "READY")
        ?? dashboard.accounts[0]
        ?? null;
      const nextSelectedBranch = nextSelectedAccount?.assignedBranches.find((branch) => branch._id === selectedBranchIdRef.current)
        ?? nextSelectedAccount?.assignedBranches[0]
        ?? null;

      setUser(currentUser);
      setAccounts(dashboard.accounts);
      setWalletsByAccountId(Object.fromEntries(walletEntries.filter((entry): entry is readonly [string, ClientPrepaidAccount] => Boolean(entry))));
      selectedAccountIdRef.current = nextSelectedAccount?.account.id ?? "";
      selectedBranchIdRef.current = nextSelectedBranch?._id ?? "";
      setSelectedAccountId(nextSelectedAccount?.account.id ?? "");
      setSelectedBranchId(nextSelectedBranch?._id ?? "");
      setLastUpdatedAt(dashboard.serverTime ?? new Date().toISOString());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to load client dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    let mounted = true;

    async function loadInitialDashboard() {
      await Promise.resolve();
      if (!mounted) return;
      await loadDashboardData();
    }

    void loadInitialDashboard();

    return () => {
      mounted = false;
    };
  }, [loadDashboardData]);

  function handleAccountChange(accountId: string) {
    const nextAccount = accounts.find((item) => item.account.id === accountId) ?? null;
    const nextBranchId = nextAccount?.assignedBranches[0]?._id ?? "";
    selectedAccountIdRef.current = accountId;
    selectedBranchIdRef.current = nextBranchId;
    setSelectedAccountId(accountId);
    setSelectedBranchId(nextBranchId);
  }

  function handleBranchChange(branchId: string) {
    selectedBranchIdRef.current = branchId;
    setSelectedBranchId(branchId);
  }

  if (loading || !user) return <ClientDashboardLoading />;

  return (
    <ClientDashboardShell user={user}>
      <div className="mx-auto max-w-6xl space-y-6">
        <DashboardHeader
          user={user}
          accounts={accounts}
          selectedAccount={selectedAccount}
          selectedBranchId={selectedBranchId}
          selectedBranch={selectedBranch}
          lastUpdatedAt={lastUpdatedAt}
          refreshing={refreshing}
          onAccountChange={handleAccountChange}
          onBranchChange={handleBranchChange}
          onRefresh={() => void loadDashboardData({ quiet: true })}
        />

        {error ? <StatusBanner tone="error" message={error} /> : null}

        {!accounts.length ? (
          <EmptyState
            title="No business account linked"
            message="This login does not have an active customer business account membership yet."
          />
        ) : !selectedAccount ? (
          <EmptyState
            title="No dashboard context"
            message="Select a business account to continue."
          />
        ) : selectedAccount.dashboardAccess.state !== "READY" ? (
          <AccessBlocked account={selectedAccount} />
        ) : (
          <>
            <QuickActions account={selectedAccount} />
            <ShipmentSummary
              summary={selectedShipmentSummary}
              recentShipments={recentShipments}
            />
            <FoundationStatus
              account={selectedAccount}
              selectedBranch={selectedBranch}
              refreshing={refreshing}
            />
            <AccountCard
              item={selectedAccount}
              wallet={walletsByAccountId[selectedAccount.account.id]}
            />
          </>
        )}
      </div>
    </ClientDashboardShell>
  );
}

function ShipmentSummary({
  summary,
  recentShipments
}: {
  summary: ClientShipmentSummary | null;
  recentShipments: ClientRecentShipment[];
}) {
  const safeSummary = summary ?? {
    branchId: "",
    totalShipments: 0,
    readyForLabel: 0,
    labelsCreated: 0,
    validationFailed: 0,
    needsReview: 0,
    addressValidated: 0,
    lastActivityAt: null
  };

  return (
    <section className="border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Shipment Summary</h2>
            <p className="mt-1 text-sm text-slate-500">Current shipment activity for the selected dashboard context.</p>
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Last activity: {formatDateTime(safeSummary.lastActivityAt)}
          </p>
        </div>
      </div>

      <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-5">
        <ShipmentMetric
          icon={<FiTruck aria-hidden="true" className="h-4 w-4" />}
          label="Total"
          value={safeSummary.totalShipments}
          detail="Shipment drafts"
        />
        <ShipmentMetric
          icon={<FiCheckCircle aria-hidden="true" className="h-4 w-4" />}
          label="Ready"
          value={safeSummary.readyForLabel}
          detail="Ready for label"
        />
        <ShipmentMetric
          icon={<FiFileText aria-hidden="true" className="h-4 w-4" />}
          label="Labels"
          value={safeSummary.labelsCreated}
          detail="Created labels"
        />
        <ShipmentMetric
          icon={<FiClock aria-hidden="true" className="h-4 w-4" />}
          label="Review"
          value={safeSummary.needsReview}
          detail="Needs attention"
        />
        <ShipmentMetric
          icon={<FiAlertTriangle aria-hidden="true" className="h-4 w-4" />}
          label="Failed"
          value={safeSummary.validationFailed}
          detail="Validation issues"
        />
      </div>

      <div className="border-t border-slate-200 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">Recent Shipments</h3>
            <p className="mt-1 text-xs font-medium text-slate-500">Latest shipment drafts from the current account and branch.</p>
          </div>
          <Link href="/client/dpd-labels" className="text-sm font-semibold text-blue-900 hover:text-blue-700">
            Create Shipment
          </Link>
        </div>

        {recentShipments.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-3">Reference</th>
                  <th className="px-3 py-3">Destination</th>
                  <th className="px-3 py-3">Chargeable Amount</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Updated</th>
                  <th className="px-3 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentShipments.map((shipment) => (
                  <RecentShipmentRow key={shipment.id} shipment={shipment} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-4 border border-dashed border-slate-300 bg-slate-50 p-5">
            <p className="text-sm font-semibold text-slate-800">No shipments yet</p>
            <p className="mt-1 text-sm text-slate-500">Create a shipment to start building dashboard activity.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function ShipmentMetric({
  icon,
  label,
  value,
  detail
}: {
  icon: ReactNode;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <div className="border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-3 text-2xl font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-xs font-medium text-slate-500">{detail}</p>
    </div>
  );
}

function RecentShipmentRow({ shipment }: { shipment: ClientRecentShipment }) {
  const [invoiceError, setInvoiceError] = useState("");
  const [downloadingInvoice, setDownloadingInvoice] = useState(false);
  const destinationName = shipment.destination.companyName
    || shipment.destination.contactName
    || "Consignee";
  const destinationPlace = [
    shipment.destination.townOrCity,
    shipment.destination.countryName || shipment.destination.countryCode
  ].filter(Boolean).join(", ");
  const hasCreatedLabel = ["DPD_CREATED", "LABEL_RECEIVED"].includes(shipment.dpdStatus);
  const viewHref = hasCreatedLabel ? `/client/shipments/${shipment.id}` : `/client/dpd-labels/${shipment.id}`;
  const statusLabel = shipment.currentStatusLabel
    || (shipment.dpdStatus ? formatRegistrationLabel(shipment.dpdStatus.toLowerCase()) : shipment.statusLabel);
  const isOnHold = shipment.currentStatus === "ON_HOLD";

  async function downloadInvoice() {
    setDownloadingInvoice(true);
    setInvoiceError("");
    try {
      await downloadShipmentInvoicePdf(shipment.id, "client", shipment.shipmentInvoice?.invoiceNumber);
    } catch (caughtError) {
      setInvoiceError(caughtError instanceof Error ? caughtError.message : "Unable to download shipment invoice.");
    } finally {
      setDownloadingInvoice(false);
    }
  }

  return (
    <tr className="text-slate-700">
      <td className="px-3 py-3">
        <p className="font-semibold text-slate-950">{shipment.shipmentReference || shipment.invoiceNumber || shipment.id}</p>
        <p className="mt-1 text-xs text-slate-500">{shipment.invoiceNumber || "No invoice number"}</p>
      </td>
      <td className="px-3 py-3">
        <p className="font-medium text-slate-900">{destinationName}</p>
        <p className="mt-1 text-xs text-slate-500">{destinationPlace || shipment.destination.postcode || "Not available"}</p>
      </td>
      <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-950">
        {shipment.shipmentInvoice
          ? formatMinorMoney(shipment.shipmentInvoice.chargeableAmountMinor, shipment.shipmentInvoice.currency)
          : "-"}
      </td>
      <td className="px-3 py-3">
        <span className="inline-flex border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold capitalize text-slate-700">
          {statusLabel}
        </span>
        {isOnHold && shipment.holdReason ? (
          <p className="mt-1 text-xs font-medium text-amber-700">{formatRegistrationLabel(shipment.holdReason)}</p>
        ) : null}
      </td>
      <td className="px-3 py-3 text-xs font-medium text-slate-500">{formatDateTime(shipment.updatedAt ?? shipment.createdAt)}</td>
      <td className="px-3 py-3 text-right">
        <div className="flex min-w-48 flex-wrap items-center justify-end gap-2">
          <Link href={viewHref} className="text-sm font-semibold text-blue-900 hover:text-blue-700">View</Link>
          {hasCreatedLabel ? (
            <>
              <Link href={shipmentInvoicePageUrl(shipment.id, "client")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-900 hover:text-blue-700">
                <FiFileText aria-hidden="true" className="h-4 w-4" />Invoice
              </Link>
              <button type="button" title="Download invoice PDF" aria-label="Download invoice PDF" disabled={downloadingInvoice} onClick={() => void downloadInvoice()} className="inline-flex h-8 w-8 items-center justify-center border border-slate-200 text-slate-700 hover:border-blue-900 hover:text-blue-900 disabled:opacity-50">
                <FiDownload aria-hidden="true" className="h-4 w-4" />
              </button>
              <Link href={shipmentInvoicePageUrl(shipment.id, "client", true)} target="_blank" rel="noreferrer" title="Print invoice" aria-label="Print invoice" className="inline-flex h-8 w-8 items-center justify-center border border-slate-200 text-slate-700 hover:border-blue-900 hover:text-blue-900">
                <FiPrinter aria-hidden="true" className="h-4 w-4" />
              </Link>
            </>
          ) : null}
        </div>
        {invoiceError ? <p className="mt-2 max-w-64 text-right text-xs font-medium text-red-700">{invoiceError}</p> : null}
      </td>
    </tr>
  );
}

function QuickActions({ account }: { account: ClientDashboardAccount }) {
  const availableActions: DashboardAction[] = [];

  if (canCreateShipment(account)) {
    availableActions.push({
      label: "Create Shipment",
      href: "/client/dpd-labels",
      icon: <FiTruck aria-hidden="true" className="h-5 w-5" />,
      description: "Upload an invoice and prepare a shipment draft."
    });
  }

  if (canMakePayment(account)) {
    availableActions.push({
      label: "Make Payment",
      href: "/client/payments",
      icon: <FiCreditCard aria-hidden="true" className="h-5 w-5" />,
      description: "Add Customer Advance for shipment bookings."
    });
  }

  if (!availableActions.length) {
    return (
      <section className="border border-slate-200 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-950">Quick Actions</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">No quick actions are available for this role yet.</p>
      </section>
    );
  }

  return (
    <section className="border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Quick Actions</h2>
          <p className="mt-1 text-sm text-slate-500">Common actions for the selected account and branch context.</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {availableActions.map((action) => (
          <Link
            key={action.label}
            href={action.href}
            className="flex min-h-24 items-center gap-4 border border-slate-200 bg-slate-50 p-4 text-slate-800 hover:border-blue-900 hover:bg-white hover:text-blue-900"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-slate-200 bg-white">{action.icon}</span>
            <span>
              <span className="block text-sm font-semibold">{action.label}</span>
              <span className="mt-1 block text-xs font-medium text-slate-500">{action.description}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function DashboardHeader({
  user,
  accounts,
  selectedAccount,
  selectedBranchId,
  selectedBranch,
  lastUpdatedAt,
  refreshing,
  onAccountChange,
  onBranchChange,
  onRefresh
}: {
  user: ClientShellUser;
  accounts: ClientDashboardAccount[];
  selectedAccount: ClientDashboardAccount | null;
  selectedBranchId: string;
  selectedBranch: ClientDashboardAccount["assignedBranches"][number] | null;
  lastUpdatedAt: string;
  refreshing: boolean;
  onAccountChange: (accountId: string) => void;
  onBranchChange: (branchId: string) => void;
  onRefresh: () => void;
}) {
  const hasMultipleAccounts = accounts.length > 1;
  const branches = selectedAccount?.assignedBranches ?? [];
  const hasMultipleBranches = branches.length > 1;

  return (
    <section className="border border-slate-200 bg-white">
      <div className="grid gap-4 border-b border-slate-200 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div>
          <p className="text-sm font-semibold text-slate-500">Welcome back, {getDisplayName(user)}</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-950">
            {selectedAccount?.account.company.companyName || "Customer Dashboard"}
          </h1>
          <div className="mt-3 flex flex-wrap gap-3 text-sm text-slate-600">
            <span>Swiftline Customer Code: <strong className="font-semibold text-slate-950">{selectedAccount?.account.accountId || "Not available"}</strong></span>
            <span>Branch: <strong className="font-semibold text-slate-950">{getBranchLabel(selectedBranch)}</strong></span>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:items-end">
          <p className="text-sm font-medium text-slate-600">{formatDate(new Date().toISOString())}</p>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last updated: {formatDateTime(lastUpdatedAt)}</p>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex h-10 items-center justify-center gap-2 border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:border-blue-900 hover:text-blue-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FiRefreshCw aria-hidden="true" className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 p-5 md:grid-cols-2">
        {hasMultipleAccounts ? (
          <Field label="Business Account">
            <select
              value={selectedAccount?.account.id ?? ""}
              onChange={(event) => onAccountChange(event.target.value)}
              className="h-11 w-full border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 focus:border-blue-900 focus:outline-none"
            >
              {accounts.map((item) => (
                <option key={item.account.id} value={item.account.id}>
                  {item.account.company.companyName || item.account.accountId}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <ContextTile label="Business Account" value={selectedAccount?.account.company.companyName || selectedAccount?.account.accountId || "Not available"} />
        )}

        {hasMultipleBranches ? (
          <Field label="Branch">
            <select
              value={selectedBranchId}
              onChange={(event) => onBranchChange(event.target.value)}
              className="h-11 w-full border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 focus:border-blue-900 focus:outline-none"
            >
              {branches.map((branch) => (
                <option key={branch._id} value={branch._id}>
                  {getBranchLabel(branch)}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <ContextTile label="Branch Context" value={getBranchLabel(branches[0] ?? null)} />
        )}
      </div>
    </section>
  );
}

function FoundationStatus({
  account,
  selectedBranch,
  refreshing
}: {
  account: ClientDashboardAccount;
  selectedBranch: ClientDashboardAccount["assignedBranches"][number] | null;
  refreshing: boolean;
}) {
  return (
    <section className="grid gap-4 md:grid-cols-3">
      <StatusTile
        icon={<FiCheckCircle aria-hidden="true" className="h-4 w-4" />}
        label="Dashboard Access"
        value="Ready"
        detail="Account, role, membership, and KYC checks passed."
      />
      <StatusTile
        icon={<FiBriefcase aria-hidden="true" className="h-4 w-4" />}
        label="Data Scope"
        value={selectedBranch ? "Branch scoped" : "Account level"}
        detail={selectedBranch ? getBranchLabel(selectedBranch) : "No branch is assigned to this login."}
      />
      <StatusTile
        icon={<FiRefreshCw aria-hidden="true" className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />}
        label="Refresh State"
        value={refreshing ? "Refreshing" : "Idle"}
        detail={`Customer role: ${account.membership.role.replace(/_/g, " ")}`}
      />
    </section>
  );
}

function AccountCard({ item, wallet }: { item: ClientDashboardAccount; wallet?: ClientPrepaidAccount }) {
  const { account } = item;
  const company = account.company;
  const contact = account.contact;

  return (
    <section className="border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{account.accountId}</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">{company.companyName || "Business Account"}</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="bg-emerald-50 px-3 py-1 text-xs font-semibold capitalize text-emerald-700">{account.statusLabel}</span>
            <span className="bg-blue-50 px-3 py-1 text-xs font-semibold capitalize text-blue-900">KYC: {account.kycStatusLabel}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-3 capitalize">
        <InfoSection title="Company Details">
          <InfoRow label="Company Type" value={company.companyType} />
          <InfoRow label="Industry" value={company.industry} />
          <InfoRow label="Country" value={company.registrationCountry} />
          <InfoRow label={formatRegistrationLabel(company.registrationIdType)} value={company.registrationId} />
          <InfoRow label="Requested Credit Limit" value={formatMoney(company.requestedCreditLimit?.currency, company.requestedCreditLimit?.amount)} />
        </InfoSection>

        <InfoSection title="Address">
          <InfoRow label="Address" value={company.registeredAddress} />
          <InfoRow label="City" value={company.city} />
          <InfoRow label="State" value={company.stateOrProvince} />
          <InfoRow label="Postal Code" value={company.postalCode} />
          <InfoRow label="Address Country" value={company.addressCountry} />
        </InfoSection>

        <InfoSection title="Contact & Access">
          <InfoRow label="Contact" value={`${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim()} />
          <InfoRow label="Email" value={contact.email} />
          <InfoRow label="Mobile" value={`${contact.countryCode ?? ""} ${contact.mobileNumber ?? ""}`.trim()} />
          <InfoRow label="Job Title" value={contact.jobTitle} />
          <InfoRow label="Joined" value={formatDate(item.membership.joinedAt)} />
        </InfoSection>
      </div>

      <div className="border-t border-slate-200 px-5 py-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">Assigned Branches</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {item.assignedBranches.length ? item.assignedBranches.map((branch) => (
                <span key={branch._id} className="border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
                  {getBranchLabel(branch)}
                </span>
              )) : (
                <span className="text-sm text-slate-500">No branch assigned. Account-level dashboard only.</span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Available Balance</p>
              <p className="mt-1 text-base font-semibold text-slate-950">
                {wallet ? formatMinorMoney(wallet.availableBalanceMinor, wallet.currency) : "Not available"}
              </p>
            </div>
            <Link
              href="/client/payments"
              className="inline-flex h-10 items-center justify-center gap-2 border border-blue-900 bg-white px-3 text-sm font-semibold text-blue-900 hover:bg-blue-50"
            >
              <FiCreditCard aria-hidden="true" className="h-4 w-4" />
              Payments
            </Link>
            {item.assignedBranches.length ? (
              <Link
                href="/client/dpd-labels"
                className="inline-flex h-10 items-center justify-center gap-2 bg-blue-900 px-3 text-sm font-semibold text-white hover:bg-blue-800"
              >
                <FiTruck aria-hidden="true" className="h-4 w-4" />
                Create Shipment
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function AccessBlocked({ account }: { account: ClientDashboardAccount }) {
  return (
    <section className="border border-amber-200 bg-amber-50 p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center bg-amber-100 text-amber-700">
          <FiAlertTriangle aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-amber-900">Dashboard access is not ready</h2>
          <p className="mt-1 text-sm font-medium text-amber-800">
            {account.account.company.companyName || account.account.accountId} cannot load the normal dashboard yet.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-amber-800">
            {account.dashboardAccess.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function ContextTile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 flex h-11 items-center border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function StatusTile({
  icon,
  label,
  value,
  detail
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-3 text-lg font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{detail}</p>
    </div>
  );
}

function StatusBanner({ tone, message }: { tone: "error" | "info"; message: string }) {
  const classes = tone === "error"
    ? "border-red-200 bg-red-50 text-red-700"
    : "border-blue-200 bg-blue-50 text-blue-900";

  return <div className={`border px-4 py-3 text-sm font-semibold ${classes}`}>{message}</div>;
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <section className="border border-slate-200 bg-white p-6">
      <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      <p className="mt-1 text-sm font-medium text-slate-500">{message}</p>
    </section>
  );
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-slate-200 p-5 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <dl className="mt-4 space-y-3">{children}</dl>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-800">{value || "Not available"}</dd>
    </div>
  );
}
