"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FiAlertTriangle,
  FiBriefcase,
  FiCalendar,
  FiCheckCircle,
  FiClipboard,
  FiClock,
  FiCreditCard,
  FiDollarSign,
  FiDownload,
  FiFileText,
  FiHelpCircle,
  FiInbox,
  FiPackage,
  FiPlus,
  FiPrinter,
  FiRefreshCw,
  FiTruck
} from "react-icons/fi";
import {
  ClientDashboardLoading,
  ClientDashboardShell,
  ClientShellUser
} from "@/components/client/ClientDashboardShell";
import { StagePipelineChart } from "@/components/dashboard/DashboardCharts";
import {
  EmptyState,
  KpiCard,
  SectionCard,
  SeverityChip,
  panelLift,
  panelSurface,
  severityStyles
} from "@/components/dashboard/DashboardWidgets";
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
import {
  buildClientTasks,
  buildCompletionMeters,
  buildShipmentPipeline,
  loadClientExtras,
  type ClientExtras,
  type ClientMeter
} from "@/lib/clientDashboardOverview";
import { formatCompactMoney, formatCount, formatMinorMoney, titleCase } from "@/lib/dashboardOverview";
import { formatDashboardDate, formatDashboardDateTime } from "@/lib/dateFormat";
import { listNotifications, markNotificationRead, type PortalNotification } from "@/lib/notifications";
import { downloadShipmentInvoicePdf, shipmentInvoicePageUrl } from "@/lib/shipmentInvoices";

function formatDate(value?: string | null) {
  return formatDashboardDate(value);
}

function formatDateTime(value?: string | null) {
  return formatDashboardDateTime(value);
}

