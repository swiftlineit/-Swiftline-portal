"use client";

import { useEffect, useRef, useState } from "react";
import { FiChevronLeft, FiChevronRight, FiEye, FiX } from "react-icons/fi";
import { formatCreditMoney } from "@/lib/creditAccounts";
import { flightAllocationLabels, type ProfitabilityRow } from "@/lib/profitability";
import { normalizeFlightNumber } from "@/lib/flightNumber";

function money(value: number) { return formatCreditMoney(value, "INR"); }
function visualGbp(amountMinor: number, rate?: number | null) {
  return rate && rate > 0 ? `£${(amountMinor / 100 / rate).toFixed(2)}` : null;
}
function margin(value: number | null) { return value === null ? "-" : `${(value / 100).toFixed(2)}%`; }

function Coverage({ row }: { row: ProfitabilityRow }) {
  const value = row.costSource === "FLIGHT_ALLOCATION" ? row.coverage : "LEGACY";
  const classes = value === "ACTUAL" ? "bg-emerald-50 text-emerald-700" : value === "LEGACY" ? "bg-slate-100 text-slate-600" : value === "MISSING" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";
  return <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${classes}`}>{value}</span>;
}

function AllocationDrawer({ row, onClose }: { row: ProfitabilityRow; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => { document.removeEventListener("keydown", handleKeyDown); previousFocus?.focus(); };
  }, [onClose]);

  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <div ref={dialogRef} className="h-full w-full max-w-lg overflow-y-auto bg-white shadow-xl" role="dialog" aria-modal="true" aria-labelledby="allocation-title">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4"><div><h2 id="allocation-title" className="font-bold text-slate-950">Shipment allocation</h2><p className="mt-1 text-sm font-semibold text-[#0D1282]">{row.awb}</p></div><button ref={closeRef} onClick={onClose} className="grid h-11 w-11 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0D1282]/30" aria-label="Close allocation"><FiX /></button></div>
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">{[["Customer", row.customerName], ["Destination", row.destinationCountryName], ["Chargeable weight", `${row.chargeableWeightKg.toFixed(3)} kg`], ["Cost source", row.costSource === "FLIGHT_ALLOCATION" ? "Flight allocation" : "Legacy shipment costs"], ["Flight", row.flight?.flightNumber ? normalizeFlightNumber(row.flight.flightNumber) : "-"], ["MAWB", row.flight?.mawbNumber || "-"]].map(([label, value]) => <div key={label} className="min-w-0 bg-slate-50 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</p></div>)}</div>
        {row.flightAllocation.length ? <section className="overflow-hidden rounded-lg border border-slate-200"><div className="border-b border-slate-200 bg-slate-50 px-4 py-3"><h3 className="text-sm font-bold text-slate-900">Allocated flight costs</h3><p className="mt-1 text-xs text-slate-500">INR is the accounting amount. GBP is a visual equivalent using the flight sheet FX rate.</p></div>{row.flightAllocation.map((item) => <div key={item.component} className="flex items-center justify-between border-b border-slate-100 px-4 py-3 text-sm last:border-b-0"><span className="text-slate-700">{flightAllocationLabels[item.component]}</span><span className="text-right font-semibold tabular-nums text-slate-950">{money(item.amountMinor)}{visualGbp(item.amountMinor, row.flightFxGbpToInr) ? <span className="ml-2 text-xs font-medium text-slate-500">({visualGbp(item.amountMinor, row.flightFxGbpToInr)})</span> : null}</span></div>)}</section> : <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">This shipment has legacy costs. New adjustments must be made from a flight cost sheet.</div>}
        <section className="rounded-lg border border-slate-200 p-4"><Summary label="Revenue" value={row.totalRevenueMinor} /><Summary label="Allocated cost" value={row.totalCostMinor} /><Summary label="Gross profit" value={row.grossProfitMinor} profit /><div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-3"><span className="font-semibold text-slate-700">Margin</span><span className={`text-lg font-bold tabular-nums ${row.grossProfitMinor < 0 ? "text-red-700" : "text-slate-950"}`}>{margin(row.marginBasisPoints)}</span></div></section>
      </div>
    </div>
  </div>;
}

function Summary({ label, value, profit = false }: { label: string; value: number; profit?: boolean }) {
  return <div className="mb-2 flex items-center justify-between text-sm last:mb-0"><span className="text-slate-600">{label}</span><span className={`font-semibold tabular-nums ${profit ? value < 0 ? "text-red-700" : "text-emerald-700" : "text-slate-950"}`}>{money(value)}</span></div>;
}

function FlightIdentity({ row }: { row: ProfitabilityRow }) {
  if (!row.flight) return <span className="text-slate-500">-</span>;
  return <div className="whitespace-nowrap"><p className="font-semibold text-slate-900">{row.flight.flightNumber ? normalizeFlightNumber(row.flight.flightNumber) : row.flight.manifestNumber}</p><p className="mt-0.5 text-xs text-slate-500">MAWB {row.flight.mawbNumber || "-"}</p></div>;
}

export default function ShipmentMarginsTable({ rows, page, pages, total, onPage }: { rows: ProfitabilityRow[]; page: number; pages: number; total: number; onPage: (page: number) => void }) {
  const [selected, setSelected] = useState<ProfitabilityRow | null>(null);
  return <><div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-950">Shipment margins</h2><span className="text-sm font-semibold text-slate-500">{total.toLocaleString("en-IN")} shipments</span></div><div className="overflow-x-auto"><table className="w-full min-w-[1350px] text-left text-sm"><thead className="bg-slate-50 text-xs font-semibold text-slate-600"><tr><th className="sticky left-0 z-10 bg-slate-50 px-4 py-3">AWB</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Flight / MAWB</th><th className="px-4 py-3">Destination</th><th className="px-4 py-3 text-right">Weight</th><th className="px-4 py-3 text-right">Revenue</th><th className="px-4 py-3 text-right">Allocated cost</th><th className="px-4 py-3 text-right">Gross profit</th><th className="px-4 py-3 text-right">Margin</th><th className="px-4 py-3">Coverage</th><th className="px-4 py-3">View allocation</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/70"><td className="sticky left-0 bg-white px-4 py-3 font-semibold text-[#0D1282]">{row.awb}</td><td className="max-w-48 truncate px-4 py-3 font-medium text-slate-900" title={row.customerName}>{row.customerName}</td><td className="px-4 py-3"><FlightIdentity row={row} /></td><td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.destinationCountryName} <span className="text-xs text-slate-500">({row.destinationCountryCode})</span></td><td className="px-4 py-3 text-right tabular-nums">{row.chargeableWeightKg.toFixed(3)} kg</td><td className="px-4 py-3 text-right font-medium tabular-nums">{money(row.totalRevenueMinor)}</td><td className="px-4 py-3 text-right font-medium tabular-nums">{money(row.totalCostMinor)}</td><td className={`px-4 py-3 text-right font-bold tabular-nums ${row.grossProfitMinor < 0 ? "text-red-700" : "text-emerald-700"}`}>{money(row.grossProfitMinor)}</td><td className={`px-4 py-3 text-right font-bold tabular-nums ${(row.marginBasisPoints ?? 0) < 0 ? "text-red-700" : "text-slate-900"}`}>{margin(row.marginBasisPoints)}</td><td className="px-4 py-3"><Coverage row={row} /></td><td className="px-4 py-3 text-right"><button onClick={() => setSelected(row)} className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:border-[#0D1282] hover:text-[#0D1282] focus:outline-none focus:ring-2 focus:ring-[#0D1282]/20"><FiEye /> View allocation</button></td></tr>) : <tr><td colSpan={11} className="px-5 py-12 text-center text-slate-500">No shipments match these filters.</td></tr>}</tbody></table></div><div className="flex items-center justify-between border-t border-slate-200 px-5 py-4"><span className="text-sm text-slate-500">Page {page} of {Math.max(1, pages)}</span><div className="flex gap-2"><button onClick={() => onPage(page - 1)} disabled={page <= 1} className="grid h-11 w-11 place-items-center rounded-lg border border-slate-300 disabled:opacity-40" aria-label="Previous page"><FiChevronLeft /></button><button onClick={() => onPage(page + 1)} disabled={page >= pages} className="grid h-11 w-11 place-items-center rounded-lg border border-slate-300 disabled:opacity-40" aria-label="Next page"><FiChevronRight /></button></div></div></div>{selected ? <AllocationDrawer row={selected} onClose={() => setSelected(null)} /> : null}</>;
}
