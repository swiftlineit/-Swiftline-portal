"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  FiAlertTriangle,
  FiUpload,
  FiTrash2,
  FiDownload,
  FiPlus,
  FiRefreshCw,
} from "react-icons/fi";
import { toast } from "react-toastify";
import { DashboardLoading } from "@/components/DashboardShell";
import { OPERATIONS_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";
import {
  getFlightDetail,
  transitionFlight,
  cancelFlight,
  searchEligibleShipments,
  allocateShipments,
  removeAllocation,
  moveAllocation,
  listAttachableManifests,
  attachManifest,
  detachManifest,
  updateConnection,
  createOffload,
  updateHandover,
  uploadFlightDocument,
  deleteFlightDocument,
  acknowledgeException,
  updateException,
  resolveException,
  type FlightDetail,
  type FlightStatus,
} from "@/lib/flightLinehaul";
import { listFlights } from "@/lib/flightLinehaul";

const tabs = [
  "Overview",
  "Shipments",
  "Bags",
  "Manifest",
  "Timeline",
  "Connection",
  "Documents",
  "Destination handover",
  "Exceptions",
  "Audit history",
] as const;
type Tab = (typeof tabs)[number];

const statusFlow: FlightStatus[] = [
  "PLANNED",
  "BOOKING_CONFIRMED",
  "CARGO_ALLOCATED",
  "MANIFEST_READY",
  "HANDED_TO_AIRLINE",
  "DEPARTED",
  "IN_TRANSIT",
  "CONNECTION",
  "ARRIVED_DESTINATION",
  "CUSTOMS",
  "HANDED_TO_FINAL_MILE",
  "CLOSED",
];
const allowedNext: Record<string, FlightStatus[]> = {
  PLANNED: ["BOOKING_CONFIRMED", "CANCELLED"],
  BOOKING_CONFIRMED: ["CARGO_ALLOCATED", "CANCELLED"],
  CARGO_ALLOCATED: ["MANIFEST_READY", "CANCELLED"],
  MANIFEST_READY: ["HANDED_TO_AIRLINE", "CANCELLED"],
  HANDED_TO_AIRLINE: ["DEPARTED", "CANCELLED"],
  DEPARTED: ["IN_TRANSIT"],
  IN_TRANSIT: ["CONNECTION", "ARRIVED_DESTINATION"],
  CONNECTION: ["ARRIVED_DESTINATION"],
  ARRIVED_DESTINATION: ["CUSTOMS"],
  CUSTOMS: ["HANDED_TO_FINAL_MILE"],
  HANDED_TO_FINAL_MILE: ["CLOSED"],
};

function statusBadge(status: string) {
  const base =
    "inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold";
  if (status === "CANCELLED")
    return `${base} bg-red-50 text-red-700 border-red-200`;
  if (status === "CLOSED")
    return `${base} bg-emerald-50 text-emerald-700 border-emerald-200`;
  if (["DEPARTED", "IN_TRANSIT", "CONNECTION"].includes(status))
    return `${base} bg-sky-50 text-sky-700 border-sky-200`;
  if (["ARRIVED_DESTINATION", "CUSTOMS"].includes(status))
    return `${base} bg-amber-50 text-amber-700 border-amber-200`;
  return `${base} bg-slate-50 text-slate-700 border-slate-200`;
}

export default function FlightDetailPage() {
  const { user, loading } = useAdminUser(OPERATIONS_AREA);
  const params = useParams<{ flightId: string }>();
  const flightId = params.flightId;
  const [detail, setDetail] = useState<FlightDetail | null>(null);
  const [busy, setBusy] = useState(true);
  const [tab, setTab] = useState<Tab>("Overview");
  const [transitionTo, setTransitionTo] = useState<FlightStatus | "">("");
  const [actionReason, setActionReason] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await getFlightDetail(flightId);
      setDetail(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load flight.");
    } finally {
      setBusy(false);
    }
  }, [flightId]);

  useEffect(() => {
    // This effect synchronizes an async API request with page state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (user) void load();
  }, [load, user]);

  if (loading || !user) return <DashboardLoading />;
  if (busy && !detail) return <DashboardLoading />;
  if (!detail)
    return (
      <div className="p-8 text-center text-slate-500">Flight not found.</div>
    );

  const flight = detail.flight;
  const nextOptions = allowedNext[flight.status] ?? [];

  async function doTransition() {
    if (!transitionTo) return toast.error("Select a target status.");
    try {
      const meta: Record<string, unknown> = {};
      if (transitionTo === "DEPARTED")
        meta.actualDepartureAt = new Date().toISOString();
      if (transitionTo === "ARRIVED_DESTINATION")
        meta.arrivalAt = new Date().toISOString();
      await transitionFlight(
        flightId,
        transitionTo as FlightStatus,
        actionReason,
        meta,
      );
      toast.success(`Flight moved to ${transitionTo}.`);
      setTransitionTo("");
      setActionReason("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Transition failed.");
    }
  }

  async function doCancel() {
    const reason = prompt("Enter cancellation reason (min 5 chars):");
    if (!reason || reason.trim().length < 5)
      return toast.error("Cancellation requires reason.");
    try {
      await cancelFlight(flightId, reason.trim());
      toast.success("Flight cancelled.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cancel failed.");
    }
  }

  return (
    <div className="mx-auto max-w-8xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* <Link
            href="/dashboard/flight-linehauls"
            className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          >
            <FiArrowLeft />
          </Link> */}
          <div>
            <h1 className="text-xl font-semibold text-[#0D1282]">
              {flight.flightLinehaulNumber} · {flight.flightNumber}{" "}
              <span className="ml-2 text-sm font-normal text-slate-500">
                {flight.airlineName}
              </span>
            </h1>
            <p className="text-sm text-slate-500">
              {flight.originIataCode} → {flight.destinationIataCode}{" "}
              {flight.transitIataCode ? `via ${flight.transitIataCode}` : ""} ·
              MAWB {flight.mawbNumber || "pending"} ·{" "}
              {flight.branch?.name ?? ""} ({flight.branch?.code ?? ""})
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={statusBadge(flight.status)}>
            {flight.status.replaceAll("_", " ")}
          </span>
          <button
            onClick={() => void load()}
            className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          >
            <FiRefreshCw className={busy ? "animate-spin" : ""} />
          </button>
          {flight.status !== "CLOSED" && flight.status !== "CANCELLED" ? (
            <button
              onClick={doCancel}
              className="h-10 rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-50"
            >
              Cancel flight
            </button>
          ) : null}
        </div>
      </div>

      {/* Header stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 rounded-2xl border border-[#EEEDED] bg-white p-4 shadow-sm">
        <Stat
          label="Capacity"
          value={`${flight.allocatedWeightKg.toFixed(1)} / ${flight.capacityKg.toFixed(1)} kg`}
          sub={`${detail.stats.utilisationPercent.toFixed(1)}% utilised`}
          alert={flight.allocatedWeightKg > flight.capacityKg}
        />
        <Stat
          label="Shipments"
          value={String(detail.stats.totalShipments)}
          sub={`${flight.totalShipments} allocated`}
        />
        <Stat
          label="Pieces"
          value={String(detail.stats.totalPieces)}
          sub={`${detail.stats.totalPieces} pcs`}
        />
        <Stat
          label="Bags"
          value={String(detail.stats.totalBags)}
          sub={`${detail.stats.manifestCount} manifests`}
        />
        <Stat
          label="Schedule"
          value={new Date(flight.scheduledDepartureAt).toLocaleDateString(
            "en-IN",
          )}
          sub={new Date(flight.scheduledDepartureAt).toLocaleTimeString(
            "en-IN",
            { timeZone: "Asia/Kolkata" },
          )}
        />
        <Stat
          label="Customs"
          value={flight.customsStatus}
          sub={
            flight.customsClearedAt
              ? new Date(flight.customsClearedAt).toLocaleDateString("en-IN")
              : "Pending"
          }
        />
      </div>

      {/* Status transition */}
      {nextOptions.length ? (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[#EEEDED] bg-white p-4 shadow-sm">
          <label className="text-xs font-semibold text-slate-600">
            Transition to
            <select
              value={transitionTo}
              onChange={(e) => setTransitionTo(e.target.value as FlightStatus)}
              className="mt-1 flex h-10 min-w-48 rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="">Select status</option>
              {nextOptions.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 text-xs font-semibold text-slate-600">
            Reason / note
            <input
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              placeholder="Reason for change"
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#0D1282]"
            />
          </label>
          <button
            onClick={() => void doTransition()}
            className="h-10 rounded-xl bg-[#0D1282] px-5 text-sm font-semibold text-white hover:bg-[#0D1282]/90"
          >
            Move
          </button>
        </div>
      ) : null}

      {/* Tabs */}
      <div className="overflow-hidden rounded-2xl border border-[#EEEDED] bg-white shadow-sm">
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 p-2">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold ${tab === t ? "bg-white text-[#0D1282] shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white hover:text-slate-900"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="p-5">
          {tab === "Overview" && (
            <OverviewTab detail={detail} />
          )}
          {tab === "Shipments" && (
            <ShipmentsTab
              detail={detail}
              flightId={flightId}
              onRefresh={load}
            />
          )}
          {tab === "Bags" && <BagsTab detail={detail} />}
          {tab === "Manifest" && (
            <ManifestTab detail={detail} flightId={flightId} onRefresh={load} />
          )}
          {tab === "Timeline" && <TimelineTab detail={detail} />}
          {tab === "Connection" && (
            <ConnectionTab
              detail={detail}
              flightId={flightId}
              onRefresh={load}
            />
          )}
          {tab === "Documents" && (
            <DocumentsTab
              detail={detail}
              flightId={flightId}
              onRefresh={load}
            />
          )}
          {tab === "Destination handover" && (
            <HandoverTab detail={detail} flightId={flightId} onRefresh={load} />
          )}
          {tab === "Exceptions" && (
            <ExceptionsTab
              detail={detail}
              onRefresh={load}
            />
          )}
          {tab === "Audit history" && <AuditTab detail={detail} />}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  alert,
}: {
  label: string;
  value: string;
  sub: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${alert ? "border-red-200 bg-red-50/50" : "border-slate-100 bg-slate-50"}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        className={`mt-1 text-sm font-bold ${alert ? "text-red-700" : "text-slate-900"}`}
      >
        {value}
      </p>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
  );
}

// ── Overview ───────────────────────────────────────────────────────────────
function OverviewTab({
  detail,
}: {
  detail: FlightDetail;
}) {
  const flight = detail.flight;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="font-semibold text-slate-900">Flight details</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Flight</dt>
              <dd className="font-semibold">{flight.flightNumber}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">MAWB</dt>
              <dd className="font-semibold">{flight.mawbNumber || "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Branch</dt>
              <dd>
                {flight.branch?.name} ({flight.branch?.code})
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Airline</dt>
              <dd>{flight.airlineName || "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Departure</dt>
              <dd>
                {new Date(flight.scheduledDepartureAt).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Arrival</dt>
              <dd>
                {new Date(flight.scheduledArrivalAt).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })}
              </dd>
            </div>
            {flight.actualDepartureAt ? (
              <div className="flex justify-between">
                <dt className="text-slate-500">Actual dep.</dt>
                <dd className="font-semibold text-amber-700">
                  {new Date(flight.actualDepartureAt).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                  })}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="font-semibold text-slate-900">Capacity</h3>
          <div className="mt-3">
            <div className="flex justify-between text-sm">
              <span>Utilisation</span>
              <span
                className={`font-bold ${detail.stats.utilisationPercent > 100 ? "text-red-600" : detail.stats.utilisationPercent > 90 ? "text-amber-600" : "text-[#0D1282]"}`}
              >
                {detail.stats.utilisationPercent.toFixed(1)}%
              </span>
            </div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full ${detail.stats.utilisationPercent > 100 ? "bg-red-600" : detail.stats.utilisationPercent > 90 ? "bg-amber-500" : "bg-[#0D1282]"}`}
                style={{
                  width: `${Math.min(detail.stats.utilisationPercent, 100)}%`,
                }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {flight.allocatedWeightKg.toFixed(1)} kg of{" "}
              {flight.capacityKg.toFixed(1)} kg used ·{" "}
              {detail.stats.totalShipments} shipments ·{" "}
              {detail.stats.totalPieces} pieces · {detail.stats.totalBags} bags
              · {detail.stats.manifestCount} manifests
            </p>
            {flight.allocatedWeightKg > flight.capacityKg ? (
              <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-700">
                Over capacity — remove or offload shipments before departure.
              </p>
            ) : null}
            {detail.stats.utilisationPercent >= 90 &&
            detail.stats.utilisationPercent <= 100 ? (
              <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs font-semibold text-amber-700">
                Capacity warning — utilisation ≥90%.
              </p>
            ) : null}
          </div>
          <h3 className="mt-6 font-semibold text-slate-900">Connection</h3>
          {flight.connection?.transitAirportCode ? (
            <div className="mt-2 rounded-lg bg-slate-50 p-3 text-sm">
              <p className="font-semibold">
                {flight.connection.transitAirportCode} · layover{" "}
                {flight.connection.layoverMinutes ?? "—"} min ·{" "}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${["HIGH", "CRITICAL", "MISSED"].includes(flight.connection.riskLevel) ? "bg-red-100 text-red-700" : flight.connection.riskLevel === "MEDIUM" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}
                >
                  {flight.connection.riskLevel}
                </span>
              </p>
              <p className="text-xs text-slate-500">
                Sched{" "}
                {flight.connection.scheduledArrivalAt
                  ? new Date(
                      flight.connection.scheduledArrivalAt,
                    ).toLocaleString("en-IN")
                  : "—"}{" "}
                →{" "}
                {flight.connection.scheduledDepartureAt
                  ? new Date(
                      flight.connection.scheduledDepartureAt,
                    ).toLocaleString("en-IN")
                  : "—"}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-500">
              No transit connection configured (direct flight).
            </p>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 p-4">
          <h3 className="font-semibold text-slate-900">
            Destination & handover
          </h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Agent</dt>
              <dd className="max-w-40 truncate font-medium">
                {flight.destinationAgent || "—"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Final-mile</dt>
              <dd>{flight.finalMileCarrier || "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Customs</dt>
              <dd>
                <span className={statusBadge(flight.customsStatus)}>
                  {flight.customsStatus}
                </span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Arrival</dt>
              <dd>
                {flight.arrivalAt
                  ? new Date(flight.arrivalAt).toLocaleString("en-IN")
                  : "—"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Handover</dt>
              <dd>
                {flight.handoverAt
                  ? new Date(flight.handoverAt).toLocaleString("en-IN")
                  : "—"}
              </dd>
            </div>
            {flight.handoverReference ? (
              <div className="flex justify-between">
                <dt className="text-slate-500">Ref</dt>
                <dd className="font-mono text-xs">
                  {flight.handoverReference}
                </dd>
              </div>
            ) : null}
          </dl>
          {detail.exceptions.filter((e) =>
            ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"].includes(e.status),
          ).length ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
                <FiAlertTriangle />{" "}
                {
                  detail.exceptions.filter((e) =>
                    ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"].includes(e.status),
                  ).length
                }{" "}
                action-required exception(s)
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Shipments ──────────────────────────────────────────────────────────────
function ShipmentsTab({
  detail,
  flightId,
  onRefresh,
}: {
  detail: FlightDetail;
  flightId: string;
  onRefresh: () => void;
}) {
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [options, setOptions] = useState<
    Array<{
      shipmentDraftId: string;
      awb: string;
      weightKg: number;
      pieces: number;
      destinationCountryName: string;
      destinationCountryCode: string;
    }>
  >([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function search() {
    setSearching(true);
    try {
      const res = await searchEligibleShipments({
        q: q.trim() || undefined,
        limit: 20,
      });
      setOptions(res.shipments as never);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function allocate() {
    if (!selected.size) return toast.error("Select shipments to allocate.");
    try {
      const res = await allocateShipments(flightId, [...selected]);
      toast.success(res.message);
      if (res.results.some((r) => r.status === "skipped")) {
        const skipped = res.results
          .filter((r) => r.status === "skipped")
          .map((r) => `${r.shipmentDraftId.slice(-6)}: ${r.reason}`)
          .join("; ");
        toast.warn(`Some skipped: ${skipped}`);
      }
      setSelected(new Set());
      setOptions([]);
      setQ("");
      await onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Allocation failed.");
    }
  }

  const [moveFor, setMoveFor] = useState<string | null>(null);
  const [targetFlight, setTargetFlight] = useState("");
  const [flightOptions, setFlightOptions] = useState<
    Array<{ id: string; flightLinehaulNumber: string }>
  >([]);

  async function loadFlightsForMove() {
    try {
      const res = await listFlights({ limit: 20, status: "" });
      setFlightOptions(
        res.items
          .map((f) => ({
            id: f.id,
            flightLinehaulNumber: f.flightLinehaulNumber,
          }))
          .filter((f) => f.id !== flightId),
      );
    } catch {}
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 p-4">
        <label className="flex-1 text-xs font-semibold text-slate-600">
          Search eligible booked shipments (not yet allocated, not
          cancelled/on-hold)
          <div className="mt-1 flex">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void search()}
              placeholder="AWB or tracking"
              className="h-10 flex-1 rounded-l-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#0D1282]"
            />
            <button
              onClick={() => void search()}
              disabled={searching}
              className="h-10 rounded-r-xl bg-[#0D1282] px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {searching ? "…" : "Search"}
            </button>
          </div>
        </label>
        <button
          onClick={() => void allocate()}
          className="h-10 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
        >
          Allocate selected ({selected.size})
        </button>
      </div>

      {options.length ? (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={
                      selected.size === options.length && options.length > 0
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? new Set(options.map((o) => o.shipmentDraftId))
                          : new Set(),
                      )
                    }
                  />
                </th>
                <th className="px-3 py-2">AWB</th>
                <th className="px-3 py-2">Destination</th>
                <th className="px-3 py-2 text-right">Weight</th>
                <th className="px-3 py-2 text-center">Pcs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {options.map((o) => (
                <tr key={o.shipmentDraftId} className="hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(o.shipmentDraftId)}
                      onChange={(e) => {
                        const s = new Set(selected);
                        if (e.target.checked) s.add(o.shipmentDraftId);
                        else s.delete(o.shipmentDraftId);
                        setSelected(s);
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs font-semibold">
                    {o.awb}
                  </td>
                  <td className="px-3 py-2">
                    {o.destinationCountryName} ({o.destinationCountryCode})
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {o.weightKg.toFixed(3)} kg
                  </td>
                  <td className="px-3 py-2 text-center">{o.pieces}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
          <h3 className="font-semibold text-slate-900">
            Allocated shipments —{" "}
            {detail.allocations.filter((a) => a.status === "ALLOCATED").length}{" "}
            active ·{" "}
            {detail.allocations.filter((a) => a.status !== "ALLOCATED").length}{" "}
            historical
          </h3>
          <button
            onClick={() => void onRefresh()}
            className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          >
            <FiRefreshCw />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-sm">
            <thead className="bg-white text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3">AWB</th>
                <th className="px-4 py-3">Destination</th>
                <th className="px-4 py-3 text-right">Weight</th>
                <th className="px-4 py-3 text-center">Pcs</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {detail.allocations.map((a) => (
                <tr
                  key={a.id}
                  className={
                    a.status !== "ALLOCATED"
                      ? "bg-slate-50/60 text-slate-500"
                      : "hover:bg-slate-50"
                  }
                >
                  <td className="px-4 py-3 font-mono text-xs font-semibold">
                    <Link
                      href={`/dashboard/shipments/${a.shipmentDraftId}`}
                      className="text-[#0D1282] hover:underline"
                    >
                      {a.awb || a.shipmentDraftId.slice(-8)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {a.destinationCountryName ||
                      a.destinationCountryCode ||
                      "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {a.weightKg.toFixed(3)} kg
                  </td>
                  <td className="px-4 py-3 text-center">{a.pieces}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${a.status === "ALLOCATED" ? "bg-emerald-50 text-emerald-700" : a.status === "OFFLOADED" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {a.status === "ALLOCATED" ? (
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={async () => {
                            const reason = prompt("Removal reason:");
                            if (!reason || reason.trim().length < 3)
                              return toast.error("Reason required.");
                            try {
                              await removeAllocation(
                                flightId,
                                a.id,
                                reason.trim(),
                              );
                              toast.success("Removed.");
                              await onRefresh();
                            } catch (e) {
                              toast.error(
                                e instanceof Error ? e.message : "Failed.",
                              );
                            }
                          }}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Remove
                        </button>
                        <button
                          onClick={() => {
                            setMoveFor(a.id);
                            void loadFlightsForMove();
                          }}
                          className="rounded-lg border border-[#0D1282]/20 px-2 py-1 text-xs font-semibold text-[#0D1282] hover:bg-[#0D1282]/5"
                        >
                          Move
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!detail.allocations.length ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    No shipments allocated yet. Search above to allocate.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {moveFor ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="font-semibold text-slate-900">
              Move shipment to another flight
            </h3>
            <label className="mt-3 block text-xs font-semibold text-slate-600">
              Target flight
              <select
                value={targetFlight}
                onChange={(e) => setTargetFlight(e.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="">Select flight</option>
                {flightOptions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.flightLinehaulNumber}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setMoveFor(null);
                  setTargetFlight("");
                }}
                className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!targetFlight)
                    return toast.error("Select target flight.");
                  const reason = prompt("Reason for move:");
                  if (!reason || reason.trim().length < 3)
                    return toast.error("Reason required.");
                  try {
                    await moveAllocation(
                      flightId,
                      moveFor,
                      targetFlight,
                      reason.trim(),
                    );
                    toast.success("Moved.");
                    setMoveFor(null);
                    setTargetFlight("");
                    await onRefresh();
                  } catch (e) {
                    toast.error(
                      e instanceof Error ? e.message : "Move failed.",
                    );
                  }
                }}
                className="h-10 rounded-xl bg-[#0D1282] px-4 text-sm font-semibold text-white"
              >
                Move
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BagsTab({ detail }: { detail: FlightDetail }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">
          Bags across attached manifests — {detail.bags.length} bags
        </h3>
        <span className="text-xs text-slate-500">
          Bag IDs preserved from manifest packing. No second scanning system.
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">Bag number</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Parcels</th>
              <th className="px-4 py-3 text-right">Weight</th>
              <th className="px-4 py-3 text-center">Consignments</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {detail.bags.map((b) => (
              <tr key={b.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs font-semibold">
                  {b.bagNumber}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${b.status === "CLOSED" ? "bg-emerald-50 text-emerald-700" : b.status === "OPEN" ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-600"}`}
                  >
                    {b.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {b.totalPhysicalParcels}
                </td>
                <td className="px-4 py-3 text-right">
                  {b.totalWeightKg.toFixed(3)} kg
                </td>
                <td className="px-4 py-3 text-center">{b.totalConsignments}</td>
              </tr>
            ))}
            {!detail.bags.length ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-slate-500"
                >
                  No bags yet. Attach a manifest and pack via Operations
                  Manifests.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ManifestTab({
  detail,
  flightId,
  onRefresh,
}: {
  detail: FlightDetail;
  flightId: string;
  onRefresh: () => void;
}) {
  const [options, setOptions] = useState<
    Array<{
      id: string;
      manifestNumber: string;
      status: string;
      totalWeightKg: number;
    }>
  >([]);
  const [selected, setSelected] = useState("");
  useEffect(() => {
    listAttachableManifests(flightId)
      .then((r) => setOptions(r.manifests as never))
      .catch(() => {});
  }, [flightId]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 p-4">
        <label className="flex-1 text-xs font-semibold text-slate-600">
          Attach operations manifest (must be same branch)
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="">Select manifest</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.manifestNumber} · {o.status} · {o.totalWeightKg.toFixed(1)}{" "}
                kg
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={async () => {
            if (!selected) return toast.error("Select a manifest.");
            try {
              await attachManifest(flightId, selected);
              toast.success("Manifest attached.");
              setSelected("");
              await onRefresh();
              const r = await listAttachableManifests(flightId);
              setOptions(r.manifests as never);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Attach failed.");
            }
          }}
          className="h-10 rounded-xl bg-[#0D1282] px-4 text-sm font-semibold text-white"
        >
          Attach
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-4 py-3">Manifest</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Bags</th>
              <th className="px-4 py-3 text-right">Weight</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {detail.manifests.map((m) => (
              <tr key={m.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/operations-manifests/${m.id}`}
                    className="font-semibold text-[#0D1282] hover:underline"
                  >
                    {m.manifestNumber}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {m.header.originIataCode}→{m.header.destinationIataCode} ·{" "}
                    {m.header.flightNumber}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold">
                    {m.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">{m.totalBags}</td>
                <td className="px-4 py-3 text-right">
                  {m.totalWeightKg.toFixed(3)} kg
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={async () => {
                      const reason =
                        prompt(
                          "Detach reason (required if manifest sealed):",
                        ) ?? "";
                      if (
                        ["SEALED", "DISPATCHED"].includes(m.status) &&
                        reason.trim().length < 5
                      )
                        return toast.error(
                          "Reason required for sealed manifest.",
                        );
                      try {
                        await detachManifest(flightId, m.id, reason);
                        toast.success("Detached.");
                        await onRefresh();
                      } catch (e) {
                        toast.error(
                          e instanceof Error ? e.message : "Detach failed.",
                        );
                      }
                    }}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                  >
                    Detach
                  </button>
                </td>
              </tr>
            ))}
            {!detail.manifests.length ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-slate-500"
                >
                  No manifests attached. Create a manifest in Operations
                  Manifests, pack via scanning, then attach here.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h4 className="font-semibold text-slate-900">
          Flight-level visibility
        </h4>
        <p className="mt-1 text-sm text-slate-600">
          All bags and consignments from attached manifests are visible in Bags
          tab. Sealed snapshot, bag closing, seal and dispatch rules are reused
          from the existing manifest service — this flight does not re-implement
          scanning.
        </p>
        <div className="mt-2 overflow-hidden rounded-lg border border-white bg-white">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2">Consignment</th>
                <th className="px-3 py-2">Bags</th>
                <th className="px-3 py-2 text-right">Weight</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {detail.consignments.slice(0, 20).map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 font-mono">
                    {c.displayConsignmentNumber}
                  </td>
                  <td className="px-3 py-2">
                    {(c.bagNumbers ?? []).join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {c.weightKg.toFixed(3)} kg
                  </td>
                  <td className="px-3 py-2">{c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TimelineTab({ detail }: { detail: FlightDetail }) {
  const flight = detail.flight;
  const idx = statusFlow.indexOf(flight.status as FlightStatus);
  return (
    <div className="space-y-4">
      <div className="relative pl-6">
        <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-slate-200" />
        {statusFlow.map((s, i) => {
          const done = i < idx;
          const current = i === idx;
          const future = i > idx;
          return (
            <div key={s} className="relative pb-6">
              <div
                className={`absolute -left-1 h-3 w-3 rounded-full border-2 ${done ? "bg-emerald-500 border-emerald-500" : current ? "bg-[#0D1282] border-[#0D1282] animate-pulse" : "bg-white border-slate-300"}`}
              />
              <p
                className={`ml-4 text-sm ${current ? "font-bold text-[#0D1282]" : done ? "font-semibold text-emerald-700" : future ? "text-slate-400" : "text-slate-600"}`}
              >
                {s.replaceAll("_", " ")}
                {current ? " • current" : done ? " • done" : ""}
              </p>
              {current && flight.scheduledDepartureAt ? (
                <p className="ml-4 text-xs text-slate-500">
                  Scheduled{" "}
                  {new Date(flight.scheduledDepartureAt).toLocaleString(
                    "en-IN",
                  )}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="bg-slate-50 px-4 py-3 font-semibold text-slate-900">
          Recent transitions
        </div>
        <div className="divide-y divide-slate-100">
          {detail.auditHistory.slice(0, 10).map((a) => (
            <div key={a.id} className="px-4 py-3 text-sm">
              <p className="font-semibold text-slate-800">
                {a.action.replaceAll("_", " ")}
              </p>
              <p className="text-xs text-slate-500">
                {new Date(a.performedAt).toLocaleString("en-IN")} ·{" "}
                {JSON.stringify(a.metadata).slice(0, 120)}
              </p>
            </div>
          ))}
          {!detail.auditHistory.length ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              No transitions yet.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ConnectionTab({
  detail,
  flightId,
  onRefresh,
}: {
  detail: FlightDetail;
  flightId: string;
  onRefresh: () => void;
}) {
  const c = detail.flight.connection;
  const [form, setForm] = useState({
    transitAirportCode: c?.transitAirportCode ?? "",
    scheduledArrivalAt: c?.scheduledArrivalAt
      ? new Date(c.scheduledArrivalAt).toISOString().slice(0, 16)
      : "",
    scheduledDepartureAt: c?.scheduledDepartureAt
      ? new Date(c.scheduledDepartureAt).toISOString().slice(0, 16)
      : "",
    actualArrivalAt: c?.actualArrivalAt
      ? new Date(c.actualArrivalAt).toISOString().slice(0, 16)
      : "",
    actualDepartureAt: c?.actualDepartureAt
      ? new Date(c.actualDepartureAt).toISOString().slice(0, 16)
      : "",
  });
  useEffect(() => {
    if (c) {
      // The form mirrors refreshed connection data returned by the API.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        transitAirportCode: c.transitAirportCode,
        scheduledArrivalAt: c.scheduledArrivalAt
          ? new Date(c.scheduledArrivalAt).toISOString().slice(0, 16)
          : "",
        scheduledDepartureAt: c.scheduledDepartureAt
          ? new Date(c.scheduledDepartureAt).toISOString().slice(0, 16)
          : "",
        actualArrivalAt: c.actualArrivalAt
          ? new Date(c.actualArrivalAt).toISOString().slice(0, 16)
          : "",
        actualDepartureAt: c.actualDepartureAt
          ? new Date(c.actualDepartureAt).toISOString().slice(0, 16)
          : "",
      });
    }
  }, [c]);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
        <h3 className="font-semibold text-amber-900">
          Single transit connection — one airport for now
        </h3>
        <p className="text-sm text-amber-800">
          Layover risk is calculated server-side: &lt;90 min CRITICAL, &lt;120
          HIGH, &lt;180 MEDIUM. Offloads and missed connections automatically
          create HIGH/CRITICAL exceptions.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 rounded-xl border border-slate-200 p-4">
        <label className="text-sm font-semibold text-slate-700">
          Transit airport (IATA)
          <input
            value={form.transitAirportCode}
            onChange={(e) =>
              setForm({ ...form, transitAirportCode: e.target.value })
            }
            maxLength={3}
            placeholder="DXB"
            className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
          />
        </label>
        <div className="text-sm">
          <span className="font-semibold text-slate-700">Current risk</span>
          <p className="mt-1">
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${!c ? "bg-slate-100 text-slate-600" : ["HIGH", "CRITICAL", "MISSED"].includes(c.riskLevel) ? "bg-red-100 text-red-700" : c.riskLevel === "MEDIUM" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}
            >
              {c?.riskLevel ?? "—"}{" "}
              {c?.layoverMinutes != null ? `· ${c.layoverMinutes} min` : ""}
            </span>
          </p>
        </div>
        <label className="text-sm font-semibold text-slate-700">
          Scheduled arrival (transit)
          <input
            type="datetime-local"
            value={form.scheduledArrivalAt}
            onChange={(e) =>
              setForm({ ...form, scheduledArrivalAt: e.target.value })
            }
            className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
          />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Scheduled departure (transit)
          <input
            type="datetime-local"
            value={form.scheduledDepartureAt}
            onChange={(e) =>
              setForm({ ...form, scheduledDepartureAt: e.target.value })
            }
            className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
          />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Actual arrival
          <input
            type="datetime-local"
            value={form.actualArrivalAt}
            onChange={(e) =>
              setForm({ ...form, actualArrivalAt: e.target.value })
            }
            className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
          />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Actual departure
          <input
            type="datetime-local"
            value={form.actualDepartureAt}
            onChange={(e) =>
              setForm({ ...form, actualDepartureAt: e.target.value })
            }
            className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
          />
        </label>
      </div>
      <button
        onClick={async () => {
          if (!form.transitAirportCode.trim())
            return toast.error("Transit airport required.");
          try {
            await updateConnection(flightId, {
              transitAirportCode: form.transitAirportCode.trim().toUpperCase(),
              scheduledArrivalAt: form.scheduledArrivalAt
                ? new Date(form.scheduledArrivalAt).toISOString()
                : null,
              scheduledDepartureAt: form.scheduledDepartureAt
                ? new Date(form.scheduledDepartureAt).toISOString()
                : null,
              actualArrivalAt: form.actualArrivalAt
                ? new Date(form.actualArrivalAt).toISOString()
                : null,
              actualDepartureAt: form.actualDepartureAt
                ? new Date(form.actualDepartureAt).toISOString()
                : null,
            });
            toast.success("Connection updated.");
            await onRefresh();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Update failed.");
          }
        }}
        className="h-11 rounded-xl bg-[#0D1282] px-5 text-sm font-semibold text-white"
      >
        Save connection
      </button>

      <div className="rounded-xl border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-900">Offload records</h3>
        <OffloadSection
          flightId={flightId}
          detail={detail}
          onRefresh={onRefresh}
        />
      </div>
    </div>
  );
}

function OffloadSection({
  flightId,
  detail,
  onRefresh,
}: {
  flightId: string;
  detail: FlightDetail;
  onRefresh: () => void;
}) {
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    offloadReason: "AIRLINE_OFFLOAD",
    reason: "",
    airline: "",
  });
  const [selectedParcels, setSelectedParcels] = useState<Set<string>>(new Set());
  const allocated = detail.allocations.filter((a)=>a.status==="ALLOCATED");
  return (
    <div className="mt-3 space-y-3">
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2">Detail</th>
              <th className="px-3 py-2">Parcels</th>
              <th className="px-3 py-2 text-right">Weight</th>
              <th className="px-3 py-2">At</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {detail.offloads.map((o) => (
              <tr key={o.id}>
                <td className="px-3 py-2 font-semibold">{o.reason}</td>
                <td className="px-3 py-2 max-w-64 truncate">{o.detail}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {(o.affectedParcels ?? []).map((parcel) => parcel.parcelNumber).join(", ") || "Legacy record"}
                </td>
                <td className="px-3 py-2 text-right">
                  {o.affectedWeightKg.toFixed(1)} kg · {o.affectedPieces} pcs
                </td>
                <td className="px-3 py-2 text-xs">
                  {new Date(o.createdAt).toLocaleString("en-IN")}
                </td>
              </tr>
            ))}
            {!detail.offloads.length ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-6 text-center text-slate-500"
                >
                  No offloads. Offloads automatically create HIGH exceptions.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {!show ? (
        <button
          onClick={() => { setShow(true); }}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <FiPlus /> Record offload
        </button>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">
              Offload category
              <select
                value={form.offloadReason}
                onChange={(e) =>
                  setForm({ ...form, offloadReason: e.target.value })
                }
                className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="AIRLINE_OFFLOAD">Airline offload</option>
                <option value="CAPACITY">Capacity</option>
                <option value="WEATHER">Weather</option>
                <option value="CUSTOMS">Customs</option>
                <option value="MISSED_CONNECTION">Missed connection</option>
                <option value="DAMAGE">Damage</option>
                <option value="SECURITY">Security</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Airline
              <input
                value={form.airline}
                onChange={(e) => setForm({ ...form, airline: e.target.value })}
                placeholder="Emirates"
                className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
              />
            </label>
            <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
              Detail *
              <input
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Explain why the selected parcels were offloaded"
                className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
              />
            </label>
            <div className="sm:col-span-2 rounded-xl border border-white bg-white p-3">
              <p className="text-xs font-semibold text-slate-800">
                Select affected parcels {selectedParcels.size ? `(${selectedParcels.size} selected)` : ""}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                Select only the physical parcels removed from this flight. The shipment itself is not rebooked or moved.
              </p>
              <div className="mt-2 max-h-64 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
                {allocated.length ? allocated.map((allocation) => {
                  const activeParcels = allocation.parcelDetails.filter((parcel) => parcel.status === "ALLOCATED");
                  return (
                    <div key={allocation.id} className="px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-950">
                          {allocation.awb || allocation.shipmentDraftId.slice(-8)}
                        </span>
                        <span className="text-xs text-slate-500">
                          {allocation.destinationCountryName || allocation.destinationCountryCode} · {activeParcels.length} active
                        </span>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {activeParcels.map((parcel) => {
                          const selectionKey = `${allocation.shipmentDraftId}|${parcel.parcelNumber}`;
                          return (
                            <label key={parcel.parcelNumber} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 hover:bg-slate-50">
                              <input
                                type="checkbox"
                                className="mt-0.5"
                                checked={selectedParcels.has(selectionKey)}
                                onChange={(event) => {
                                  const next = new Set(selectedParcels);
                                  if (event.target.checked) next.add(selectionKey);
                                  else next.delete(selectionKey);
                                  setSelectedParcels(next);
                                }}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block break-all font-mono text-xs font-semibold text-slate-800">{parcel.parcelNumber}</span>
                                <span className="mt-0.5 block text-xs text-slate-500">
                                  Actual {parcel.actualWeightKg.toFixed(3)} kg · Volumetric {parcel.volumetricWeightKg.toFixed(3)} kg · Chargeable {parcel.chargeableWeightKg.toFixed(3)} kg
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                }) : <p className="px-3 py-4 text-center text-xs text-slate-500">No active parcels are available to offload.</p>}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setShow(false); setSelectedParcels(new Set()); }} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold" disabled={saving}>Cancel</button>
            <button disabled={saving || !selectedParcels.size} onClick={async () => {
              if (form.reason.trim().length < 5) return toast.error("Reason required.");
              if (!selectedParcels.size) return toast.error("Select at least one parcel.");
              if (saving) return;
              setSaving(true);
              try {
                const affectedParcels = [...selectedParcels].map((selection) => {
                  const [shipmentDraftId, parcelNumber] = selection.split("|");
                  return { shipmentDraftId, parcelNumber };
                });
                await createOffload(flightId, { reason: form.reason.trim(), offloadReason: form.offloadReason, airline: form.airline.trim(), affectedParcels });
                toast.success("Offload recorded. Use Shipment Rebook separately if the shipment must travel again.");
                setShow(false); setForm({ offloadReason: "AIRLINE_OFFLOAD", reason: "", airline: "" }); setSelectedParcels(new Set());
                await onRefresh();
              } catch (e) { toast.error(e instanceof Error ? e.message : "Offload failed."); } finally { setSaving(false); }
            }} className="h-10 rounded-xl bg-[#0D1282] px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save offload"}</button>
          </div>
          <p className="text-xs leading-5 text-slate-600">
            If a selected parcel is still scanned into an editable manifest, reopen its bag and remove that parcel scan first. If the shipment must travel again, use Shipment Rebook to create a new shipment.
          </p>
        </div>
      )}
    </div>
  );
}
function DocumentsTab({
  detail,
  flightId,
  onRefresh,
}: {
  detail: FlightDetail;
  flightId: string;
  onRefresh: () => void;
}) {
  const [type, setType] = useState("MAWB");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-900">Upload flight document</h3>
        <p className="text-xs text-slate-500">
          MAWB, booking confirmation, cargo/bag manifest, security, customs,
          handover etc. 10 MB max. Stored via secure storage service.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-semibold text-slate-600">
            Type
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              <option>MAWB</option>
              <option>BOOKING_CONFIRMATION</option>
              <option>CARGO_MANIFEST</option>
              <option>BAG_MANIFEST</option>
              <option>SECURITY</option>
              <option>CUSTOMS</option>
              <option>HANDOVER</option>
              <option>PROOF</option>
              <option>OTHER</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-600">
            Note
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note"
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
            />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            File
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm"
            />
          </label>
        </div>
        <button
          disabled={uploading || !file}
          onClick={async () => {
            if (!file) return toast.error("Select a file.");
            setUploading(true);
            try {
              await uploadFlightDocument(flightId, file, type, note);
              toast.success("Document uploaded.");
              setFile(null);
              setNote("");
              await onRefresh();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Upload failed.");
            } finally {
              setUploading(false);
            }
          }}
          className="mt-3 inline-flex items-center gap-2 h-10 rounded-xl bg-[#0D1282] px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          <FiUpload /> {uploading ? "Uploading…" : "Upload"}
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">File</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Size</th>
              <th className="px-4 py-3">Uploaded</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {detail.documents.map((d) => (
              <tr key={d.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <p className="font-medium">{d.originalName}</p>
                  <p className="text-xs text-slate-500">{d.note || "—"}</p>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold">
                    {d.documentType}
                  </span>
                </td>
                <td className="px-4 py-3">{(d.size / 1024).toFixed(1)} KB</td>
                <td className="px-4 py-3 text-xs">
                  {new Date(d.createdAt).toLocaleString("en-IN")}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={async () => {
                        try {
                          const { apiUrl } = await import("@/lib/api");
                          const { getAccessToken, refreshAccessToken } =
                            await import("@/lib/auth");
                          let token =
                            getAccessToken() ?? (await refreshAccessToken());
                          if (!token) throw new Error("Session expired.");
                          let res = await fetch(
                            apiUrl(
                              `/api/v1/flight-linehauls/${flightId}/documents/${d.id}/download`,
                            ),
                            { headers: { Authorization: `Bearer ${token}` } },
                          );
                          if (res.status === 401) {
                            token = await refreshAccessToken();
                            if (!token) throw new Error("Session expired.");
                            res = await fetch(
                              apiUrl(
                                `/api/v1/flight-linehauls/${flightId}/documents/${d.id}/download`,
                              ),
                              { headers: { Authorization: `Bearer ${token}` } },
                            );
                          }
                          if (!res.ok) throw new Error("Download failed.");
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = d.originalName;
                          a.click();
                          setTimeout(() => URL.revokeObjectURL(url), 30000);
                        } catch (e) {
                          toast.error(
                            e instanceof Error ? e.message : "Download failed.",
                          );
                        }
                      }}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-[#0D1282] hover:bg-slate-50"
                    >
                      <FiDownload />
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm("Delete document?")) return;
                        try {
                          await deleteFlightDocument(flightId, d.id);
                          toast.success("Deleted.");
                          await onRefresh();
                        } catch (e) {
                          toast.error(
                            e instanceof Error ? e.message : "Delete failed.",
                          );
                        }
                      }}
                      className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                    >
                      <FiTrash2 />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!detail.documents.length ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-slate-500"
                >
                  No documents yet. Upload MAWB, booking confirmation, manifests
                  etc.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HandoverTab({
  detail,
  flightId,
  onRefresh,
}: {
  detail: FlightDetail;
  flightId: string;
  onRefresh: () => void;
}) {
  const f = detail.flight;
  const [form, setForm] = useState({
    arrivalAt: f.arrivalAt
      ? new Date(f.arrivalAt).toISOString().slice(0, 16)
      : "",
    customsStatus: f.customsStatus,
    customsClearedAt: f.customsClearedAt
      ? new Date(f.customsClearedAt as string).toISOString().slice(0, 16)
      : "",
    destinationAgent: f.destinationAgent ?? "",
    finalMileCarrier: f.finalMileCarrier ?? "",
    handoverAt: f.handoverAt
      ? new Date(f.handoverAt as string).toISOString().slice(0, 16)
      : "",
    handoverReference: f.handoverReference ?? "",
  });
  useEffect(() => {
    // The form mirrors refreshed handover data returned by the API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      arrivalAt: f.arrivalAt
        ? new Date(f.arrivalAt).toISOString().slice(0, 16)
        : "",
      customsStatus: f.customsStatus,
      customsClearedAt: f.customsClearedAt
        ? new Date(f.customsClearedAt as string).toISOString().slice(0, 16)
        : "",
      destinationAgent: f.destinationAgent ?? "",
      finalMileCarrier: f.finalMileCarrier ?? "",
      handoverAt: f.handoverAt
        ? new Date(f.handoverAt).toISOString().slice(0, 16)
        : "",
      handoverReference: f.handoverReference ?? "",
    });
  }, [f]);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-sm text-amber-900">
        Completion is audited and protected from silent edits. Customs SLA 12h,
        critical at 24h; final-mile SLA 24h, critical at 48h (IST). Handover
        requires customs CLEARED.
      </div>
      <div className="grid gap-3 sm:grid-cols-2 rounded-xl border border-slate-200 p-4">
        <label className="text-sm font-semibold text-slate-700">
          Arrival at (destination)
          <input
            type="datetime-local"
            value={form.arrivalAt}
            onChange={(e) => setForm({ ...form, arrivalAt: e.target.value })}
            className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
          />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Customs status
          <select
            value={form.customsStatus}
            onChange={(e) =>
              setForm({ ...form, customsStatus: e.target.value as never })
            }
            className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="PENDING">PENDING</option>
            <option value="SUBMITTED">SUBMITTED</option>
            <option value="CLEARED">CLEARED</option>
            <option value="HELD">HELD</option>
          </select>
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Customs cleared at
          <input
            type="datetime-local"
            value={form.customsClearedAt}
            onChange={(e) =>
              setForm({ ...form, customsClearedAt: e.target.value })
            }
            className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
          />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Destination agent
          <input
            value={form.destinationAgent}
            onChange={(e) =>
              setForm({ ...form, destinationAgent: e.target.value })
            }
            className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
          />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Final-mile carrier
          <input
            value={form.finalMileCarrier}
            onChange={(e) =>
              setForm({ ...form, finalMileCarrier: e.target.value })
            }
            placeholder="DPD UK / local partner"
            className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
          />
        </label>
        <label className="text-sm font-semibold text-slate-700">
          Handover at
          <input
            type="datetime-local"
            value={form.handoverAt}
            onChange={(e) => setForm({ ...form, handoverAt: e.target.value })}
            className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
          />
        </label>
        <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
          Handover reference
          <input
            value={form.handoverReference}
            onChange={(e) =>
              setForm({ ...form, handoverReference: e.target.value })
            }
            placeholder="AWB handover ref / POD"
            className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
          />
        </label>
      </div>
      <button
        onClick={async () => {
          try {
            await updateHandover(flightId, {
              arrivalAt: form.arrivalAt
                ? new Date(form.arrivalAt).toISOString()
                : null,
              customsStatus: form.customsStatus,
              customsClearedAt: form.customsClearedAt
                ? new Date(form.customsClearedAt).toISOString()
                : null,
              destinationAgent: form.destinationAgent,
              finalMileCarrier: form.finalMileCarrier,
              handoverAt: form.handoverAt
                ? new Date(form.handoverAt).toISOString()
                : null,
              handoverReference: form.handoverReference,
            });
            toast.success("Handover updated.");
            await onRefresh();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Update failed.");
          }
        }}
        className="h-11 rounded-xl bg-[#0D1282] px-5 text-sm font-semibold text-white"
      >
        Save handover
      </button>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
        <p className="font-semibold text-slate-900">
          Bags & shipments handed over
        </p>
        <p className="text-slate-600">
          {detail.stats.totalBags} bags · {detail.stats.totalShipments}{" "}
          shipments · {detail.stats.totalPieces} pieces on this flight.
          Proof/document upload in Documents tab.
        </p>
      </div>
    </div>
  );
}

function ExceptionsTab({
  detail,
  onRefresh,
}: {
  detail: FlightDetail;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState("");
  const items = filter
    ? detail.exceptions.filter((e) => e.status === filter)
    : detail.exceptions;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-700">Filter:</span>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm"
        >
          <option value="">All</option>
          <option value="OPEN">OPEN</option>
          <option value="ACKNOWLEDGED">ACKNOWLEDGED</option>
          <option value="IN_PROGRESS">IN_PROGRESS</option>
          <option value="RESOLVED">RESOLVED</option>
        </select>
        <span className="ml-auto text-xs text-slate-500">
          {items.length} exception(s) · SLA tracked via dueAt
        </span>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Severity</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Due</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50">
                <td className="px-3 py-2 text-xs font-semibold">
                  {e.type.replaceAll("_", " ")}
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium">{e.title}</p>
                  <p className="text-xs text-slate-500 line-clamp-2">
                    {e.description}
                  </p>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-bold ${e.severity === "CRITICAL" ? "bg-red-100 text-red-700" : e.severity === "HIGH" ? "bg-amber-100 text-amber-700" : e.severity === "MEDIUM" ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600"}`}
                  >
                    {e.severity}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold">
                    {e.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">
                  {e.dueAt ? new Date(e.dueAt).toLocaleString("en-IN") : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    {e.status === "OPEN" ? (
                      <button
                        onClick={async () => {
                          try {
                            await acknowledgeException(e.id);
                            toast.success("Acknowledged.");
                            await onRefresh();
                          } catch (err) {
                            toast.error(
                              err instanceof Error ? err.message : "Failed.",
                            );
                          }
                        }}
                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold"
                      >
                        Ack
                      </button>
                    ) : null}
                    <button
                      onClick={async () => {
                        const notes = prompt("Resolution notes (min 5 chars):");
                        if (!notes || notes.trim().length < 5)
                          return toast.error("Notes required.");
                        try {
                          await resolveException(e.id, notes.trim());
                          toast.success("Resolved.");
                          await onRefresh();
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : "Failed.",
                          );
                        }
                      }}
                      className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      Resolve
                    </button>
                    <button
                      onClick={async () => {
                        const status = prompt(
                          "New status: OPEN, ACKNOWLEDGED, IN_PROGRESS, RESOLVED, CLOSED",
                        );
                        if (!status) return;
                        try {
                          await updateException(e.id, {
                            status: status.trim().toUpperCase(),
                          });
                          toast.success("Updated.");
                          await onRefresh();
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : "Failed.",
                          );
                        }
                      }}
                      className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                    >
                      Edit
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-slate-500"
                >
                  No exceptions. System will auto-create for delay, offload,
                  missed/risky connection, arrival without customs, etc.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditTab({ detail }: { detail: FlightDetail }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-4 py-3">Action</th>
            <th className="px-4 py-3">At</th>
            <th className="px-4 py-3">Metadata</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {detail.auditHistory.map((a) => (
            <tr key={a.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-semibold">
                {a.action.replaceAll("_", " ")}
              </td>
              <td className="px-4 py-3 text-xs">
                {new Date(a.performedAt).toLocaleString("en-IN")}
              </td>
              <td className="px-4 py-3 text-xs font-mono max-w-md truncate">
                {JSON.stringify(a.metadata)}
              </td>
            </tr>
          ))}
          {!detail.auditHistory.length ? (
            <tr>
              <td colSpan={3} className="px-4 py-8 text-center text-slate-500">
                No audit history.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
