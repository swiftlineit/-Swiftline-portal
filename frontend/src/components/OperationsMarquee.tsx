"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiAlertOctagon, FiAlertTriangle, FiInfo } from "react-icons/fi";
import {
  listClientServiceDisruptions,
  listServiceDisruptions,
  serviceDisruptionTypeLabels,
  type ServiceDisruption
} from "@/lib/operationsAdvisory";

/** Ticker travel speed, so the marquee reads comfortably at any content width. */
const SCROLL_SPEED_PX_PER_SECOND = 80;

/** A disruption counts as a "new update" until it is this old; it then carries
    a glowing NEW badge at the start of its segment in the marquee. */
const NEW_UPDATE_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * The operational advisory ticker that runs across the dashboard headers.
 * `variant` decides which endpoint to read: the client variant asks the client
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
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(0);
  const [halfCopies, setHalfCopies] = useState(1);
  const [durationSeconds, setDurationSeconds] = useState(40);
  const unitRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const result = variant === "client"
        ? await listClientServiceDisruptions()
        : await listServiceDisruptions({ scope: "live" });
      setDisruptions(result.disruptions);
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

  const items = useMemo(
    () => disruptions.map((disruption) => ({
      key: disruption.id,
      label: serviceDisruptionTypeLabels[disruption.type],
      disruption,
      isNew: disruption.createdAt
        ? now - new Date(disruption.createdAt).getTime() < NEW_UPDATE_WINDOW_MS
        : false
    })),
    [disruptions, now]
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
              label={item.label}
              disruption={item.disruption}
              isNew={item.isNew}
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
                label={item.label}
                disruption={item.disruption}
                isNew={item.isNew}
              />
            ))
          )}
          {Array.from({ length: halfCopies }, (_, copy) =>
            items.map((item) => (
              <MarqueeSegment
                key={`${item.key}-copy-${copy}`}
                label={item.label}
                disruption={item.disruption}
                isNew={item.isNew}
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
  label,
  disruption,
  isNew = false,
  ariaHidden = false,
}: {
  label: string;
  disruption: ServiceDisruption;
  isNew?: boolean;
  ariaHidden?: boolean;
}) {
  const Icon = disruption.severity === "CRITICAL"
    ? FiAlertOctagon
    : disruption.severity === "WARNING"
      ? FiAlertTriangle
      : FiInfo;

  const dotClass = disruption.severity === "CRITICAL"
    ? "bg-[#FF4D4D]"
    : disruption.severity === "WARNING"
      ? "bg-amber-400"
      : "bg-emerald-400";

  return (
    <span
      aria-hidden={ariaHidden || undefined}
      className="inline-flex items-center gap-2 pr-12 text-sm font-medium text-white/95"
    >
      {isNew ? (
        <span
          className="inline-flex shrink-0 items-center rounded-full bg-red-600 p-1.5 text-[10px]  uppercase leading-none tracking-wide text-white animate-advisory-glow"
        >
          New
        </span>
      ) : null}
      <span className="flex items-center gap-1.5">
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        <span className="font-bold uppercase tracking-wide">{label}:</span>
      </span>
      <span>{disruption.title}</span>
      <span className="hidden text-white/70 lg:inline">- {disruption.message}</span>
      <span className={`ml-1 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
    </span>
  );
}
