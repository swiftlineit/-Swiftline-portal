"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FiArrowRight, FiPlus, FiRefreshCw, FiSearch, FiAlertTriangle, FiTruck, FiPackage, FiClock, FiMapPin } from "react-icons/fi";
import { toast } from "react-toastify";
import { DashboardLoading } from "@/components/DashboardShell";
import { OPERATIONS_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";
import { getFlightSummary, listFlights, type FlightListItem, type FlightCardSummary } from "@/lib/flightLinehaul";

const statusOptions = ["", "PLANNED", "BOOKING_CONFIRMED", "CARGO_ALLOCATED", "MANIFEST_READY", "HANDED_TO_AIRLINE", "DEPARTED", "IN_TRANSIT", "CONNECTION", "ARRIVED_DESTINATION", "CUSTOMS", "HANDED_TO_FINAL_MILE", "CLOSED", "CANCELLED"];

function statusColor(status: string) {
  if (status === "DELAYED" || status === "CANCELLED" || status === "OFFLOADED") return "bg-red-50 text-red-700 border-red-200";
  if (["DEPARTED", "IN_TRANSIT", "CONNECTION"].includes(status)) return "bg-sky-50 text-sky-700 border-sky-200";
  if (["ARRIVED_DESTINATION", "CUSTOMS"].includes(status)) return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "CLOSED") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "HANDED_TO_FINAL_MILE") return "bg-violet-50 text-violet-700 border-violet-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

