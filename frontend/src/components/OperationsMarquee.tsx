"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiAlertOctagon, FiAlertTriangle, FiFileText, FiInfo } from "react-icons/fi";
import type { IconType } from "react-icons";
import {
  isNewAdvisory,
  listClientRegulatoryUpdates,
  listClientServiceDisruptions,
  listRegulatoryUpdates,
  listServiceDisruptions,
  regulatoryUpdateCategoryLabels,
  serviceDisruptionTypeLabels,
  type RegulatoryUpdate,
  type ServiceDisruption
} from "@/lib/operationsAdvisory";

/** Ticker travel speed, so the marquee reads comfortably at any content width. */
const SCROLL_SPEED_PX_PER_SECOND = 80;

/** One rendered segment of the ticker, whatever kind of advisory it came from. */
type MarqueeItem = {
  key: string;
  label: string;
  title: string;
  detail: string;
  icon: IconType;
  dotClass: string;
  isNew: boolean;
};

/**
 * The operational advisory ticker that runs across the dashboard headers. It
 * carries both service disruptions and the customs & regulatory updates
 * published alongside them, so one glance covers everything in force.
 *
 * `variant` decides which endpoints to read: the client variant asks the client
 * router (active + inside its time window) while the staff variant asks the
 * staff router for the same "live" slice, so both headers tell the same story.
 *
 * The track is always wider than its container: one content pass is measured
 * and repeated until it fills the viewport, then rendered a second time. The
 * marquee-scroll keyframe translates exactly -50% (one pass) on a linear loop,
 * so text keeps scrolling right-to-left with no visible jump or gap and every
 * message is readable from start to end.
 */