function getDisplayName(user: ClientShellUser) {
  const name = user.name?.trim();
  if (name) return name.split(/\s+/)[0];
  return user.email.split("@")[0] || "Customer";
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getBranchLabel(branch?: { name?: string; code?: string } | null) {
  if (!branch) return "Account-level access";
  return `${branch.name || "Branch"}${branch.code ? ` (${branch.code})` : ""}`;
}

function relativeTime(value: string) {
  const minutes = Math.max(Math.floor((Date.now() - new Date(value).getTime()) / 60_000), 0);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

function notificationTone(type: string): keyof typeof severityStyles {
  const upper = type.toUpperCase();
  if (/HOLD|CANCEL|FAIL|REJECT|OVERDUE|BLOCK/.test(upper)) return "critical";
  if (/PENDING|REVIEW|SUBMIT|DUE|REQUEST|AWAIT/.test(upper)) return "warning";
  return "info";
}

// Membership-role checks mirror ClientDashboardShell's own permission logic, so
// the header actions and sidebar never disagree about what a role can do.
function canCreateShipment(account: ClientDashboardAccount) {
  return ["account_owner", "account_admin", "operations"].includes(account.membership.role)
    && account.assignedBranches.length > 0;
}

function canRequestQuote(account: ClientDashboardAccount) {
  return ["account_owner", "account_admin", "operations"].includes(account.membership.role);
}

function hasQuoteAccess(account: ClientDashboardAccount) {
  return ["account_owner", "account_admin", "operations", "finance"].includes(account.membership.role);
}

function canMakePayment(account: ClientDashboardAccount) {
  return ["account_owner", "account_admin", "finance"].includes(account.membership.role);
}

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
  return account?.shipments ?? { summary: emptyShipmentSummary(), branchSummaries: [], recentShipments: [] };
}

const emptyExtras: ClientExtras = {
  quotesToConvert: 0,
  ticketsAwaitingReply: 0,
  credit: null,
  creditPermissions: [],
  statements: null,
  transactions: [],
  unavailable: []
};

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
  const [extras, setExtras] = useState<ClientExtras>(emptyExtras);
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
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
    return shipments.branchSummaries.find((summary) => summary.branchId === selectedBranchId) ?? shipments.summary;
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

      const [dashboard, notificationsResult] = await Promise.all([
        getClientDashboard(),
        listNotifications().catch(() => null)
      ]);

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

      const nextExtras = nextSelectedAccount && nextSelectedAccount.dashboardAccess.state === "READY"
        ? await loadClientExtras({
          businessAccountId: nextSelectedAccount.account.id,
          canViewQuotes: hasQuoteAccess(nextSelectedAccount)
        })
        : emptyExtras;

      setUser(currentUser);
      setAccounts(dashboard.accounts);
      setWalletsByAccountId(Object.fromEntries(walletEntries.filter((entry): entry is readonly [string, ClientPrepaidAccount] => Boolean(entry))));
      setExtras(nextExtras);
      if (notificationsResult) setNotifications(notificationsResult.notifications);
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
    let cancelled = false;

    async function run() {
      await loadDashboardData();
    }

    if (!cancelled) void run();
    return () => { cancelled = true; };
  }, [loadDashboardData]);

  // Switching accounts changes which credit facility, statements, and quotes
  // apply, so extras are refetched for the newly selected account rather than
  // reused from whichever account loaded first.
  async function handleAccountChange(accountId: string) {
    const nextAccount = accounts.find((item) => item.account.id === accountId) ?? null;
    const nextBranchId = nextAccount?.assignedBranches[0]?._id ?? "";
    selectedAccountIdRef.current = accountId;
    selectedBranchIdRef.current = nextBranchId;
    setSelectedAccountId(accountId);
    setSelectedBranchId(nextBranchId);

    if (nextAccount && nextAccount.dashboardAccess.state === "READY") {
      setExtras(await loadClientExtras({
        businessAccountId: accountId,
        canViewQuotes: hasQuoteAccess(nextAccount)
      }));
    } else {
      setExtras(emptyExtras);
    }
  }

  function handleBranchChange(branchId: string) {
    selectedBranchIdRef.current = branchId;
    setSelectedBranchId(branchId);
  }

  async function openNotification(notification: PortalNotification) {
    if (!notification.readAt) {
      await markNotificationRead(notification.id).catch(() => undefined);
      setNotifications((items) => items.map((item) => item.id === notification.id
        ? { ...item, readAt: new Date().toISOString() }
        : item));
    }
    router.push(notification.href);
  }

  if (loading || !user) return <ClientDashboardLoading />;

  return (
    <ClientDashboardShell user={user}>
      <div className="mx-auto flex max-w-[1500px] flex-col gap-6">
        <DashboardHeader
          user={user}
          accounts={accounts}
          selectedAccount={selectedAccount}
          selectedBranchId={selectedBranchId}
          selectedBranch={selectedBranch}
          lastUpdatedAt={lastUpdatedAt}
          refreshing={refreshing}
          onAccountChange={(id) => void handleAccountChange(id)}
          onBranchChange={handleBranchChange}
          onRefresh={() => void loadDashboardData({ quiet: true })}
        />

        {error ? (
          <p className="flex items-start gap-2 rounded-xl border border-[#D71313]/25 bg-[#D71313]/[0.06] px-4 py-3 text-sm font-medium text-[#D71313]">
            <FiAlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}

        {extras.unavailable.length ? (
          <p className="flex items-start gap-2 rounded-xl border border-[#fab219]/40 bg-[#fab219]/[0.08] px-4 py-3 text-xs font-medium text-[#7a4f00]">
            <FiAlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            These sections could not be loaded and read as empty: {extras.unavailable.join(", ")}.
          </p>
        ) : null}

        {!accounts.length ? (
          <EmptyState
            icon={FiBriefcase}
            title="No business account linked"
            message="This login does not have an active customer business account membership yet."
            surface="light"
          />
        ) : !selectedAccount ? (
          <EmptyState icon={FiBriefcase} title="No dashboard context" message="Select a business account to continue." surface="light" />
        ) : selectedAccount.dashboardAccess.state !== "READY" ? (
          <AccessBlocked account={selectedAccount} />
        ) : (
          <ClientDashboardBody
            account={selectedAccount}
            summary={selectedShipmentSummary ?? emptyShipmentSummary()}
            recentShipments={recentShipments}
            wallet={walletsByAccountId[selectedAccount.account.id]}
            extras={extras}
            notifications={notifications}
            refreshing={refreshing}
            onOpenNotification={(notification) => void openNotification(notification)}
          />
        )}
      </div>
    </ClientDashboardShell>
  );
}

