"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiAlertTriangle,
  FiClock,
  FiMapPin,
  FiPackage,
  FiTool,
} from "react-icons/fi";
import {
  type BookingPause,
  formatPauseWindow,
  listActiveBookingPauses,
  listClientBookingPauses,
} from "@/lib/bookingPause";

type Props = {
  /** If set, only show pauses that block this specific country; otherwise show any active pause. */
  countryCode?: string | null;

  /** Compact variant for inside cards. */
  compact?: boolean;

  /** Role determines which endpoint is used (client uses client endpoint). */
  variant?: "staff" | "client";

  /** Optional pauses override (to avoid duplicate fetch when parent already fetched). */
  pauses?: BookingPause[] | null;

  className?: string;
};

/* -------------------------------------------------------------------------- */
/*                         Maintenance notice visual                          */
/* -------------------------------------------------------------------------- */

function MaintenanceIllustration({
  active,
  compact,
}: {
  active: boolean;
  compact?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={`relative mx-auto w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-[linear-gradient(135deg,#ffffff_0%,#f8f9ff_52%,#f1f3fb_100%)] ${
        compact
          ? "max-w-[290px] px-4 py-4"
          : "max-w-[520px] px-5 py-6 sm:px-8 sm:py-7"
      }`}
    >
      {/* Soft background details */}
      <div
        className={`pointer-events-none absolute -left-12 -top-12 rounded-full ${
          active
            ? "bg-[#D71313]/[0.055]"
            : "bg-amber-500/[0.07]"
        } ${
          compact ? "h-28 w-28" : "h-40 w-40"
        }`}
      />

      <div className="pointer-events-none absolute -bottom-16 -right-12 h-36 w-36 rounded-full bg-[#0D1282]/[0.045]" />

      <div className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[72%] -translate-x-1/2 -translate-y-1/2 bg-[linear-gradient(90deg,transparent,#0D1282/10,transparent)]" />

      {/* Central maintenance artwork */}
      <div
        className={`relative mx-auto flex items-center justify-center rounded-full border border-slate-200/80 bg-white shadow-[0_16px_38px_-24px_rgba(13,18,130,0.42)] ${
          compact
            ? "h-20 w-20"
            : "h-28 w-28 sm:h-32 sm:w-32"
        }`}
      >
        <div
          className={`absolute rounded-full ${
            active
              ? "bg-[#D71313]/[0.06]"
              : "bg-amber-500/[0.08]"
          } ${
            compact
              ? "h-14 w-14"
              : "h-20 w-20 sm:h-24 sm:w-24"
          }`}
        />

        <span
          className={`relative flex items-center justify-center rounded-2xl ${
            active
              ? "bg-[#D71313] text-white"
              : "bg-amber-500 text-white"
          } ${
            compact
              ? "h-10 w-10"
              : "h-14 w-14 sm:h-16 sm:w-16"
          }`}
        >
          <FiTool
            className={
              compact
                ? "h-5 w-5"
                : "h-7 w-7 sm:h-8 sm:w-8"
            }
          />
        </span>

        <span
          className={`absolute -bottom-1 -right-1 flex items-center justify-center rounded-full border-4 border-white bg-[#0D1282] text-white ${
            compact ? "h-8 w-8" : "h-10 w-10"
          }`}
        >
          <FiPackage
            className={
              compact ? "h-3.5 w-3.5" : "h-[18px] w-[18px]"
            }
          />
        </span>
      </div>

      {/* Illustration caption */}
      <div
        className={`relative mt-4 text-center ${
          compact ? "space-y-1" : "space-y-1.5"
        }`}
      >
        <p
          className={`font-semibold tracking-[-0.015em] text-slate-900 ${
            compact
              ? "text-[13px]"
              : "text-sm sm:text-[15px]"
          }`}
        >
          Booking service temporarily unavailable
        </p>

        <p
          className={`mx-auto max-w-md text-slate-500 ${
            compact
              ? "text-[10.5px] leading-4"
              : "text-xs leading-5 sm:text-[13px]"
          }`}
        >
          A temporary operational pause is currently affecting
          shipment bookings.
        </p>
      </div>

      {/* Status point */}
      <span
        className={`absolute left-5 top-5 h-2 w-2 rounded-full ${
          active ? "bg-[#D71313]" : "bg-amber-500"
        }`}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                Pause card                                  */
/* -------------------------------------------------------------------------- */

function PauseCard({
  pause,
  compact,
}: {
  pause: BookingPause;
  compact?: boolean;
}) {
  const active = pause.status === "ACTIVE";

  return (
    <article
      className={`relative overflow-hidden rounded-2xl border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03),0_16px_38px_-30px_rgba(13,18,130,0.32)] ${
        active
          ? "border-[#D71313]/15"
          : "border-amber-200/80"
      }`}
    >
      {/* -------------------------------------------------------------- */}
      {/* Maintenance image / illustration                              */}
      {/* -------------------------------------------------------------- */}

      <div
        className={`border-b border-slate-200/70 bg-[linear-gradient(180deg,#fbfcff_0%,#f7f8fc_100%)] ${
          compact
            ? "px-3 py-3"
            : "px-4 py-5 sm:px-6 sm:py-6"
        }`}
      >
        <MaintenanceIllustration
          active={active}
          compact={compact}
        />
      </div>

      {/* -------------------------------------------------------------- */}
      {/* Notice information                                            */}
      {/* -------------------------------------------------------------- */}

      <div
        className={`relative ${
          compact
            ? "px-3.5 py-3.5"
            : "px-4 py-4 sm:px-6 sm:py-5"
        }`}
      >
        {/* Very subtle decorative corner */}
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute right-0 top-0 rounded-bl-full ${
            active
              ? "bg-[#D71313]/[0.035]"
              : "bg-amber-500/[0.05]"
          } ${
            compact ? "h-20 w-20" : "h-28 w-28"
          }`}
        />

        <div
          className={`relative grid min-w-0 items-start ${
            compact
              ? "grid-cols-[38px_minmax(0,1fr)] gap-3"
              : "grid-cols-[44px_minmax(0,1fr)] gap-3.5 sm:grid-cols-[52px_minmax(0,1fr)] sm:gap-4"
          }`}
        >
          {/* Alert icon */}
          <span
            className={`flex shrink-0 items-center justify-center rounded-xl border ${
              active
                ? "border-[#D71313]/15 bg-[#D71313]/[0.07] text-[#D71313]"
                : "border-amber-200 bg-amber-50 text-amber-700"
            } ${
              compact
                ? "h-9 w-9"
                : "h-11 w-11 sm:h-12 sm:w-12"
            }`}
          >
            <FiAlertTriangle
              aria-hidden="true"
              className={
                compact ? "h-4 w-4" : "h-5 w-5"
              }
            />
          </span>

          {/* Notice text */}
          <div className="min-w-0">
            <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
              <div className="min-w-0">
                <p
                  className={`font-semibold tracking-[-0.012em] ${
                    active
                      ? "text-[#7F1D1D]"
                      : "text-amber-900"
                  } ${
                    compact
                      ? "text-[13px] leading-5"
                      : "text-sm leading-5 sm:text-[15px]"
                  }`}
                >
                  {pause.countries.includes("ALL")
                    ? "Bookings paused for all destinations"
                    : `Bookings paused for ${pause.countryLabels.join(
                        ", ",
                      )}`}
                </p>

                <p
                  className={`mt-1.5 ${
                    active
                      ? "text-[#991B1B]/80"
                      : "text-amber-800/80"
                  } ${
                    compact
                      ? "text-xs leading-5"
                      : "text-[13px] leading-5 sm:text-sm"
                  }`}
                >
                  {pause.reason}
                </p>
              </div>

              {/* Status */}
              <span
                className={`mt-1 inline-flex w-fit shrink-0 items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] sm:mt-0 ${
                  active
                    ? "border-[#D71313]/15 bg-[#FFF5F5] text-[#B3121A]"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                {active ? "Active pause" : "Scheduled"}
              </span>
            </div>

            {/* Meta */}
            <div
              className={`mt-3 flex min-w-0 flex-col gap-2 ${
                compact
                  ? ""
                  : "sm:flex-row sm:flex-wrap sm:items-center"
              }`}
            >
              <span
                className={`inline-flex w-fit max-w-full items-center gap-1.5 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-medium ${
                  active
                    ? "border-[#D71313]/15 text-[#991B1B]"
                    : "border-amber-200 text-amber-800"
                }`}
              >
                <FiClock
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0"
                />

                <span className="min-w-0 truncate">
                  {formatPauseWindow(pause)}
                </span>
              </span>

              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-slate-600">
                <FiMapPin
                  aria-hidden="true"
                  className="h-3.5 w-3.5 shrink-0 text-slate-400"
                />

                <span className="min-w-0 truncate">
                  {pause.countryLabels.join(" · ")}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Existing logic                                */
/* -------------------------------------------------------------------------- */

export default function BookingPausedNotice({
  countryCode,
  compact,
  variant = "staff",
  pauses: controlledPauses,
  className,
}: Props) {
  const [pauses, setPauses] = useState<BookingPause[]>(
    controlledPauses ?? [],
  );

  const [loaded, setLoaded] = useState(false);

  const fetchPauses = useCallback(async () => {
    try {
      const data =
        variant === "client"
          ? await listClientBookingPauses()
          : await listActiveBookingPauses();

      setPauses(data.pauses);
    } catch {
      // advisory surface is non-blocking
    } finally {
      setLoaded(true);
    }
  }, [variant]);

  useEffect(() => {
    if (
      controlledPauses !== undefined &&
      controlledPauses !== null
    ) {
      setPauses(controlledPauses);
      setLoaded(true);
      return;
    }

    void fetchPauses();

    const id = window.setInterval(
      () => void fetchPauses(),
      60_000,
    );

    return () => window.clearInterval(id);
  }, [controlledPauses, fetchPauses]);

  const visible = useMemo(() => {
    // controlled pauses may include non-active; filter to ACTIVE only for notice
    const active = pauses.filter(
      (p) => p.status === "ACTIVE",
    );

    if (!countryCode) return active;

    const code =
      countryCode.trim().toUpperCase() === "UK"
        ? "GB"
        : countryCode.trim().toUpperCase();

    const EUROPE = new Set([
      "AL",
      "AD",
      "AT",
      "BY",
      "BE",
      "BA",
      "BG",
      "HR",
      "CY",
      "CZ",
      "DK",
      "EE",
      "FI",
      "FR",
      "DE",
      "GR",
      "HU",
      "IS",
      "IE",
      "IT",
      "XK",
      "LV",
      "LI",
      "LT",
      "LU",
      "MT",
      "MD",
      "MC",
      "ME",
      "NL",
      "MK",
      "NO",
      "PL",
      "PT",
      "RO",
      "RU",
      "SM",
      "RS",
      "SK",
      "SI",
      "ES",
      "SE",
      "CH",
      "TR",
      "UA",
      "GB",
      "VA",
    ]);

    return active.filter((p) => {
      if (p.countries.includes("ALL")) return true;

      if (p.countries.includes(code as never)) {
        return true;
      }

      if (
        p.countries.includes("EUROPE" as never) &&
        EUROPE.has(code)
      ) {
        return true;
      }

      return false;
    });
  }, [pauses, countryCode]);

  if (!loaded || visible.length === 0) return null;

  return (
    <div className={className}>
      <div className="space-y-3">
        {visible.map((pause) => (
          <PauseCard
            key={pause.id}
            pause={pause}
            compact={compact}
          />
        ))}
      </div>
    </div>
  );
}

export function BookingPausedBanner(
  props: Omit<Props, "compact">,
) {
  return (
    <BookingPausedNotice
      {...props}
      compact={false}
    />
  );
}