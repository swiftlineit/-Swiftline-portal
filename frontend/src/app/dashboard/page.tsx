"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FiActivity,
  FiAlertTriangle,
  FiArchive,
  FiArrowRight,
  FiArrowUpRight,
  FiBell,
  FiBriefcase,
  FiCalendar,
  FiCheckCircle,
  FiClock,
  FiCreditCard,
  FiFileText,
  FiGrid,
  FiInbox,
  FiLock,
  FiMapPin,
  FiPackage,
  FiPlus,
  FiRefreshCw,
  FiSend,
  FiTruck,
  FiUserPlus
} from "react-icons/fi";
import DashboardShell from "@/components/DashboardShell";
import { DailyTrendChart, StagePipelineChart } from "@/components/dashboard/DashboardCharts";
import {
  BarsSkeleton,
  ColumnsSkeleton,
  EmptyState,
  KpiCard,
  KpiCardSkeleton,
  RowsSkeleton,
  SectionCard,
  SeverityChip,
  Shimmer,
  panelLift,
  panelSurface,
  severityStyles
} from "@/components/dashboard/DashboardWidgets";
import WelcomeModal from "@/components/WelcomeModal";
import { apiUrl } from "@/lib/api";
import { getAccessToken, logout, readJsonSafely, refreshAccessToken } from "@/lib/auth";
import {
  type ActivityItem,
  type DashboardOverview,
  describeRole,
  formatCompactMoney,
  formatCount,
  formatMinorMoney,
  getDashboardCapabilities,
  loadDashboardOverview,
  quickLinksForRole
} from "@/lib/dashboardOverview";
import { listNotifications, markNotificationRead, type PortalNotification } from "@/lib/notifications";
import type { AuthenticatedUser } from "@/lib/useAdminUser";

type IconType = typeof FiGrid;

const quickActions = [
  { label: "Create shipment", href: "/dashboard/dpd-labels", icon: FiPackage, roles: ["admin"], primary: true },
  { label: "New manifest", href: "/dashboard/operations-manifests/new", icon: FiArchive, roles: ["admin", "operations"], primary: false },
  { label: "New business account", href: "/dashboard/business-accounts/create", icon: FiUserPlus, roles: ["admin"], primary: false }
];

const quickLinkIcons: Record<string, IconType> = {
  "/dashboard/dpd-labels": FiPackage,
  "/dashboard/tracking": FiTruck,
  "/dashboard/operations-manifests": FiArchive,
  "/dashboard/business-accounts": FiBriefcase,
  "/dashboard/credit-accounts": FiCreditCard,
  "/dashboard/branches": FiMapPin,
  "/dashboard/tax-invoices": FiFileText,
  "/dashboard/tickets": FiInbox
};

const activityIcons: Record<ActivityItem["kind"], IconType> = {
  shipment: FiPackage,
  delivery: FiCheckCircle,
  manifest: FiArchive,
  account: FiBriefcase,
  ticket: FiInbox,
  exception: FiAlertTriangle
};

const activityTones: Record<ActivityItem["kind"], string> = {
  shipment: "bg-white/15 text-[#F0DE36]",
  delivery: "bg-[#0ca30c]/25 text-[#86efac]",
  manifest: "bg-white/15 text-[#F0DE36]",
  account: "bg-[#F0DE36]/30 text-white",
  ticket: "bg-white/15 text-slate-200",
  exception: "bg-[#D71313]/25 text-[#ffb4b4]"
};

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
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

function firstName(user: AuthenticatedUser) {
  const name = user.name?.trim();
  if (name) return name.split(/\s+/)[0];
  return user.email.split("@")[0];
}

// The notification type carries the urgency, so it drives the priority indicator.
function notificationTone(type: string): keyof typeof severityStyles {
  const upper = type.toUpperCase();
  if (/HOLD|CANCEL|FAIL|REJECT|OVERDUE|BLOCK/.test(upper)) return "critical";
  if (/PENDING|REVIEW|SUBMIT|DUE|REQUEST|AWAIT/.test(upper)) return "warning";
  return "info";
}