function ClientDashboardBody({
  account,
  summary,
  recentShipments,
  wallet,
  extras,
  notifications,
  refreshing,
  onOpenNotification
}: {
  account: ClientDashboardAccount;
  summary: ClientShipmentSummary;
  recentShipments: ClientRecentShipment[];
  wallet?: ClientPrepaidAccount;
  extras: ClientExtras;
  notifications: PortalNotification[];
  refreshing: boolean;
  onOpenNotification: (notification: PortalNotification) => void;
}) {
  const dim = refreshing ? "opacity-60" : "opacity-100";
  const pipeline = buildShipmentPipeline(summary);
  const meters = buildCompletionMeters(summary);
  const tasks = buildClientTasks({ summary, extras });
  const financialAccess = canMakePayment(account);
  const canViewCredit = extras.creditPermissions.includes("viewCreditBalance");
  const hasCreditFacility = Boolean(extras.credit && extras.credit.status !== "NOT_REQUESTED");

  const quickAccess = [
    { label: "Create Shipment", description: "Upload an invoice and prepare a shipment draft", href: "/client/dpd-labels", icon: FiPackage, show: canCreateShipment(account) },
    { label: "Get Live Quote", description: "Estimate a rate before you commit", href: "/client/get-quote", icon: FiClipboard, show: canRequestQuote(account) },
    { label: "My Quotes", description: "Review priced quotes and convert them", href: "/client/quotes", icon: FiFileText, show: hasQuoteAccess(account) },
    { label: "Tracking", description: "Follow any shipment to its destination", href: "/client/tracking", icon: FiTruck, show: true },
    { label: "Support Tickets", description: "Message our team about a shipment", href: "/client/tickets", icon: FiHelpCircle, show: true },
    { label: "Credit Account", description: "View your facility and request a limit", href: "/client/credit", icon: FiDollarSign, show: true },
    { label: "Credit Statements", description: "Billing cycles and payment history", href: "/client/credit/statements", icon: FiFileText, show: financialAccess },
    { label: "Payments", description: "Add Customer Advance for bookings", href: "/client/payments", icon: FiCreditCard, show: financialAccess }
  ].filter((item) => item.show);

  return (
    <>
      {/* KPI overview */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={FiPackage}
          label="Total shipments"
          value={formatCount(summary.totalShipments)}
          description="Drafts created for the selected context"
          href="/client/dpd-labels"
        />
        <KpiCard
          icon={FiCheckCircle}
          label="Ready for label"
          value={formatCount(summary.readyForLabel)}
          description="Validated and awaiting label creation"
          href="/client/dpd-labels"
        />
        <KpiCard
          icon={FiAlertTriangle}
          label="Needs attention"
          value={formatCount(summary.needsReview + summary.validationFailed)}
          description={`${summary.needsReview} need review, ${summary.validationFailed} failed validation`}
          href="/client/dpd-labels"
          emphasis={summary.needsReview + summary.validationFailed > 0}
        />
        {wallet ? (
          <KpiCard
            icon={FiCreditCard}
            label="Available balance"
            value={formatCompactMoney(wallet.availableBalanceMinor, wallet.currency)}
            description="Customer advance available for booking"
            href="/client/payments"
          />
        ) : canViewCredit && extras.credit ? (
          <KpiCard
            icon={FiDollarSign}
            label="Available credit"
            value={formatCompactMoney(extras.credit.availableCreditMinor ?? 0, extras.credit.currency)}
            description={`${extras.credit.paymentTermsDays} day payment terms`}
            href="/client/credit"
          />
        ) : (
          <KpiCard
            icon={FiClipboard}
            label="Quotes ready to book"
            value={formatCount(extras.quotesToConvert)}
            description="Priced quotes waiting to convert"
            href="/client/quotes"
          />
        )}
      </div>

      {/* Pipeline and tasks */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SectionCard
          className="lg:col-span-2"
          icon={FiPackage}
          title="Shipment pipeline"
          subtitle="Where your shipment drafts are sitting right now"
        >
          {summary.totalShipments ? (
            <>
              <StagePipelineChart stages={pipeline} unitLabel="shipments" dimmed={refreshing} />
              <div className="mt-5 grid gap-4 border-t border-white/10 pt-4 sm:grid-cols-2">
                {meters.map((meter) => <Meter key={meter.key} meter={meter} />)}
              </div>
            </>
          ) : (
            <EmptyState
              icon={FiPackage}
              title="No shipments yet"
              message="Create a shipment to start building dashboard activity."
              actionLabel="Create Shipment"
              actionHref="/client/dpd-labels"
            />
          )}
        </SectionCard>

        <SectionCard icon={FiClock} title="Upcoming tasks" subtitle="Approvals and follow-ups on your side">
          {tasks.length ? (
            <ul className={`space-y-1 transition-opacity duration-200 ${dim}`}>
              {tasks.map((task) => (
                <li key={task.id}>
                  <Link
                    href={task.href}
                    className="flex items-start gap-3 rounded-xl px-2 py-2.5 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  >
                    <span className={`mt-1 h-8 w-1 shrink-0 rounded-full ${severityStyles[task.tone].rail}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-white">{task.label}</span>
                        <SeverityChip tone={task.tone}>{task.count}</SeverityChip>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-300">{task.detail}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={FiCheckCircle} title="You're all caught up" message="No approvals, reviews, or payments are waiting on you right now." />
          )}
        </SectionCard>
      </div>

      {/* Recent shipments and notifications */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SectionCard
          className="lg:col-span-2"
          icon={FiTruck}
          title="Recent shipments"
          subtitle="Latest shipment drafts from the current account and branch"
          action={<Link href="/client/dpd-labels" className="text-xs font-semibold text-[#F0DE36] hover:underline">Create Shipment</Link>}
          bodyClassName="p-0"
        >
          <RecentShipmentsTable shipments={recentShipments} />
        </SectionCard>

        <SectionCard icon={FiInbox} title="Notifications" subtitle="Portal alerts raised for your account">
          {notifications.length ? (
            <ul className={`divide-y divide-white/10 transition-opacity duration-200 ${dim}`}>
              {notifications.slice(0, 6).map((notification) => {
                const tone = notificationTone(notification.type);
                return (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => onOpenNotification(notification)}
                      className="flex w-full items-start gap-3 rounded-lg py-3 text-left transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                    >
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severityStyles[tone].rail} ${notification.readAt ? "opacity-30" : ""}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={`truncate text-sm ${notification.readAt ? "font-medium text-slate-300" : "font-semibold text-white"}`}>
                            {notification.title}
                          </span>
                          {notification.readAt ? null : <SeverityChip tone={tone}>New</SeverityChip>}
                        </span>
                        <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-slate-300">{notification.message}</span>
                        <span className="mt-1 block text-[11px] font-medium text-blue-200">{relativeTime(notification.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={FiInbox} title="No notifications" message="Holds, approvals, and payment alerts will land here as they happen." />
          )}
        </SectionCard>
      </div>

      {/* Finance snapshot and wallet ledger */}
      {financialAccess && (wallet || hasCreditFacility || extras.statements) ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <SectionCard
            className="lg:col-span-2"
            icon={FiCreditCard}
            title="Finance snapshot"
            subtitle="Your wallet, credit facility, and billing at a glance"
            action={<Link href="/client/credit" className="text-xs font-semibold text-[#F0DE36] hover:underline">Credit account</Link>}
          >
            <dl className={`space-y-2.5 transition-opacity duration-200 ${dim}`}>
              {wallet ? (
                <FinanceRow label="Available balance" hint="Customer advance available for booking" value={formatMinorMoney(wallet.availableBalanceMinor, wallet.currency)} />
              ) : null}
              {canViewCredit && extras.credit ? (
                <>
                  <FinanceRow label="Available credit" hint={`${extras.credit.paymentTermsDays} day payment terms`} value={formatMinorMoney(extras.credit.availableCreditMinor ?? 0, extras.credit.currency)} />
                  <FinanceRow label="Invoiced outstanding" hint="Billed and awaiting payment" value={formatMinorMoney(extras.credit.invoicedOutstandingMinor ?? 0, extras.credit.currency)} />
                </>
              ) : null}
              {extras.statements ? (
                <FinanceRow label="Statements outstanding" hint={`${extras.statements.unpaid} unpaid of your recent cycles`} value={formatMinorMoney(extras.statements.outstandingMinor, extras.statements.currency)} />
              ) : null}
            </dl>

            {extras.credit?.restriction && extras.credit.restriction.level !== "NONE" ? (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-[#D71313]/40 bg-[#D71313]/20 px-3.5 py-3 text-xs font-medium text-[#ffb4b4]">
                <FiAlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {extras.credit.restriction.message || "Your credit facility is currently restricted."}
              </p>
            ) : null}

            {!hasCreditFacility && extras.credit ? (
              <p className="mt-3 rounded-xl border border-white/15 bg-white/10 px-3.5 py-3 text-xs font-medium text-slate-300">
                No credit facility has been requested for this account yet.
              </p>
            ) : null}
          </SectionCard>

          <SectionCard icon={FiClock} title="Recent transactions" subtitle="Latest wallet activity">
            {extras.transactions.length ? (
              <ul className={`space-y-3 transition-opacity duration-200 ${dim}`}>
                {extras.transactions.map((transaction) => {
                  const isCredit = transaction.direction === "CREDIT";
                  return (
                    <li key={transaction._id} className="flex items-start justify-between gap-3 rounded-xl bg-white/10 px-3.5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-white">{titleCase(transaction.transactionType)}</p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-300">{transaction.description || formatDateTime(transaction.createdAt)}</p>
                      </div>
                      <span className={`shrink-0 text-sm font-semibold tabular-nums ${isCredit ? "text-emerald-300" : "text-white"}`}>
                        {isCredit ? "+" : "-"}{formatMinorMoney(transaction.amountMinor, transaction.currency)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={FiCreditCard} title="No transactions yet" message="Wallet top-ups and bookings will appear here." />
            )}
          </SectionCard>
        </div>
      ) : null}

      {/* Quick access */}
      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight text-slate-900">Quick access</h2>
          <p className="text-xs text-slate-500">Available for your role on this account</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {quickAccess.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-start gap-3 p-4 ${panelSurface} ${panelLift} focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#F0DE36] transition group-hover:bg-white group-hover:text-[#0D1282]">
                <item.icon aria-hidden="true" className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-white">{item.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-300">{item.description}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Business account details */}
      <AccountDetails account={account} />
    </>
  );
}

function Meter({ meter }: { meter: ClientMeter }) {
  const percent = meter.total ? Math.round((meter.count / meter.total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-slate-200">{meter.label}</p>
        <p className="text-xs font-semibold tabular-nums text-slate-300">{meter.count} / {meter.total}</p>
      </div>
      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/12">
        <div
          className="h-2.5 rounded-full bg-[#7498ff] transition-[width] duration-300"
          style={{ width: `${meter.total ? Math.max(percent, meter.count ? 2 : 0) : 0}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-slate-300">{meter.detail} · {percent}%</p>
    </div>
  );
}

function FinanceRow({ label, hint, value }: { label: string; hint: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl bg-white/10 px-3.5 py-3">
      <dt className="min-w-0">
        <span className="block text-xs font-semibold text-slate-200">{label}</span>
        <span className="mt-0.5 block text-[11px] text-slate-300">{hint}</span>
      </dt>
      <dd className="shrink-0 text-sm font-semibold tabular-nums text-white">{value}</dd>
    </div>
  );
}

function RecentShipmentsTable({ shipments }: { shipments: ClientRecentShipment[] }) {
  if (!shipments.length) {
    return (
      <div className="p-5">
        <EmptyState
          icon={FiTruck}
          title="No shipments yet"
          message="Create a shipment to start building dashboard activity."
          actionLabel="Create Shipment"
          actionHref="/client/dpd-labels"
        />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/10 text-xs font-semibold uppercase tracking-wide text-slate-300">
            <th className="px-5 py-3">Reference</th>
            <th className="px-5 py-3">Destination</th>
            <th className="px-5 py-3">Amount</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3">Updated</th>
            <th className="px-5 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {shipments.map((shipment) => <RecentShipmentRow key={shipment.id} shipment={shipment} />)}
        </tbody>
      </table>
    </div>
  );
}

function RecentShipmentRow({ shipment }: { shipment: ClientRecentShipment }) {
  const [invoiceError, setInvoiceError] = useState("");
  const [downloadingInvoice, setDownloadingInvoice] = useState(false);
  const destinationName = shipment.destination.companyName || shipment.destination.contactName || "Consignee";
  const destinationPlace = [shipment.destination.townOrCity, shipment.destination.countryName || shipment.destination.countryCode]
    .filter(Boolean).join(", ");
  const hasCreatedLabel = ["DPD_CREATED", "LABEL_RECEIVED"].includes(shipment.dpdStatus);
  const viewHref = hasCreatedLabel ? `/client/shipments/${shipment.id}` : `/client/dpd-labels/${shipment.id}`;
  const statusLabel = shipment.currentStatusLabel || (shipment.dpdStatus ? titleCase(shipment.dpdStatus) : shipment.statusLabel);
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
    <tr className="text-slate-200">
      <td className="px-5 py-3">
        <p className="font-semibold text-white">{shipment.shipmentReference || shipment.invoiceNumber || shipment.id}</p>
        <p className="mt-0.5 text-xs text-slate-300">{shipment.invoiceNumber || "No invoice number"}</p>
      </td>
      <td className="px-5 py-3">
        <p className="font-medium text-white">{destinationName}</p>
        <p className="mt-0.5 text-xs text-slate-300">{destinationPlace || shipment.destination.postcode || "Not available"}</p>
      </td>
      <td className="whitespace-nowrap px-5 py-3 font-semibold text-white">
        {shipment.shipmentInvoice ? formatMinorMoney(shipment.shipmentInvoice.chargeableAmountMinor, shipment.shipmentInvoice.currency) : "-"}
      </td>
      <td className="px-5 py-3">
        <span className="inline-flex rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold capitalize text-slate-700">
          {statusLabel}
        </span>
        {isOnHold && shipment.holdReason ? <p className="mt-1 text-xs font-medium text-amber-300">{titleCase(shipment.holdReason)}</p> : null}
      </td>
      <td className="px-5 py-3 text-xs font-medium text-slate-300">{formatDateTime(shipment.updatedAt ?? shipment.createdAt)}</td>
      <td className="px-5 py-3 text-right">
        <div className="flex min-w-48 flex-wrap items-center justify-end gap-2">
          <Link href={viewHref} className="text-sm font-semibold text-[#F0DE36] hover:underline">View</Link>
          {hasCreatedLabel ? (
            <>
              <Link href={shipmentInvoicePageUrl(shipment.id, "client")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-[#F0DE36] hover:underline">
                <FiFileText aria-hidden="true" className="h-4 w-4" />Invoice
              </Link>
              <button type="button" title="Download invoice PDF" aria-label="Download invoice PDF" disabled={downloadingInvoice} onClick={() => void downloadInvoice()} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 text-slate-200 hover:border-[#F0DE36] hover:text-[#F0DE36] disabled:opacity-50">
                <FiDownload aria-hidden="true" className="h-4 w-4" />
              </button>
              <Link href={shipmentInvoicePageUrl(shipment.id, "client", true)} target="_blank" rel="noreferrer" title="Print invoice" aria-label="Print invoice" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 text-slate-200 hover:border-[#F0DE36] hover:text-[#F0DE36]">
                <FiPrinter aria-hidden="true" className="h-4 w-4" />
              </Link>
            </>
          ) : null}
        </div>
        {invoiceError ? <p className="mt-2 max-w-64 text-right text-xs font-medium text-red-300">{invoiceError}</p> : null}
      </td>
    </tr>
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
  const canCreate = selectedAccount ? canCreateShipment(selectedAccount) : false;
  const canQuote = selectedAccount ? canRequestQuote(selectedAccount) : false;
  const canPay = selectedAccount ? canMakePayment(selectedAccount) : false;

  return (
    <section className={`p-6 ${panelSurface}`}>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center rounded-full bg-white/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
              Client
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
              <FiCalendar aria-hidden="true" className="h-3.5 w-3.5" />
              {formatDate(new Date().toISOString())}
            </span>
          </div>

          <h1 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-[28px]">
            {greeting()}, {getDisplayName(user)}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-300">
            {selectedAccount?.account.company.companyName || "Customer Dashboard"}
            {" — "}Swiftline Customer Code <strong className="font-semibold text-slate-100">{selectedAccount?.account.accountId || "Not available"}</strong>
            {" · "}Branch <strong className="font-semibold text-slate-100">{getBranchLabel(selectedBranch)}</strong>
          </p>
        </div>

        <div className="flex flex-col items-start gap-3 sm:items-end">
          <div className="flex flex-wrap gap-2">
            {canCreate ? (
              <Link href="/client/dpd-labels" className="inline-flex items-center gap-2 rounded-lg bg-[#F0DE36] px-4 py-2.5 text-sm font-semibold text-[#0D1282] shadow-sm shadow-black/20 transition hover:bg-[#e0cf2e] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2">
                <FiPlus aria-hidden="true" className="h-4 w-4" />Create Shipment
              </Link>
            ) : null}
            {canQuote ? (
              <Link href="/client/get-quote" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D1282]/40 focus-visible:ring-offset-2">
                <FiClipboard aria-hidden="true" className="h-4 w-4" />Get Live Quote
              </Link>
            ) : null}
            {canPay ? (
              <Link href="/client/payments" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D1282]/40 focus-visible:ring-offset-2">
                <FiCreditCard aria-hidden="true" className="h-4 w-4" />Make Payment
              </Link>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-300 transition hover:text-[#F0DE36] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FiRefreshCw aria-hidden="true" className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing" : `Updated ${formatDateTime(lastUpdatedAt)}`}
          </button>
        </div>
      </div>

      {hasMultipleAccounts || hasMultipleBranches ? (
        <div className="mt-5 grid gap-4 border-t border-white/10 pt-5 md:grid-cols-2">
          {hasMultipleAccounts ? (
            <Field label="Business Account">
              <select
                value={selectedAccount?.account.id ?? ""}
                onChange={(event) => onAccountChange(event.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 focus:border-[#0D1282] focus:outline-none"
              >
                {accounts.map((item) => (
                  <option key={item.account.id} value={item.account.id}>{item.account.company.companyName || item.account.accountId}</option>
                ))}
              </select>
            </Field>
          ) : null}

          {hasMultipleBranches ? (
            <Field label="Branch">
              <select
                value={selectedBranchId}
                onChange={(event) => onBranchChange(event.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 focus:border-[#0D1282] focus:outline-none"
              >
                {branches.map((branch) => (
                  <option key={branch._id} value={branch._id}>{getBranchLabel(branch)}</option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

function AccessBlocked({ account }: { account: ClientDashboardAccount }) {
  return (
    <section className="rounded-2xl border border-[#fab219]/40 bg-[#fab219]/[0.08] p-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-[#fab219]/20 text-[#7a4f00]">
          <FiAlertTriangle aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-[#7a4f00]">Dashboard access is not ready</h2>
          <p className="mt-1 text-sm font-medium text-[#7a4f00]">
            {account.account.company.companyName || account.account.accountId} cannot load the normal dashboard yet.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-[#7a4f00]">
            {account.dashboardAccess.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}

function AccountDetails({ account: item }: { account: ClientDashboardAccount }) {
  const { account } = item;
  const company = account.company;
  const contact = account.contact;

  return (
    <SectionCard
      icon={FiBriefcase}
      title={company.companyName || "Business Account"}
      subtitle={account.accountId}
      action={
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-[#0ca30c]/25 px-2.5 py-1 text-xs font-semibold capitalize text-[#86efac]">{account.statusLabel}</span>
          <span className="rounded-full bg-white/12 px-2.5 py-1 text-xs font-semibold capitalize text-white">KYC: {account.kycStatusLabel}</span>
        </div>
      }
      bodyClassName="p-0"
    >
      <div className="grid gap-0 lg:grid-cols-3">
        <InfoSection title="Company Details">
          <InfoRow label="Company Type" value={company.companyType} />
          <InfoRow label="Industry" value={company.industry} />
          <InfoRow label="Country" value={company.registrationCountry} />
          <InfoRow label={company.registrationIdType ? titleCase(company.registrationIdType) : "Registration ID"} value={company.registrationId} />
        </InfoSection>

        <InfoSection title="Address">
          <InfoRow label="Address" value={company.registeredAddress} />
          <InfoRow label="City" value={company.city} />
          <InfoRow label="State" value={company.stateOrProvince} />
          <InfoRow label="Postal Code" value={company.postalCode} />
        </InfoSection>

        <InfoSection title="Contact & Access" last>
          <InfoRow label="Contact" value={`${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim()} />
          <InfoRow label="Email" value={contact.email} />
          <InfoRow label="Mobile" value={`${contact.countryCode ?? ""} ${contact.mobileNumber ?? ""}`.trim()} />
          <InfoRow label="Job Title" value={contact.jobTitle} />
          <InfoRow label="Joined" value={formatDate(item.membership.joinedAt)} />
        </InfoSection>
      </div>

      <div className="border-t border-white/10 px-5 py-4">
        <h3 className="text-sm font-semibold text-white">Assigned Branches</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {item.assignedBranches.length ? item.assignedBranches.map((branch) => (
            <span key={branch._id} className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-slate-200">
              {getBranchLabel(branch)}
            </span>
          )) : <span className="text-sm text-slate-300">No branch assigned. Account-level dashboard only.</span>}
        </div>
      </div>
    </SectionCard>
  );
}

function InfoSection({ title, children, last = false }: { title: string; children: ReactNode; last?: boolean }) {
  return (
    <div className={`p-5 ${last ? "" : "border-b border-white/10 lg:border-b-0 lg:border-r"}`}>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <dl className="mt-4 space-y-3">{children}</dl>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-blue-200">{label}</dt>
      <dd className="mt-1 text-sm font-medium capitalize text-white">{value || "Not available"}</dd>
    </div>
  );
}