export default function FlightLinehaulDashboardPage() {
  const { user, loading } = useAdminUser(OPERATIONS_AREA);
  const [items, setItems] = useState<FlightListItem[]>([]);
  const [cards, setCards] = useState<FlightCardSummary | null>(null);
  const [busy, setBusy] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [list, summary] = await Promise.all([listFlights({ page, limit: 15, status: status || undefined, search: search || undefined }), getFlightSummary()]);
      setItems(list.items);
      setPages(list.pagination.pages);
      setCards(summary.cards);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load flights.");
    } finally {
      setBusy(false);
    }
  }, [page, status, search]);

  useEffect(() => {
    if (!user) return;
    void load();
  }, [load, user]);

  // polling every 30s for control centre freshness
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => void load(), 30000);
    return () => clearInterval(id);
  }, [load, user]);

  if (loading || !user) return <DashboardLoading />;

  return (
    <div className="mx-auto max-w-8xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-[#EEEDED] bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold text-[#0D1282]">Flight &amp; Linehaul Control Centre</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">Operational control for the complete flight lifecycle — capacity, allocation, departure, transit, arrival, customs, handover and exceptions. Packing remains in Operations Manifests.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50" aria-label="Refresh">
            <FiRefreshCw className={busy ? "animate-spin" : ""} />
          </button>
          <Link href="/dashboard/flight-linehauls/new" className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#0D1282] px-4 text-sm font-semibold text-white hover:bg-[#0D1282]/90">
            <FiPlus /> New Flight
          </Link>
        </div>
      </div>

      {/* Dashboard cards */}
      {cards ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 xl:grid-cols-10">
          <Card label="Tonight's departures" value={cards.tonightDepartures} icon={<FiClock className="text-[#0D1282]" />} accent="border-[#0D1282]/20" />
          <Card label="Awaiting flight" value={cards.awaitingFlight} icon={<FiPackage />} />
          <Card label="Ready for handover" value={cards.readyForHandover} icon={<FiTruck />} />
          <Card label="Departed" value={cards.departed} icon={<FiTruck />} />
          <Card label="In transit" value={cards.inTransit} icon={<FiMapPin />} />
          <Card label="Connection risk" value={cards.connectionRisk} icon={<FiAlertTriangle className="text-amber-600" />} alert={cards.connectionRisk > 0} />
          <Card label="Offloaded" value={cards.offloaded} icon={<FiAlertTriangle className="text-red-600" />} alert={cards.offloaded > 0} />
          <Card label="Delayed" value={cards.delayed} icon={<FiClock className="text-red-600" />} alert={cards.delayed > 0} />
          <Card label="Destination arrived" value={cards.destinationArrived} icon={<FiMapPin className="text-emerald-600" />} />
          <Card label="Action required" value={cards.actionRequiredExceptions} icon={<FiAlertTriangle className="text-red-600" />} alert={cards.actionRequiredExceptions > 0} />
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[#EEEDED] bg-white p-4 shadow-sm">
        <label className="text-xs font-semibold text-slate-600">
          Search
          <div className="mt-1 flex">
            <div className="relative">
              <FiSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { setSearch(searchInput); setPage(1); } }} placeholder="Flight, MAWB, airline" className="h-10 w-64 rounded-l-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-[#0D1282]" />
            </div>
            <button onClick={() => { setSearch(searchInput); setPage(1); }} className="h-10 rounded-r-xl border border-l-0 border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-[#0D1282] hover:bg-slate-100">Search</button>
          </div>
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Status
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="mt-1 flex h-10 w-48 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none focus:border-[#0D1282]">
            <option value="">All statuses</option>
            {statusOptions.filter(Boolean).map((s) => (
              <option key={s} value={s}>{s.replaceAll("_", " ")}</option>
            ))}
          </select>
        </label>
        <button onClick={() => { setSearch(""); setSearchInput(""); setStatus(""); setPage(1); }} className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">Clear</button>
        <div className="ml-auto text-xs text-slate-500">Auto-refreshes every 30s · branch filtered</div>
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-2xl border border-[#EEEDED] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3">Flight</th>
                <th className="px-4 py-3">Route</th>
                <th className="px-4 py-3">Schedule</th>
                <th className="px-4 py-3 text-right">Capacity</th>
                <th className="px-4 py-3 text-center">Util.</th>
                <th className="px-4 py-3 text-center">Shipments</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {busy && !items.length ? (
                <tr><td colSpan={8} className="px-4 py-14 text-center text-slate-500">Loading flights…</td></tr>
              ) : items.length ? items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-4">
                    <Link href={`/dashboard/flight-linehauls/${item.id}`} className="font-semibold text-[#0D1282] hover:underline">{item.flightLinehaulNumber} · {item.flightNumber}</Link>
                    <p className="text-xs text-slate-500">{item.airlineName || "Airline pending"} · {item.mawbNumber || "MAWB pending"} · {item.branch?.code ?? ""}</p>
                  </td>
                  <td className="px-4 py-4">
                    <span className="font-medium text-slate-800">{item.originIataCode || "???"} → {item.destinationIataCode || "???"}</span>
                    {item.transitIataCode ? <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">via {item.transitIataCode}</span> : null}
                    <p className="text-xs text-slate-500">{item.destinationAgent ? `Agent: ${item.destinationAgent.slice(0, 32)}` : "No agent"}</p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-medium text-slate-800">{new Date(item.scheduledDepartureAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p>
                    <p className="text-xs text-slate-500">→ {new Date(item.scheduledArrivalAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p>
                  </td>
                  <td className="px-4 py-4 text-right tabular-nums">
                    <span className={item.allocatedWeightKg > item.capacityKg ? "font-bold text-red-600" : "font-semibold text-slate-800"}>{item.allocatedWeightKg.toFixed(1)} / {item.capacityKg.toFixed(1)} kg</span>
                    <div className="ml-auto mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full ${item.utilisationPercent > 100 ? "bg-red-600" : item.utilisationPercent > 90 ? "bg-amber-500" : "bg-[#0D1282]"}`} style={{ width: `${Math.min(item.utilisationPercent, 100)}%` }} />
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${item.utilisationPercent > 100 ? "bg-red-100 text-red-700" : item.utilisationPercent > 90 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"}`}>{item.utilisationPercent.toFixed(1)}%</span>
                  </td>
                  <td className="px-4 py-4 text-center font-semibold text-slate-800">{item.totalShipments}</td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusColor(item.status)}`}>{item.status.replaceAll("_", " ")}</span>
                    {item.connection?.riskLevel && ["HIGH","CRITICAL","MISSED"].includes(item.connection.riskLevel) ? <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">{item.connection.riskLevel}</span> : null}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <Link href={`/dashboard/flight-linehauls/${item.id}`} className="inline-flex items-center gap-1 rounded-xl border border-[#0D1282]/20 px-3 py-2 text-xs font-semibold text-[#0D1282] hover:bg-[#0D1282]/5">Open <FiArrowRight /></Link>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={8} className="px-4 py-14 text-center text-slate-500">No flights found. Create your first flight to start allocations.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button disabled={page === 1} onClick={() => setPage((v) => v - 1)} className="h-9 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-[#0D1282] disabled:opacity-40">Previous</button>
        <span className="flex h-9 items-center px-3 text-sm text-slate-600">Page {page} of {pages}</span>
        <button disabled={page >= pages} onClick={() => setPage((v) => v + 1)} className="h-9 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-[#0D1282] disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}

function Card({ label, value, icon, alert, accent }: { label: string; value: number; icon: React.ReactNode; alert?: boolean; accent?: string }) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${accent ?? (alert ? "border-red-200 bg-red-50/30" : "border-[#EEEDED]")}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <span className={`grid h-7 w-7 place-items-center rounded-lg ${alert ? "bg-red-100 text-red-700" : "bg-slate-50 text-slate-600"}`}>{icon}</span>
      </div>
      <p className={`mt-2 text-2xl font-bold tabular-nums ${alert ? "text-red-700" : "text-slate-900"}`}>{value}</p>
    </div>
  );
}
