"use client";

import { FiPackage } from "react-icons/fi";
import { StagePipelineChart } from "@/components/dashboard/DashboardCharts";
import { EmptyState, SectionCard } from "@/components/dashboard/DashboardWidgets";
import { buildShipmentPipeline, type ClientMeter } from "@/lib/clientDashboardOverview";
import type { ClientShipmentSummary } from "@/lib/clientDashboard";

export default function ClientShipmentPipelineCard({
  summary,
  refreshing,
  canCreateShipment
}: {
  summary: ClientShipmentSummary;
  refreshing: boolean;
  canCreateShipment: boolean;
}) {
  const pipeline = buildShipmentPipeline(summary);
  // const meters = buildCompletionMeters(summary);

  return (
    <SectionCard
      className="lg:col-span-2"
      icon={FiPackage}
      title="Shipment pipeline"
      subtitle="Where your shipment drafts are sitting right now"
    >
      {summary.totalShipments ? (
        <>
          <StagePipelineChart stages={pipeline} unitLabel="shipments" dimmed={refreshing} />
          {/* <div className="mt-5 grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2">
            {meters.map((meter) => <Meter key={meter.key} meter={meter} />)}
          </div> */}
        </>
      ) : (
        <EmptyState
          icon={FiPackage}
          title="No shipments yet"
          message={canCreateShipment
            ? "Create a shipment to start building dashboard activity."
            : "Shipment creation is paused until a rate card is assigned."}
          actionLabel={canCreateShipment ? "Create Shipment" : undefined}
          actionHref={canCreateShipment ? "/client/dpd-labels" : undefined}
        />
      )}
    </SectionCard>
  );
}

function Meter({ meter }: { meter: ClientMeter }) {
  const percent = meter.total ? Math.round((meter.count / meter.total) * 100) : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-slate-600">{meter.label}</p>
        <p className="text-xs font-semibold tabular-nums text-slate-500">{meter.count} / {meter.total}</p>
      </div>
      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-2.5 rounded-full bg-[#7498ff] transition-[width] duration-300"
          style={{ width: `${meter.total ? Math.max(percent, meter.count ? 2 : 0) : 0}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-slate-500">{meter.detail} - {percent}%</p>
    </div>
  );
}
