"use client";

import type { ComponentType } from "react";
import { useState } from "react";
import { FiAlertTriangle, FiBarChart2, FiCornerUpLeft, FiHelpCircle, FiPauseCircle, FiTable, FiXCircle } from "react-icons/fi";
import type { StageCount, TrendPoint } from "@/lib/dashboardOverview";

// Ordinal ramp in the Swiftline primary hue (OKLCH hue 267.5, the hue of
// #0D1282): one hue, monotone lightness, lightest step clears 2:1 on white.
// Lifecycle position picks the step, so the reader sees the order in the colour.
const stageRamp = ["#7498ff", "#5c7fe6", "#4666ca", "#314eb0", "#1e3596"];

// Reserved status steps for the exception rows, kept clear of the ramp. Warning
// and serious sit below 3:1 on white by design, which is why every exception row
// carries an icon and a written label as well as its colour.
const exceptionFills = { warning: "#fab219", serious: "#ec835a", critical: "#D71313" } as const;

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

// Two states can share a severity, so the icon comes from the stage itself and
// the tone is only the fallback — colour never carries the distinction alone.
const exceptionIcons: Record<string, IconType> = {
  ON_HOLD: FiPauseCircle,
  RETURNED: FiCornerUpLeft,
  CANCELLED: FiXCircle,
  UNRESOLVED: FiHelpCircle
};

const toneIcons = { warning: FiAlertTriangle, serious: FiAlertTriangle, critical: FiXCircle } as const;

// Matches the h-44 plot box below; the trend tooltip is placed against it.
const PLOT_HEIGHT = 176;

function stageFill(stage: StageCount) {
  if (stage.tone === "stage") return stageRamp[Math.min(stage.step, stageRamp.length - 1)];
  return exceptionFills[stage.tone];
}

function share(count: number, total: number) {
  if (!total || !count) return "0%";
  const value = (count / total) * 100;
  // Whole percentages keep the column aligned; anything that would round to zero
  // says so rather than claiming none.
  return value < 0.5 ? "<1%" : `${Math.round(value)}%`;
}

// ── pipeline ──────────────────────────────────────────────────────────────────

/**
 * Ordered lifecycle stages as horizontal bars. Category, count, and share are
 * all permanent labels, so no value here depends on a hover.
 */
