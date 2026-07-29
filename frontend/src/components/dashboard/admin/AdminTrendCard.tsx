"use client";

import { FiActivity, FiPackage } from "react-icons/fi";
import { DailyTrendChart } from "@/components/dashboard/DashboardCharts";
import { ColumnsSkeleton, EmptyState, SectionCard } from "@/components/dashboard/DashboardWidgets";
import { type DashboardOverview, formatMinorMoney } from "@/lib/dashboardOverview";

export default function AdminTrendCard({
  overview,
  dataLoading,
  refreshing
}: {
  overview: DashboardOverview | null;
  dataLoading: boolean;
  refreshing: boolean;
}) {
  const shipments = overview?.shipments ?? null;

  return (
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
}
