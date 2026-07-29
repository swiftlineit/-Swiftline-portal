"use client";

import {
  FiAlertTriangle,
  FiArchive,
  FiArrowUpRight,
  FiBriefcase,
  FiCheckCircle,
  FiClock,
  FiCreditCard,
  FiMapPin,
  FiPackage,
  FiSend,
  FiTruck
} from "react-icons/fi";
import { KpiCard, KpiCardSkeleton } from "@/components/dashboard/DashboardWidgets";
import {
  type DashboardOverview,
  formatCompactMoney,
  formatCount
} from "@/lib/dashboardOverview";

export default function AdminKpiGrid({
  overview,
  dataLoading,
  tracksShipments
}: {
  overview: DashboardOverview | null;
  dataLoading: boolean;
  tracksShipments: boolean;
}) {
  const shipments = overview?.shipments ?? null;
  const manifests = overview?.manifests ?? null;
  const accounts = overview?.accounts ?? null;
  const finance = overview?.finance ?? null;

  return (
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
            description={`${accounts.active} active, ${accounts.pendingReview} awaiting review`}
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
            description={`${manifests.packing} packing, ${manifests.readyToSeal} ready to seal`}
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
  );
}
