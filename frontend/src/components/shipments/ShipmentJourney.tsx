"use client";

import { FiCheck, FiClock } from "react-icons/fi";
import { formatDashboardDateTime } from "@/lib/dateFormat";
import {
  resolveJourneyStages,
  type DeliveryEstimate,
  type TrackingJourney
} from "@/lib/shipmentJourney";

/**
 * The shipment's journey as a row of stages, and whether it is going to arrive
 * when it should.
 *
 * This is the *portal's* rail. The stages themselves, and which statuses reach
 * them, live in `@/lib/shipmentJourney` because the public tracker draws its own
 * rail from the same data - the two may look nothing alike, but they must never
 * disagree about how far a shipment has got.
 */

export type { DeliveryEstimate };

const scheduleChips: Record<DeliveryEstimate["state"], { label: string; className: string }> = {
  ON_SCHEDULE: { label: "On Schedule", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  POTENTIAL_DELAY: { label: "Potential Delay", className: "border-amber-200 bg-amber-50 text-amber-800" },
  DELAYED: { label: "Delayed", className: "border-red-200 bg-red-50 text-red-700" },
  DELIVERED: { label: "Delivered", className: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  // A hold means the date can no longer be relied on- not that it has passed.
  ON_HOLD: { label: "Estimate Paused", className: "border-slate-300 bg-slate-100 text-slate-600" }
};

/**
 * The customer's cue that this shipment is waiting on them.
 *
 * Kept off the Estimated Delivery card deliberately. That card's chip has to
 * describe the date, and "action required" says nothing about when a parcel
 * arrives- it belongs beside the status, which is what the customer would act
 * on. The two chips can and often do show at once: a held shipment is both
 * waiting on the customer and no longer on a reliable schedule.
 */
export function ActionRequiredChip({
  attention
}: {
  attention: { label: string } | null | undefined;
}) {
  if (!attention) return null;

  return (
    <span className="inline-flex rounded-4xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold uppercase text-red-700">
      Action required
    </span>
  );
}

export function ScheduleChip({ estimate }: { estimate: DeliveryEstimate | null }) {
  if (!estimate) return null;
  const chip = scheduleChips[estimate.state];

  return (
    <span className={`inline-flex rounded-4xl border px-3 py-1 text-xs font-semibold uppercase ${chip.className}`}>
      {chip.label}
    </span>
  );
}

export function EstimatedDelivery({ estimate }: { estimate: DeliveryEstimate | null }) {
  if (!estimate) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Estimated Delivery</p>
        <p className="mt-1 text-sm text-slate-500">
          Not available for this destination yet.
        </p>
      </div>
    );
  }

  const unit = estimate.transitBasis === "BUSINESS_DAYS" ? "business days" : "calendar days";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {estimate.deliveredAt ? "Delivered" : "Estimated Delivery"}
        </p>
        <ScheduleChip estimate={estimate} />
      </div>
      <p className="mt-2 text-lg font-semibold text-slate-950">
        {formatDashboardDateTime(estimate.deliveredAt ?? estimate.estimatedDeliveryAt)}
      </p>
      {!estimate.deliveredAt ? (
        <p className="mt-1 text-xs text-slate-500">
          {estimate.transitDaysMin === estimate.transitDaysMax
            ? `${estimate.transitDaysMax} ${unit} in transit`
            : `${estimate.transitDaysMin}–${estimate.transitDaysMax} ${unit} in transit`}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The stage rail.
 *
 * A stage counts as reached when any of its statuses has been recorded, so a
 * shipment that skipped a scan still shows the progress it genuinely made
 * rather than stalling at the missing step.
 */
export function ShipmentJourney({
  events,
  journey
}: {
  events: Array<{ status: string; eventAt: string }>;
  journey?: TrackingJourney | null;
}) {
  const stages = resolveJourneyStages(events, journey);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shipment journey</h2>

      {journey?.context.routeSegments.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
          {journey.context.routeSegments.map((segment, index) => (
            <span key={`${segment}-${index}`} className="contents">
              {index ? <span aria-hidden="true" className="text-slate-300">→</span> : null}
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">{segment}</span>
            </span>
          ))}
        </div>
      ) : null}

      <ol className="mt-4 flex flex-col gap-0 md:flex-row md:gap-0">
        {stages.map((stage, index) => {
          const reached = stage.reachedAt !== null;

          return (
            <li key={stage.label} className="relative flex flex-1 gap-3 pb-5 md:flex-col md:gap-2 md:pb-0">
              {/* The connector runs down on a phone and across from md, so the
                  rail never forces the page sideways on a narrow screen. */}
              {index < stages.length - 1 ? (
                <span
                  aria-hidden="true"
                  // Green only when the stage it leads *to* was actually
                  // recorded. Filling the whole rail up to the last reached
                  // stage would draw a completed path through steps that never
                  // happened, next to labels still reading "Pending".
                  className={`absolute left-[11px] top-6 h-full w-0.5 md:left-auto md:top-[11px] md:h-0.5 md:w-full md:translate-x-1/2 ${
                    stages[index + 1].reachedAt ? "bg-emerald-400" : "bg-slate-200"
                  }`}
                />
              ) : null}

              <span
                className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                  reached
                    ? stage.isCurrent
                      ? "border-[#0D1282] bg-[#0D1282] text-white"
                      : "border-emerald-400 bg-emerald-400 text-white"
                    : "border-slate-200 bg-white text-slate-300"
                }`}
              >
                {reached ? <FiCheck aria-hidden="true" className="h-3 w-3" /> : <FiClock aria-hidden="true" className="h-3 w-3" />}
              </span>

              <div className="min-w-0 md:pr-3">
                <p className={`text-xs font-semibold ${reached ? "text-slate-900" : "text-slate-400"}`}>
                  {stage.label}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  {reached ? formatDashboardDateTime(stage.reachedAt) : "Pending"}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
