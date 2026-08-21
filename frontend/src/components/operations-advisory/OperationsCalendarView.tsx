"use client";

import {
  FiAlertOctagon,
  FiAlertTriangle,
  FiCalendar,
  FiClock,
  FiGlobe,
  FiInfo,
  FiMapPin,
  FiFileText,
  FiPackage,
  FiSend,
  FiShield,
  FiTruck,
  FiTrendingUp
} from "react-icons/fi";
import type { IconType } from "react-icons";
import {
  calendarCategories,
  calendarCategoryLabels,
  regulatoryShipmentDirectionLabels,
  regulatoryShipmentTypeLabels,
  regulatoryUpdateCategoryLabels,
  serviceDisruptionTypeLabels,
  type CalendarCategory,
  type CalendarEntry,
  type RegulatoryUpdate,
  type ServiceDisruption
} from "@/lib/operationsAdvisory";
import { regulatoryRegionLabel } from "@/lib/regulatoryRegions";

/**
 * The read-only Holiday & Cut-Off Calendar. Shared by the client page and (via
 * the management tab) the staff view, so the two can never drift apart. Each
 * category renders as its own panel; service disruptions sit on top as
 * severity-tinted banners.
 */

const categoryMeta: Record<CalendarCategory, { icon: IconType; subtitle: string }> = {
  BRANCH_HOLIDAY: { icon: FiMapPin, subtitle: "Days our branches are closed" },
  DESTINATION_HOLIDAY: { icon: FiGlobe, subtitle: "Public holidays at destination countries" },
  CUSTOMS_HOLIDAY: { icon: FiShield, subtitle: "Customs offices closed" },
  PICKUP_CUTOFF: { icon: FiTruck, subtitle: "Latest time to request a pickup" },
  SAME_DAY_BOOKING_CUTOFF: { icon: FiClock, subtitle: "Latest time to book for same-day dispatch" },
  FLIGHT_CLOSING_TIME: { icon: FiSend, subtitle: "When the next flight closes for a route" },
  WEEKEND_DELIVERY: { icon: FiPackage, subtitle: "Whether weekend deliveries run" },
  PEAK_SEASON_RESTRICTION: { icon: FiTrendingUp, subtitle: "Restrictions and surcharges during peak periods" }
};

const monthNames = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