export function StagePipelineChart({
  stages,
  unitLabel,
  dimmed = false
}: {
  stages: StageCount[];
  unitLabel: string;
  dimmed?: boolean;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const total = stages.reduce((sum, stage) => sum + stage.count, 0);
  const peak = Math.max(...stages.map((stage) => stage.count), 1);
  const firstException = stages.findIndex((stage) => stage.tone !== "stage");

  return (
    <ul className={`space-y-1 transition-opacity duration-200 ${dimmed ? "opacity-60" : "opacity-100"}`}>
      {stages.map((stage, index) => {
        const Icon = stage.tone === "stage" ? null : exceptionIcons[stage.key] ?? toneIcons[stage.tone];

        return (
          <li
            key={stage.key}
            className={firstException === index ? "mt-2 border-t border-white/10 pt-3" : undefined}
          >
            <div
              tabIndex={0}
              aria-label={`${stage.label}: ${stage.count} ${unitLabel}, ${share(stage.count, total)} of ${total}`}
              onPointerEnter={() => setActiveKey(stage.key)}
              onPointerLeave={() => setActiveKey(null)}
              onFocus={() => setActiveKey(stage.key)}
              onBlur={() => setActiveKey(null)}
              className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 rounded-lg px-1.5 py-2 outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40 sm:grid-cols-[minmax(0,9rem)_1fr_auto]"
            >
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium ">
                {Icon ? <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 " /> : null}
                <span className="truncate">{stage.label}</span>
              </span>

              <span className="h-3 w-full overflow-hidden rounded-r-[4px] bg-white/15">
                <span
                  className="block h-3 rounded-r-[4px] transition-[width,filter] duration-300"
                  style={{
                    width: `${stage.count ? Math.max((stage.count / peak) * 100, 2) : 0}%`,
                    backgroundColor: stageFill(stage),
                    filter: activeKey === stage.key ? "brightness(1.15)" : undefined
                  }}
                />
              </span>

              <span className="flex items-baseline justify-end gap-2">
                <span className="text-sm font-semibold tabular-nums ">{stage.count}</span>
                <span className="w-9 text-right text-[11px] tabular-nums">{share(stage.count, total)}</span>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── trend ─────────────────────────────────────────────────────────────────────

// Rounds the axis to clean whole numbers across roughly five divisions, so the
// ticks carry the values the columns are not directly labelled with.
function axisScale(peak: number) {
  const target = Math.max(peak, 4);
  const rough = target / 5;
  const power = 10 ** Math.floor(Math.log10(rough));
  // The 2.5x step only earns a place where it still lands on a whole number.
  const multipliers = power >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10];
  const step = Math.max(1, multipliers.map((multiple) => multiple * power).find((candidate) => candidate >= rough) ?? 10 * power);
  let top = Math.ceil(target / step) * step;

  // Keep headroom above the tallest column so its direct label and tooltip have
  // somewhere to sit instead of riding out of the plot.
  if (top - target < step / 2) top += step;

  // Zero is labelled but not gridded — the axis rule already draws that line.
  const gridTicks: number[] = [];
  for (let value = top; value > 0; value -= step) gridTicks.push(value);
  return { top, gridTicks, ticks: [...gridTicks, 0] };
}

/**
 * Daily bookings as columns. One series, so there is no legend — the card title
 * names what is plotted — and a table view keeps every value readable without
 * reaching for the tooltip.
 */
export function DailyTrendChart({
  points,
  unitLabel,
  dimmed = false
}: {
  points: TrendPoint[];
  unitLabel: string;
  dimmed?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const peak = Math.max(...points.map((point) => point.count), 0);
  const scale = axisScale(peak);
  const peakIndex = peak > 0 ? points.findIndex((point) => point.count === peak) : -1;
  const activePoint = activeIndex === null ? null : { index: activeIndex, ...points[activeIndex] };

  if (asTable) {
    return (
      <div>
        <TableToggle asTable onToggle={() => setAsTable(false)} />
        <div className="mt-3 max-h-[13.5rem] overflow-y-auto rounded-xl ring-1 ring-white/15">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[#0D1282] text-[11px] uppercase tracking-wide ">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Date</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">{unitLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {points.map((point) => (
                <tr key={point.key}>
                  <td className="px-3 py-2 ">{point.caption}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums ">{point.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className={`transition-opacity duration-200 ${dimmed ? "opacity-60" : "opacity-100"}`}>
      <TableToggle asTable={false} onToggle={() => setAsTable(true)} />

      <div className="mt-3 flex gap-3">
        <div aria-hidden="true" className="relative h-44 w-7 shrink-0">
          {scale.ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 text-[10px] leading-none tabular-nums text-blue-200"
              style={{ top: `${((scale.top - tick) / scale.top) * 100}%` }}
            >
              {tick}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-44">
            {scale.gridTicks.map((tick) => (
              <span
                key={tick}
                className="absolute inset-x-0 h-px bg-white/10"
                style={{ top: `${((scale.top - tick) / scale.top) * 100}%` }}
              />
            ))}
          </div>

          <div className="relative flex h-44 items-end gap-1">
            {points.map((point, index) => (
              <div
                key={point.key}
                tabIndex={0}
                aria-label={`${point.caption}: ${point.count} ${unitLabel}`}
                onPointerEnter={() => setActiveIndex(index)}
                onPointerLeave={() => setActiveIndex(null)}
                onFocus={() => setActiveIndex(index)}
                onBlur={() => setActiveIndex(null)}
                className="relative flex h-full min-w-0 flex-1 items-end justify-center rounded-t-md outline-none focus-visible:ring-2 focus-visible:ring-white/40"
              >
                {index === peakIndex ? (
                  <span
                    className="absolute inset-x-0 text-center text-[10px] font-semibold leading-none tabular-nums text-slate-100"
                    style={{ bottom: `calc(${(point.count / scale.top) * 100}% + 5px)` }}
                  >
                    {point.count}
                  </span>
                ) : null}

                <span
                  className="w-full max-w-6 rounded-t-[4px] transition-[height,filter] duration-300"
                  style={{
                    height: `${point.count ? Math.max((point.count / scale.top) * 100, 1.5) : 0}%`,
                    backgroundColor: "#7498ff",
                    filter: activeIndex === index ? "brightness(1.14)" : undefined
                  }}
                />
              </div>
            ))}
          </div>

          <div aria-hidden="true" className="h-px w-full bg-white/25" />

          <div className="mt-1.5 flex gap-1">
            {points.map((point, index) => (
              <span
                key={point.key}
                className={`min-w-0 flex-1 text-center text-[10px] tabular-nums ${
                  index === points.length - 1 ? "font-semibold text-white" : "text-blue-200"
                }`}
              >
                {point.label}
              </span>
            ))}
          </div>

          {activePoint ? (
            <div
              role="presentation"
              className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full pb-2"
              style={{
                left: `${((activePoint.index + 0.5) / points.length) * 100}%`,
                top: PLOT_HEIGHT * (1 - activePoint.count / scale.top)
              }}
            >
              <div className="min-w-[8.5rem] rounded-xl bg-slate-900 px-3 py-2 shadow-lg shadow-black/40 ring-1 ring-white/10">
                <p className="text-sm font-semibold leading-5 ">{activePoint.count} {unitLabel}</p>
                <p className="mt-0.5 text-[11px] leading-4 ">{activePoint.caption}</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TableToggle({ asTable, onToggle }: { asTable: boolean; onToggle: () => void }) {
  const Icon = asTable ? FiBarChart2 : FiTable;
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-2.5 py-1.5 text-[11px] font-semibold  transition hover:border-[#F0DE36] hover:text-[#F0DE36] focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      >
        <Icon aria-hidden="true" className="h-3 w-3" />
        {asTable ? "Show chart" : "Show table"}
      </button>
    </div>
  );
}
