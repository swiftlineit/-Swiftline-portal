"use client";

import { FiActivity, FiPackage } from "react-icons/fi";
import { StagePipelineChart } from "@/components/dashboard/DashboardCharts";
import { BarsSkeleton, EmptyState, SectionCard } from "@/components/dashboard/DashboardWidgets";
import type { DashboardOverview } from "@/lib/dashboardOverview";

export default function AdminPipelineCard({
  overview,
  dataLoading,
  refreshing,
  tracksShipments
}: {
  overview: DashboardOverview | null;
  dataLoading: boolean;
  refreshing: boolean;
  tracksShipments: boolean;
}) {
  const shipments = overview?.shipments ?? null;
  const manifests = overview?.manifests ?? null;

  return (
    <SectionCard
      className="lg:col-span-2"
      icon={FiActivity}
      title={tracksShipments ? "Shipment status distribution" : "Manifest lifecycle"}
      subtitle={tracksShipments
        ? "Where the current book of shipments is sitting, in lifecycle order"
        : "Every manifest by stage, from draft through dispatch"}
      footnote={shipments
        ? `Derived from the ${shipments.windowSize} most recent bookings${shipments.windowSaturated ? " - older shipments sit outside this window" : ""}.`
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
}