function formatCalendarDate(value: string | null) {
  if (!value) return null;
  const iso = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;

  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${monthNames[(month ?? 1) - 1]} ${year}`;
}

function formatTime(value: string | null) {
  if (!value) return null;
  const [rawHour, rawMinute] = value.split(":").map(Number);
  if (rawHour === undefined || rawMinute === undefined) return value;

  const hour = rawHour % 12 === 0 ? 12 : rawHour % 12;
  const period = rawHour >= 12 ? "PM" : "AM";
  return `${hour}:${String(rawMinute).padStart(2, "0")} ${period}`;
}

function formatLocalDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function branchLabel(entry: CalendarEntry) {
  return entry.branch ? `${entry.branch.code} · ${entry.branch.name}` : "All branches";
}

/** The one-line detail shown under an entry title, per category. */
function entryDetail(entry: CalendarEntry): string {
  switch (entry.category) {
    case "BRANCH_HOLIDAY":
      return `${formatCalendarDate(entry.date) ?? "TBA"} · ${branchLabel(entry)}`;
    case "DESTINATION_HOLIDAY":
      return [
        entry.countryCode ?? "",
        entry.locationLabel ? `via ${entry.locationLabel}` : "",
        formatCalendarDate(entry.date) ?? ""
      ].filter(Boolean).join(" · ");
    case "CUSTOMS_HOLIDAY":
      return `${entry.countryCode ?? "Customs"} · ${formatCalendarDate(entry.date) ?? "TBA"}`;
    case "PICKUP_CUTOFF":
    case "SAME_DAY_BOOKING_CUTOFF":
      return `${formatTime(entry.time) ?? "TBA"} · ${branchLabel(entry)}`;
    case "FLIGHT_CLOSING_TIME":
      return `${entry.locationLabel ?? "Route"} · ${formatTime(entry.time) ?? "TBA"}`;
    case "WEEKEND_DELIVERY":
      return `${branchLabel(entry)} · ${entry.weekendDeliveryAvailable ? "Available" : "Not available"}`;
    case "PEAK_SEASON_RESTRICTION":
      return [formatCalendarDate(entry.date), formatCalendarDate(entry.endDate)]
        .filter(Boolean)
        .join(" - ") || "In effect";
  }
}

function severityIcon(severity: ServiceDisruption["severity"]) {
  return severity === "CRITICAL" ? FiAlertOctagon : severity === "WARNING" ? FiAlertTriangle : FiInfo;
}

export default function OperationsCalendarView({
  entries,
  disruptions,
  regulatoryUpdates = []
}: {
  entries: CalendarEntry[];
  disruptions: ServiceDisruption[];
  /** Customs & regulatory updates, published from their own admin tab. */
  regulatoryUpdates?: RegulatoryUpdate[];
}) {
  const byCategory = new Map<CalendarCategory, CalendarEntry[]>();
  for (const category of calendarCategories) {
    byCategory.set(category, []);
  }
  for (const entry of entries) {
    byCategory.get(entry.category)?.push(entry);
  }

  const hasContent = entries.length > 0 || disruptions.length > 0 || regulatoryUpdates.length > 0;

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white px-6 py-16 text-center">
        <FiCalendar aria-hidden="true" className="h-10 w-10 text-slate-300" />
        <p className="text-sm font-semibold text-slate-900">No operational information yet</p>
        <p className="max-w-sm text-sm text-slate-500">
          Holidays, cut-off times, customs updates and service alerts will appear here as soon as our team publishes them.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {disruptions.length ? (
        <section aria-labelledby="service-disruptions-heading">
          <div className="mb-3 flex items-center gap-2">
            <FiAlertOctagon aria-hidden="true" className="h-4 w-4 text-[#D71313]" />
            <h2 id="service-disruptions-heading" className="text-sm font-bold uppercase tracking-wide text-slate-900">
              Service Disruptions
            </h2>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {disruptions.map((disruption) => {
              const Icon = severityIcon(disruption.severity);
              const tone = disruption.severity === "CRITICAL"
                ? "border-[#D71313]/30 bg-[#D71313]/[0.06]"
                : disruption.severity === "WARNING"
                  ? "border-amber-400/50 bg-amber-50"
                  : "border-blue-200 bg-blue-50/60";

              return (
                <article key={disruption.id} className={`rounded-xl border px-4 py-3 ${tone}`}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="flex items-center gap-2 text-sm font-bold text-slate-950">
                      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                      {disruption.title}
                    </p>
                    <span className="shrink-0 rounded-full bg-white/70 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                      {serviceDisruptionTypeLabels[disruption.type]}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-slate-700">{disruption.message}</p>
                  <p className="mt-2 text-[11px] font-medium text-slate-500">
                    {formatLocalDate(disruption.startAt)} onward
                    {disruption.endAt ? ` · until ${formatLocalDate(disruption.endAt)}` : ""}
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <RegulatoryUpdatesSection updates={regulatoryUpdates} />

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3" aria-label="Holiday and cut-off calendar">
        {calendarCategories.map((category) => {
          const categoryEntries = byCategory.get(category) ?? [];
          const meta = categoryMeta[category];
          const Icon = meta.icon;

          return (
            <div key={category} className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0D1282]/[0.07] text-[#0D1282]">
                  <Icon aria-hidden="true" className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-950">{calendarCategoryLabels[category]}</h3>
                  <p className="mt-0.5 text-xs text-slate-500">{meta.subtitle}</p>
                </div>
              </div>

              <div className="flex flex-1 flex-col divide-y divide-slate-100">
                {!categoryEntries.length ? (
                  <p className="px-4 py-5 text-sm text-slate-400">No entries published.</p>
                ) : categoryEntries.map((entry) => (
                  <div key={entry.id} className="px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900">{entry.title}</p>
                    <p className="mt-0.5 text-xs text-slate-600">{entryDetail(entry)}</p>
                    {entry.description ? (
                      <p className="mt-1.5 text-xs leading-5 text-slate-500">{entry.description}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

const regulatoryStatusTone: Record<RegulatoryUpdate["status"], string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800",
  UPCOMING: "bg-amber-100 text-amber-800",
  EXPIRED: "bg-slate-200 text-slate-600"
};

/** "All · All" reads like noise, so a blanket scope is simply not printed. */
function scopeLabel(update: RegulatoryUpdate) {
  const parts: string[] = [];

  if (!update.affectedShipments.includes("ALL")) {
    parts.push(update.affectedShipments.map((value) => regulatoryShipmentDirectionLabels[value]).join(" / "));
  }
  if (!update.shipmentTypes.includes("ALL")) {
    parts.push(update.shipmentTypes.map((value) => regulatoryShipmentTypeLabels[value]).join(" / "));
  }
  if (update.valueThreshold) parts.push(update.valueThreshold);

  return parts.join(" · ");
}

function effectiveLabel(update: RegulatoryUpdate) {
  if (update.effectiveFromTbc || !update.effectiveFrom) return "Effective date to be confirmed";

  const from = formatLocalDate(update.effectiveFrom);
  const until = update.effectiveUntil ? formatLocalDate(update.effectiveUntil) : null;

  return until ? `Effective ${from} - ${until}` : `Effective from ${from}`;
}

/**
 * Customs and regulatory changes, kept out of the holiday grid on purpose: a
 * client reads these for what they have to *do*, not for which day an office
 * is shut. Rendered wide so the impact and action text stay readable.
 */
function RegulatoryUpdatesSection({ updates }: { updates: RegulatoryUpdate[] }) {
  if (!updates.length) return null;

  return (
    <section aria-labelledby="regulatory-updates-heading">
      <div className="mb-3 flex items-center gap-2">
        <FiFileText aria-hidden="true" className="h-4 w-4 text-[#0D1282]" />
        <h2 id="regulatory-updates-heading" className="text-sm font-bold uppercase tracking-wide text-slate-900">
          Customs & Regulatory Updates
        </h2>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {updates.map((update) => {
          const scope = scopeLabel(update);

          return (
            <article key={update.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-bold text-slate-950">{update.title}</p>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${regulatoryStatusTone[update.status]}`}>
                  {update.status}
                </span>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {update.regions.map((code) => (
                  <span key={code} className="rounded-full bg-[#0D1282]/[0.07] px-2 py-0.5 text-[10px] font-semibold text-[#0D1282]">
                    {regulatoryRegionLabel(code)}
                  </span>
                ))}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                  {regulatoryUpdateCategoryLabels[update.category]}
                </span>
              </div>

              <p className="mt-2 text-sm leading-6 text-slate-700">{update.customerImpact}</p>

              {update.actionRequired ? (
                <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-700">
                  <span className="font-bold uppercase tracking-wide text-slate-500">Action required: </span>
                  {update.actionRequired}
                </p>
              ) : null}

              <p className="mt-2 text-[11px] font-medium text-slate-500">
                {effectiveLabel(update)}
                {scope ? ` · ${scope}` : ""}
              </p>

              {update.sourceUrl ? (
                <a
                  href={update.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-block text-[11px] font-semibold text-[#0D1282] hover:underline"
                >
                  Official source
                </a>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