export default function DashboardPage() {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [notifications, setNotifications] = useState<PortalNotification[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    async function loadUser() {
      let token = getAccessToken();
      if (!token) {
        token = await refreshAccessToken();
      }

      if (!token) {
        router.replace("/");
        return;
      }

      async function applyProfile(bearer: string) {
        const response = await fetch(apiUrl("/api/v1/auth/me"), {
          headers: { Authorization: `Bearer ${bearer}` }
        });
        const data = await readJsonSafely(response) as {
          success?: boolean;
          user?: AuthenticatedUser;
        };

        // Throttling and server faults must not read as a rejected session.
        if (response.status === 401 || response.status === 403) return "signed-out" as const;
        if (!response.ok || !data.success || !data.user) return "retry" as const;

        if (data.user.role === "client") {
          router.replace("/client/dashboard");
          return "done" as const;
        }

        setUser(data.user);
        if (!data.user.hasSeenWelcome) setShowModal(true);
        return "done" as const;
      }

      try {
        let outcome = await applyProfile(token);
        if (outcome !== "done") {
          const refreshed = await refreshAccessToken();
          outcome = refreshed ? await applyProfile(refreshed) : "signed-out";
        }
        if (outcome === "signed-out") {
          await logout();
          router.replace("/");
        }
      } catch {
        // Leave the session intact; the operator can reload once the network settles.
      } finally {
        setLoading(false);
      }
    }

    void loadUser();
  }, [router]);

  const loadData = useCallback(async (role: string) => {
    const [nextOverview, nextNotifications] = await Promise.all([
      loadDashboardOverview(role),
      listNotifications().catch(() => null)
    ]);
    setOverview(nextOverview);
    if (nextNotifications) setNotifications(nextNotifications.notifications);
  }, []);

  useEffect(() => {
    if (!user) return;
    const role = user.role;
    let cancelled = false;

    async function run() {
      setDataLoading(true);
      await loadData(role);
      if (!cancelled) setDataLoading(false);
    }

    void run();
    return () => { cancelled = true; };
  }, [user, loadData]);

  // A refetch holds the previous render at reduced opacity rather than dropping
  // back to skeletons, so figures never vanish from under the reader.
  // async function handleRefresh() {
  //   if (!user || refreshing) return;
  //   setRefreshing(true);
  //   try {
  //     await loadData(user.role);
  //   } finally {
  //     setRefreshing(false);
  //   }
  // }

  async function handleClose() {
    setShowModal(false);
    const token = getAccessToken();
    if (!token) return;

    await fetch(apiUrl("/api/v1/auth/welcome-seen"), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    });
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

  if (loading || !user) return <DashboardBootstrap />;

  const capabilities = getDashboardCapabilities(user.role);
  const links = quickLinksForRole(user.role);
  const actions = quickActions.filter((action) => action.roles.includes(user.role));
  const shipments = overview?.shipments ?? null;
  const manifests = overview?.manifests ?? null;
  const accounts = overview?.accounts ?? null;
  const finance = overview?.finance ?? null;
  const tracksShipments = capabilities.includes("shipments");
  const hasScope = capabilities.length > 0;
  const dim = refreshing ? "opacity-60" : "opacity-100";

  const pipelineCard = (
    <SectionCard
      className="lg:col-span-2"
      icon={FiActivity}
      title={tracksShipments ? "Shipment status distribution" : "Manifest lifecycle"}
      subtitle={tracksShipments
        ? "Where the current book of shipments is sitting, in lifecycle order"
        : "Every manifest by stage, from draft through dispatch"}
      footnote={shipments
        ? `Derived from the ${shipments.windowSize} most recent bookings${shipments.windowSaturated ? " — older shipments sit outside this window" : ""}.`
        : undefined}
    >
      {dataLoading ? <BarsSkeleton rows={tracksShipments ? 8 : 6} /> : null}
      {!dataLoading && shipments ? (
        <StagePipelineChart stages={shipments.stages} unitLabel="shipments" dimmed={refreshing} />
      ) : null}
      {!dataLoading && !shipments && manifests?.stages.length ? (
        <StagePipelineChart stages={manifests.stages} unitLabel="manifests" dimmed={refreshing} />
      ) : null}
      {!dataLoading && !shipments && !manifests?.stages.length ? (
        <EmptyState
          icon={FiPackage}
          title="Nothing in the pipeline yet"
          message="Once work is booked, its lifecycle stages appear here with counts and shares."
          actionLabel="New manifest"
          actionHref="/dashboard/operations-manifests/new"
        />
      ) : null}
    </SectionCard>
  );

  const tasksCard = (
    <SectionCard icon={FiClock} title="Upcoming tasks" subtitle="Approvals, queues, and deadlines for your role">
      {dataLoading ? <RowsSkeleton rows={5} /> : null}
      {!dataLoading && overview?.tasks.length ? (
        <ul className={`space-y-1 transition-opacity duration-200 ${dim}`}>
          {overview.tasks.map((task) => (
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
      ) : null}
      {!dataLoading && !overview?.tasks.length ? (
        <EmptyState
          icon={FiCheckCircle}
          title="Your queue is clear"
          message="No approvals, holds, or dispatches are waiting on you right now."
        />
      ) : null}
    </SectionCard>
  );

  const trendCard = (
    <SectionCard
      className="lg:col-span-2"
      icon={FiActivity}
      title="Daily shipment bookings"
      subtitle={shipments
        ? `New bookings per day over the last ${shipments.trendCoversDays} day${shipments.trendCoversDays === 1 ? "" : "s"}`
        : "New bookings per day"}
      footnote={shipments?.bookedValueMinor
        ? `${formatMinorMoney(shipments.bookedValueMinor, shipments.currency)} invoiced across the ${shipments.windowSize} most recent bookings.`
        : undefined}
    >
      {dataLoading ? <ColumnsSkeleton /> : null}
      {!dataLoading && shipments?.trend.length ? (
        <DailyTrendChart points={shipments.trend} unitLabel="bookings" dimmed={refreshing} />
      ) : null}
      {!dataLoading && !shipments?.trend.length ? (
        <EmptyState
          icon={FiPackage}
          title="No bookings to plot"
          message="Book a shipment and the daily trend starts building from today."
          actionLabel="Create shipment"
          actionHref="/dashboard/dpd-labels"
        />
      ) : null}
    </SectionCard>
  );

  const activityCard = (
    <SectionCard
      className="lg:col-span-2"
      icon={FiActivity}
      title="Recent activity"
      subtitle="The latest movements across shipments, manifests, accounts, and tickets"
    >
      {dataLoading ? <RowsSkeleton rows={6} /> : null}
      {!dataLoading && overview?.activity.length ? (
        <ol className={`relative space-y-1 transition-opacity duration-200 ${dim}`}>
          <span aria-hidden="true" className="absolute bottom-5 left-[28px] top-5 w-px bg-white/10" />
          {overview.activity.map((item) => {
            const Icon = activityIcons[item.kind];
            const row = (
              <>
                <span className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-4 ring-[#0D1282] ${activityTones[item.kind]}`}>
                  <Icon aria-hidden="true" className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="truncate text-sm font-semibold text-white">{item.title}</span>
                    <span className="shrink-0 text-[11px] font-medium text-blue-200">{relativeTime(item.at)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-300">{item.detail}</span>
                  <span className="mt-0.5 block truncate text-[11px] font-medium uppercase tracking-wide text-blue-200">{item.actor}</span>
                </span>
              </>
            );

            return (
              <li key={item.id}>
                {item.href ? (
                  <Link
                    href={item.href}
                    className="flex items-start gap-3 rounded-xl p-2 transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  >
                    {row}
                  </Link>
                ) : (
                  <div className="flex items-start gap-3 p-2">{row}</div>
                )}
              </li>
            );
          })}
        </ol>
      ) : null}
      {!dataLoading && !overview?.activity.length ? (
        <EmptyState
          icon={FiActivity}
          title="No activity yet"
          message="Bookings, manifest scans, and account approvals show up here as your team works."
        />
      ) : null}
    </SectionCard>
  );

  const notificationsCard = (
    <SectionCard
      icon={FiBell}
      title="Notifications"
      subtitle="Portal alerts raised for your account"
      className={hasScope ? undefined : "lg:col-span-2"}
    >
      {dataLoading ? <RowsSkeleton rows={4} /> : null}
      {!dataLoading && notifications.length ? (
        <ul className={`divide-y divide-white/10 transition-opacity duration-200 ${dim}`}>
          {notifications.slice(0, 6).map((notification) => {
            const tone = notificationTone(notification.type);
            return (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => void openNotification(notification)}
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
      ) : null}
      {!dataLoading && !notifications.length ? (
        <EmptyState
          icon={FiBell}
          title="No notifications"
          message="Holds, approvals, and payment alerts will land here as they happen."
        />
      ) : null}
    </SectionCard>
  );

  const financeCard = (
    <SectionCard
      icon={FiCreditCard}
      title="Finance snapshot"
      subtitle="Credit exposure across every business account"
      action={
        <Link
          href="/dashboard/credit-accounts"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#F0DE36] hover:underline"
        >
          Credit accounts
          <FiArrowRight aria-hidden="true" className="h-3 w-3" />
        </Link>
      }
    >
      {dataLoading ? <RowsSkeleton rows={4} /> : null}
      {!dataLoading && finance ? (
        <dl className={`space-y-2.5 transition-opacity duration-200 ${dim}`}>
          {[
            { label: "Invoiced outstanding", value: formatMinorMoney(finance.invoicedOutstandingMinor, finance.currency), hint: "Billed and awaiting payment" },
            { label: "Unbilled usage", value: formatMinorMoney(finance.unbilledMinor, finance.currency), hint: "Booked but not yet invoiced" },
            { label: "Approved credit limit", value: formatMinorMoney(finance.approvedLimitMinor, finance.currency), hint: `${finance.activeFacilities} active facilities` },
            { label: "Draft tax invoices", value: String(finance.draftTaxInvoices), hint: "Waiting to be finalised" }
          ].map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-4 rounded-xl bg-white/10 px-3.5 py-3">
              <dt className="min-w-0">
                <span className="block text-xs font-semibold text-slate-200">{row.label}</span>
                <span className="mt-0.5 block text-[11px] text-slate-300">{row.hint}</span>
              </dt>
              <dd className="shrink-0 text-sm font-semibold tabular-nums text-white">{row.value}</dd>
            </div>
          ))}

          {finance.restrictedFacilities ? (
            <p className="flex items-start gap-2 rounded-xl border border-[#D71313]/40 bg-[#D71313]/20 px-3.5 py-3 text-xs font-medium text-[#ffb4b4]">
              <FiAlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {finance.restrictedFacilities} facilit{finance.restrictedFacilities === 1 ? "y is" : "ies are"} restricted by overdue balances.
            </p>
          ) : null}
        </dl>
      ) : null}
      {!dataLoading && !finance ? (
        <EmptyState
          icon={FiCreditCard}
          title="No credit facilities"
          message="Approve a credit account and its exposure appears here."
          actionLabel="Credit accounts"
          actionHref="/dashboard/credit-accounts"
        />
      ) : null}
    </SectionCard>
  );

  return (
    <DashboardShell user={user}>
      <div className="-m-6 min-h-full bg-[#EEEDED]/60 p-6 lg:-m-8 lg:p-8">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
          {/* Welcome header */}
          <section className={`flex flex-wrap items-center justify-between gap-6 p-6 ${panelSurface}`}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center rounded-full bg-white/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                  {describeRole(user.role)}
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-200">
                  <FiCalendar aria-hidden="true" className="h-3.5 w-3.5" />
                  {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                </span>
              </div>

              <h1 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-[28px]">
                {greeting()}, {firstName(user)}
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-300">
                Here is the state of Swiftline Cargo operations for your role — shipment flow, the queues waiting on
                you, and the modules you use most.
              </p>
            </div>

            <div className="flex flex-col items-start gap-3 sm:items-end">
              <div className="flex flex-wrap gap-2">
                {actions.map((action) => {
                  const Icon = action.primary ? FiPlus : action.icon;
                  return (
                    <Link
                      key={action.href}
                      href={action.href}
                      className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 ${
                        action.primary
                          ? "bg-[#F0DE36] text-[#0D1282] shadow-sm shadow-black/20 hover:bg-[#e0cf2e]"
                          : "border border-slate-200 bg-white text-slate-700 hover:border-[#0D1282] hover:text-[#0D1282]"
                      }`}
                    >
                      <Icon aria-hidden="true" className="h-4 w-4" />
                      {action.label}
                    </Link>
                  );
                })}
              </div>

              {/* <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing || dataLoading}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 transition hover:text-[#0D1282] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FiRefreshCw aria-hidden="true" className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing
                  ? "Refreshing"
                  : overview
                    ? `Updated ${new Date(overview.generatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`
                    : "Refresh"}
              </button> */}
            </div>
          </section>

          {overview?.unavailable.length ? (
            <p className="flex items-start gap-2 rounded-xl border border-[#fab219]/40 bg-[#fab219]/[0.08] px-4 py-3 text-xs font-medium text-[#7a4f00]">
              <FiAlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              These sections could not be loaded and read as empty: {overview.unavailable.join(", ")}.
            </p>
          ) : null}

          {/* KPI overview */}
          {hasScope ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {dataLoading
                ? Array.from({ length: tracksShipments ? 8 : 4 }).map((_, index) => <KpiCardSkeleton key={index} />)
                : null}

              {!dataLoading && shipments ? (
                <>
                  <KpiCard
                    icon={FiPackage}
                    label="Booked today"
                    value={formatCount(shipments.bookedToday)}
                    description="Shipments created since midnight"
                    delta={{ current: shipments.bookedToday, previous: shipments.bookedYesterday, period: "yesterday" }}
                    href="/dashboard/dpd-labels"
                  />
                  <KpiCard
                    icon={FiTruck}
                    label="In transit"
                    value={formatCount(shipments.inTransit)}
                    description="Collected through to out for delivery"
                    href="/dashboard/tracking"
                  />
                  <KpiCard
                    icon={FiCheckCircle}
                    label="Delivered"
                    value={formatCount(shipments.delivered)}
                    description={`Of the ${shipments.windowSize} most recent bookings`}
                    href="/dashboard/tracking"
                  />
                  <KpiCard
                    icon={FiAlertTriangle}
                    label="Needs attention"
                    value={formatCount(shipments.exceptions)}
                    description={`${shipments.onHold} on hold, plus returns, cancellations, and failed bookings`}
                    href="/dashboard/dpd-labels"
                    emphasis={shipments.exceptions > 0}
                  />
                </>
              ) : null}

              {!dataLoading && accounts ? (
                <>
                  <KpiCard
                    icon={FiBriefcase}
                    label="Business accounts"
                    value={formatCount(accounts.total)}
                    description={`${accounts.active} active · ${accounts.pendingReview} awaiting review`}
                    href="/dashboard/business-accounts"
                  />
                  <KpiCard
                    icon={FiMapPin}
                    label="Active branches"
                    value={formatCount(accounts.activeBranches)}
                    description="Origins currently accepting bookings"
                    href="/dashboard/branches"
                  />
                </>
              ) : null}

              {!dataLoading && manifests && manifests.detailed ? (
                <>
                  <KpiCard
                    icon={FiArchive}
                    label="Manifests"
                    value={formatCount(manifests.total)}
                    description={`${manifests.packing} packing · ${manifests.readyToSeal} ready to seal`}
                    href="/dashboard/operations-manifests"
                  />
                  <KpiCard
                    icon={FiClock}
                    label="Ready to seal"
                    value={formatCount(manifests.readyToSeal)}
                    description="Bags closed and scans reconciled"
                    href="/dashboard/operations-manifests"
                    emphasis={manifests.readyToSeal > 0}
                  />
                  <KpiCard
                    icon={FiSend}
                    label="Awaiting dispatch"
                    value={formatCount(manifests.sealed)}
                    description="Sealed and waiting on a flight"
                    href="/dashboard/operations-manifests"
                  />
                  <KpiCard
                    icon={FiArrowUpRight}
                    label="Dispatched"
                    value={formatCount(manifests.dispatched)}
                    description="Handed to the carrier to date"
                    href="/dashboard/operations-manifests"
                  />
                </>
              ) : null}

              {!dataLoading && manifests && !manifests.detailed ? (
                <KpiCard
                  icon={FiSend}
                  label="Awaiting dispatch"
                  value={formatCount(manifests.sealed)}
                  description={`${manifests.readyToSeal} more ready to seal`}
                  href="/dashboard/operations-manifests"
                />
              ) : null}

              {!dataLoading && finance ? (
                <KpiCard
                  icon={FiCreditCard}
                  label="Receivables"
                  value={formatCompactMoney(finance.invoicedOutstandingMinor, finance.currency)}
                  description={`Unpaid across ${finance.activeFacilities} active credit facilities`}
                  href="/dashboard/credit-accounts"
                />
              ) : null}
            </div>
          ) : null}

          {hasScope ? (
            <>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {pipelineCard}
                {tasksCard}
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                {tracksShipments ? trendCard : activityCard}
                {notificationsCard}
              </div>

              {tracksShipments ? (
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                  {activityCard}
                  {financeCard}
                </div>
              ) : null}
            </>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {notificationsCard}

              <SectionCard icon={FiLock} title="Reporting scope" subtitle={`Available to the ${describeRole(user.role)} role`}>
                <div className="flex flex-col items-start gap-3">
                  <p className="text-xs leading-6 text-slate-300">
                    Shipment, account, and finance reporting is restricted to the roles that own those records, so
                    no metrics are shown here. Notifications stay live, and an administrator can widen your access
                    if you need operational figures.
                  </p>
                  <Link
                    href="/dashboard/tickets"
                    className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:border-[#F0DE36] hover:text-[#F0DE36]"
                  >
                    Raise a request
                    <FiArrowRight aria-hidden="true" className="h-3 w-3" />
                  </Link>
                </div>
              </SectionCard>
            </div>
          )}

          {/* Recent manifests fill the operations view, where there is no finance panel. */}
          {hasScope && !tracksShipments && manifests ? (
            <SectionCard
              icon={FiArchive}
              title="Recent manifests"
              subtitle="Latest packing lists across your branches"
              action={
                <Link
                  href="/dashboard/operations-manifests"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#F0DE36] hover:underline"
                >
                  View all
                  <FiArrowRight aria-hidden="true" className="h-3 w-3" />
                </Link>
              }
            >
              {manifests.recent.length ? (
                <ul className={`grid grid-cols-1 gap-3 transition-opacity duration-200 sm:grid-cols-2 xl:grid-cols-3 ${dim}`}>
                  {manifests.recent.map((manifest) => (
                    <li key={manifest.id}>
                      <Link
                        href={`/dashboard/operations-manifests/${manifest.id}`}
                        className="block h-full rounded-xl bg-white/10 px-3.5 py-3 transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-white">{manifest.manifestNumber}</span>
                          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                            {manifest.status.replaceAll("_", " ")}
                          </span>
                        </span>
                        <span className="mt-1 block truncate text-xs text-slate-300">
                          {manifest.totalConsignments} consignments · {manifest.totalWeightKg} kg
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-slate-300">
                          {manifest.header.destinationCountryName || "Destination pending"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState
                  icon={FiArchive}
                  title="No manifests yet"
                  message="Start a manifest to begin packing bags and scanning parcels."
                  actionLabel="New manifest"
                  actionHref="/dashboard/operations-manifests/new"
                />
              )}
            </SectionCard>
          ) : null}

          {/* Quick access */}
          {links.length ? (
            <section>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-semibold tracking-tight text-slate-900">Quick access</h2>
                <p className="text-xs text-slate-500">Modules available to your role</p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {links.map((link) => {
                  const Icon = quickLinkIcons[link.href] ?? FiGrid;
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`group flex items-start gap-3 p-4 ${panelSurface} ${panelLift} focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2`}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#F0DE36] transition group-hover:bg-white group-hover:text-[#0D1282]">
                        <Icon aria-hidden="true" className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1 text-sm font-semibold text-white">
                          {link.label}
                          <FiArrowRight aria-hidden="true" className="h-3 w-3 text-blue-200 transition group-hover:translate-x-0.5 group-hover:text-[#F0DE36]" />
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-slate-300">{link.description}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {showModal && <WelcomeModal onClose={handleClose} />}
    </DashboardShell>
  );
}

// Shown only while the session is being confirmed, before the shell can render.
// It mirrors the finished layout so nothing jumps once the data lands.
function DashboardBootstrap() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#EEEDED]/60">
      <div className="h-1 shrink-0 bg-[#0D1282]" />
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-56 shrink-0 border-r border-slate-200 bg-white lg:block">
          <div className="flex h-20 items-center gap-3 border-b border-slate-200 px-3">
            <Shimmer surface="light" className="h-10 w-10 rounded-lg" />
            <Shimmer surface="light" className="h-4 w-24" />
          </div>
          <div className="space-y-2 px-3 py-6">
            {Array.from({ length: 9 }).map((_, index) => <Shimmer key={index} surface="light" className="h-11 w-full rounded-lg" />)}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-20 shrink-0 items-center justify-end gap-4 border-b border-slate-200 bg-white px-8">
            <Shimmer surface="light" className="h-10 w-10 rounded" />
            <Shimmer surface="light" className="h-4 w-32" />
            <Shimmer surface="light" className="h-10 w-24 rounded-lg" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[#EEEDED]/60 p-6 lg:p-8">
            <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
              <div className={`p-6 ${panelSurface}`}>
                <Shimmer className="h-4 w-40" />
                <Shimmer className="mt-4 h-7 w-64" />
                <Shimmer className="mt-3 h-3 w-full max-w-xl" />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 8 }).map((_, index) => <KpiCardSkeleton key={index} />)}
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className={`p-5 lg:col-span-2 ${panelSurface}`}>
                  <Shimmer className="h-4 w-48" />
                  <div className="mt-5"><BarsSkeleton rows={8} /></div>
                </div>
                <div className={`p-5 ${panelSurface}`}>
                  <Shimmer className="h-4 w-32" />
                  <div className="mt-5"><RowsSkeleton rows={5} /></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