export default function OperationsMarquee({
  variant = "client",
}: {
  variant?: "client" | "staff";
}) {
  const [disruptions, setDisruptions] = useState<ServiceDisruption[]>([]);
  const [regulatoryUpdates, setRegulatoryUpdates] = useState<RegulatoryUpdate[]>([]);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(0);
  const [halfCopies, setHalfCopies] = useState(1);
  const [durationSeconds, setDurationSeconds] = useState(40);
  const unitRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [disruptionResult, regulatoryResult] = variant === "client"
        ? await Promise.all([listClientServiceDisruptions(), listClientRegulatoryUpdates()])
        : await Promise.all([
          listServiceDisruptions({ scope: "live" }),
          listRegulatoryUpdates({ active: true })
        ]);
      setDisruptions(disruptionResult.disruptions);
      // Expired rules are dropped for staff too, so both headers scroll the
      // same list the client endpoint already narrows to.
      setRegulatoryUpdates(regulatoryResult.updates.filter((update) => update.status !== "EXPIRED"));
      setReady(true);
    } catch {
      // The marquee is decorative surface: a network failure must never take
      // down the header it sits in, so it just stays empty until the next poll.
    } finally {
      // Refresh the "now" reference on every poll so the 48-hour freshness
      // window for the glowing badge keeps ticking even on a long-lived page.
      setNow(Date.now());
    }
  }, [variant]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 60_000);

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [load]);

  // Disruptions lead: they are happening now, while a regulatory update is
  // usually about something a client has time to prepare for.
  const items = useMemo<MarqueeItem[]>(
    () => [
      ...disruptions.map((disruption) => ({
        key: `disruption:${disruption.id}`,
        label: serviceDisruptionTypeLabels[disruption.type],
        title: disruption.title,
        detail: disruption.message,
        icon: disruption.severity === "CRITICAL"
          ? FiAlertOctagon
          : disruption.severity === "WARNING"
            ? FiAlertTriangle
            : FiInfo,
        dotClass: disruption.severity === "CRITICAL"
          ? "bg-[#FF4D4D]"
          : disruption.severity === "WARNING"
            ? "bg-amber-400"
            : "bg-emerald-400",
        isNew: isNewAdvisory(disruption.createdAt, now)
      })),
      ...regulatoryUpdates.map((update) => ({
        key: `regulatory:${update.id}`,
        label: regulatoryUpdateCategoryLabels[update.category],
        title: update.title,
        detail: update.customerImpact,
        icon: FiFileText,
        // Upcoming rules read as a heads-up, live ones as in force now.
        dotClass: update.status === "ACTIVE" ? "bg-emerald-400" : "bg-amber-400",
        isNew: isNewAdvisory(update.createdAt, now)
      }))
    ],
    [disruptions, regulatoryUpdates, now]
  );

  // Size the loop from the measured width of a single content pass so there is
  // always a full container's worth of text ahead of the left edge. The
  // duration is scaled to that width, keeping the scroll speed constant.
  useEffect(() => {
    const unit = unitRef.current;
    const container = unit?.parentElement;
    if (!unit || !container) return;

    const unitWidth = Math.ceil(unit.scrollWidth);
    if (unitWidth <= 0) return;

    const copies = Math.max(1, Math.ceil(container.clientWidth / unitWidth));
    setHalfCopies((previous) => (previous === copies ? previous : copies));

    const halfWidth = copies * unitWidth;
    setDurationSeconds((previous) => {
      const next = Math.max(10, Math.round((2 * halfWidth) / SCROLL_SPEED_PX_PER_SECOND));
      return previous === next ? previous : next;
    });
  }, [items]);

  if (!ready || !items.length) return null;

  return (
    <div
      role="status"
      className="group relative flex h-9 shrink-0 items-center gap-3 overflow-hidden border-b border-slate-200 bg-[#0D1282] px-4"
    >
      <span className="flex h-5 shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-2.5 text-[11px] font-bold uppercase tracking-wide text-white">
        <FiAlertOctagon aria-hidden="true" className="h-3 w-3" />
        Advisory
      </span>

      <div className="relative min-w-0 flex-1 overflow-hidden">
        {/* One content pass, kept out of the visible flow and used purely to
            measure the width so the repeated track fills the viewport. */}
        <div
          ref={unitRef}
          aria-hidden="true"
          className="invisible absolute left-0 top-0 flex w-max items-center whitespace-nowrap"
        >
          {items.map((item) => (
            <MarqueeSegment
              key={item.key}
              item={item}
              ariaHidden
            />
          ))}
        </div>

        <div
          className="flex w-max animate-marquee items-center whitespace-nowrap group-hover:[animation-play-state:paused]"
          style={{ animationDuration: `${durationSeconds}s` }}
        >
          {Array.from({ length: halfCopies }, (_, copy) =>
            items.map((item) => (
              <MarqueeSegment
                key={`${item.key}-${copy}`}
                item={item}
              />
            ))
          )}
          {Array.from({ length: halfCopies }, (_, copy) =>
            items.map((item) => (
              <MarqueeSegment
                key={`${item.key}-copy-${copy}`}
                item={item}
                ariaHidden
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function MarqueeSegment({
  item,
  ariaHidden = false,
}: {
  item: MarqueeItem;
  ariaHidden?: boolean;
}) {
  const Icon = item.icon;

  return (
    <span
      aria-hidden={ariaHidden || undefined}
      className="inline-flex items-center gap-2 pr-12 text-sm font-medium text-white/95"
    >
      {item.isNew ? (
        <span
          className="inline-flex shrink-0 items-center rounded-full bg-red-600 p-1.5 text-[10px]  uppercase leading-none tracking-wide text-white animate-advisory-glow"
        >
          New
        </span>
      ) : null}
      <span className="flex items-center gap-1.5">
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span className="font-bold uppercase tracking-wide">{item.label}:</span>
      </span>
      <span>{item.title}</span>
      <span className="hidden text-white/70 lg:inline">- {item.detail}</span>
      <span className={`ml-1 h-1.5 w-1.5 shrink-0 rounded-full ${item.dotClass}`} />
    </span>
  );
}
