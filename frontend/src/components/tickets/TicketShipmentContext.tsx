"use client";

import { FiPackage } from "react-icons/fi";
import { formatDashboardDateTime } from "@/lib/dateFormat";

/**
 * What the shipment behind a ticket actually is.
 *
 * Shown in two places — beside the AWB picker while a ticket is being written,
 * and on the ticket itself once it exists. Neither the customer describing the
 * problem nor the agent working it should have to open the shipment to answer
 * "where is it and what is it"; that lookup is the step this removes.
 *
 * Takes a plain shape rather than either caller's own type, because the raise
 * form reads a shipment list row and the ticket reads its own summary, and the
 * panel should not know the difference.
 */
export type TicketShipmentSummary = {
  awb: string;
  origin: string;
  destination: string;
  consignee: string;
  bookedAt: string | null;
  statusLabel: string;
  lastScan: { statusLabel: string; location: string; at: string } | null;
  service: string;
};

export default function TicketShipmentContext({
  shipment,
  className = ""
}: {
  shipment: TicketShipmentSummary;
  className?: string;
}) {
  const fields: Array<{ label: string; value: string }> = [
    { label: "Origin", value: shipment.origin || "—" },
    { label: "Destination", value: shipment.destination || "—" },
    { label: "Consignee", value: shipment.consignee || "—" },
    { label: "Booking date", value: shipment.bookedAt ? formatDashboardDateTime(shipment.bookedAt) : "—" },
    { label: "Current status", value: shipment.statusLabel || "—" },
    {
      label: "Last scan",
      // Location is optional on an event, so a scan with no place recorded
      // still reads as its status and time rather than an empty field.
      value: shipment.lastScan
        ? [
          shipment.lastScan.statusLabel,
          shipment.lastScan.location,
          formatDashboardDateTime(shipment.lastScan.at)
        ].filter(Boolean).join(" · ")
        : "No scan recorded yet"
    },
    { label: "Service", value: shipment.service || "—" }
  ];

  return (
   <section
  className={`overflow-hidden rounded-2xl border border-slate-200 bg-white ${className}`}
>
  {/* Header */}
  <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white">
        <FiPackage
          aria-hidden="true"
          className="h-4 w-4 text-slate-500"
        />
      </div>

      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-900">
          Shipment details
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">
          Shipment information and reference details
        </p>
      </div>
    </div>

    <div className="self-start sm:self-auto">
      <span className="inline-flex max-w-full items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm">
        <span className="mr-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
          AWB
        </span>
        <span className="truncate">
          {shipment.awb || "Pending"}
        </span>
      </span>
    </div>
  </div>

  {/* Details */}
  <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
    {fields.map((field, index) => (
      <div
        key={field.label}
        className={[
          "min-w-0 px-4 py-3.5 sm:px-5",
          "border-b border-slate-100",
          "sm:border-r",
          "lg:border-r",
          index === fields.length - 1 ? "border-b-0" : "",
        ].join(" ")}
      >
        <dt className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
          {field.label}
        </dt>

        <dd
          className="break-words text-sm font-medium leading-5 text-slate-800"
          title={field.value}
        >
          {field.value}
        </dd>
      </div>
    ))}
  </dl>
</section>
  );
}
