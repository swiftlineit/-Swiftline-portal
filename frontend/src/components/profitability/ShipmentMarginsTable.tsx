"use client";

import { useState } from "react";
import { FiChevronLeft, FiChevronRight, FiEdit3, FiX } from "react-icons/fi";
import { toast } from "react-toastify";
import { formatCreditMoney } from "@/lib/creditAccounts";
import {
  costComponentLabels,
  costComponents,
  updateProfitabilityCosts,
  type CostComponent,
  type LogisticsVendor,
  type ProfitabilityRow
} from "@/lib/profitability";

function money(value: number) { return formatCreditMoney(value, "INR"); }
function margin(value: number | null) { return value === null ? "-" : `${(value / 100).toFixed(2)}%`; }
function date(value: string) { return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value)); }

function Coverage({ value }: { value: ProfitabilityRow["coverage"] }) {
  const classes = value === "ACTUAL" ? "bg-emerald-50 text-emerald-700" : value === "MISSING" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";
  return <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-bold ${classes}`}>{value}</span>;
}

function CostEditor({ row, vendors, onClose, onUpdated }: { row: ProfitabilityRow; vendors: LogisticsVendor[]; onClose: () => void; onUpdated: (row: ProfitabilityRow) => void }) {
  const [vendorId, setVendorId] = useState(row.primaryVendor?.id ?? "");
  const [values, setValues] = useState<Record<CostComponent, string>>(() => Object.fromEntries(costComponents.map((component) => {
    const cost = row.costs.find((entry) => entry.component === component);
    return [component, cost?.state === "MISSING" ? "" : (cost?.amountMinor ?? 0) / 100];
  })) as Record<CostComponent, string>);
  const [changed, setChanged] = useState<Set<CostComponent>>(() => new Set());
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (reason.trim().length < 3) { toast.error("Enter a reason for the cost update."); return; }
    setSaving(true);
    try {
      const result = await updateProfitabilityCosts(row.shipmentDraftId, {
        expectedVersion: row.version,
        primaryVendorId: vendorId || null,
        costs: costComponents.filter((component) => changed.has(component)).map((component) => ({
          component,
          amountMinor: values[component].trim() === "" ? null : Math.round(Number(values[component]) * 100),
          reference: values[component].trim() === "" ? "" : reference.trim()
        })),
        reason: reason.trim()
      });
      onUpdated(result.profitability);
      toast.success(result.message);
      onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Shipment costs could not be updated."); }
    finally { setSaving(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label="Update shipment costs">
    <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4"><div><h2 className="text-lg font-bold text-slate-950">Shipment costs</h2><p className="text-sm font-semibold text-[#0D1282]">{row.awb}</p></div><button onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><FiX className="h-5 w-5" /></button></div>
      <div className="space-y-5 p-6">
        <label className="block text-sm font-semibold text-slate-700">Primary vendor<select value={vendorId} onChange={(event) => setVendorId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal outline-none focus:border-[#0D1282]"><option value="">No vendor selected</option>{vendors.filter((vendor) => vendor.status === "ACTIVE").map((vendor) => <option key={vendor._id} value={vendor._id}>{vendor.name} ({vendor.code})</option>)}</select></label>
        <div className="grid gap-4 sm:grid-cols-2">{costComponents.map((component) => {
          const stored = row.costs.find((cost) => cost.component === component);
          return <label key={component} className="block text-sm font-semibold text-slate-700">{costComponentLabels[component]}<div className="relative mt-2"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">₹</span><input type="number" min="0" step="0.01" value={values[component]} onChange={(event) => { setValues((current) => ({ ...current, [component]: event.target.value })); setChanged((current) => new Set(current).add(component)); }} placeholder="Missing" className="h-11 w-full rounded-xl border border-slate-300 pl-7 pr-3 font-normal outline-none focus:border-[#0D1282]" /></div>{stored?.state === "ESTIMATED" ? <span className="mt-1 block text-xs font-medium text-amber-700">Rate estimate</span> : null}</label>;
        })}</div>
        <p className="text-xs text-slate-500">Leave blank when unknown. Enter 0 only when the cost is confirmed as not applicable.</p>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold text-slate-700">Vendor reference<input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={120} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:border-[#0D1282]" /></label><label className="block text-sm font-semibold text-slate-700">Update reason<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:border-[#0D1282]" /></label></div>
      </div>
      <div className="sticky bottom-0 flex justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4"><button onClick={onClose} className="h-10 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700">Cancel</button><button onClick={() => void save()} disabled={saving} className="h-10 rounded-xl bg-[#0D1282] px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save costs"}</button></div>
    </div>
  </div>;
}

export default function ShipmentMarginsTable({ rows, vendors, page, pages, total, onPage, onUpdated }: { rows: ProfitabilityRow[]; vendors: LogisticsVendor[]; page: number; pages: number; total: number; onPage: (page: number) => void; onUpdated: (row: ProfitabilityRow) => void }) {
  const [editing, setEditing] = useState<ProfitabilityRow | null>(null);
  return <>
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-950">Shipment margins</h2><span className="text-sm font-semibold text-slate-500">{total.toLocaleString("en-IN")} shipments</span></div>
      <div className="overflow-x-auto"><table className="min-w-[2200px] text-left text-sm"><thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-500"><tr>
        <th className="sticky left-0 z-10 bg-slate-100 px-4 py-3">AWB</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Booked</th><th className="px-4 py-3">Destination</th><th className="px-4 py-3">Service</th><th className="px-4 py-3 text-right">Chargeable weight</th><th className="px-4 py-3 text-right">Customer selling</th><th className="px-4 py-3 text-right">Duty / tax</th><th className="px-4 py-3 text-right">Total revenue</th>{costComponents.map((component) => <th key={component} className="px-4 py-3 text-right">{costComponentLabels[component]}</th>)}<th className="px-4 py-3 text-right">Total cost</th><th className="px-4 py-3 text-right">Gross profit</th><th className="px-4 py-3 text-right">Margin</th><th className="px-4 py-3">Coverage</th><th className="px-4 py-3" /></tr></thead>
        <tbody>{rows.length ? rows.map((row) => <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/70"><td className="sticky left-0 bg-white px-4 py-3 font-bold text-[#0D1282]">{row.awb}</td><td className="max-w-52 truncate px-4 py-3 font-semibold text-slate-900" title={row.customerName}>{row.customerName}</td><td className="whitespace-nowrap px-4 py-3 text-slate-600">{date(row.bookedAt)}</td><td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.destinationCountryName}</td><td className="px-4 py-3 text-slate-700">{row.serviceType}</td><td className="px-4 py-3 text-right tabular-nums text-slate-700">{row.chargeableWeightKg.toFixed(2)} kg</td><td className="px-4 py-3 text-right tabular-nums">{money(row.customerSellingAmountMinor)}</td><td className="px-4 py-3 text-right tabular-nums text-slate-600">{money(row.dutyTaxMinor)}</td><td className="px-4 py-3 text-right font-semibold tabular-nums">{money(row.totalRevenueMinor)}</td>{costComponents.map((component) => { const cost = row.costs.find((item) => item.component === component); return <td key={component} className={`px-4 py-3 text-right tabular-nums ${cost?.state === "MISSING" ? "text-slate-400" : "text-slate-700"}`}>{cost?.state === "MISSING" ? "-" : `${cost?.state === "ESTIMATED" ? "~" : ""}${money(cost?.amountMinor ?? 0)}`}</td>; })}<td className="px-4 py-3 text-right font-semibold tabular-nums">{money(row.totalCostMinor)}</td><td className={`px-4 py-3 text-right font-bold tabular-nums ${row.grossProfitMinor < 0 ? "text-red-700" : "text-emerald-700"}`}>{money(row.grossProfitMinor)}</td><td className={`px-4 py-3 text-right font-bold tabular-nums ${(row.marginBasisPoints ?? 0) < 0 ? "text-red-700" : "text-slate-900"}`}>{margin(row.marginBasisPoints)}</td><td className="px-4 py-3"><Coverage value={row.coverage} /></td><td className="px-4 py-3"><button onClick={() => setEditing(row)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-300 px-3 text-xs font-bold text-slate-700 hover:border-[#0D1282] hover:text-[#0D1282]"><FiEdit3 /> Costs</button></td></tr>) : <tr><td colSpan={22} className="px-5 py-12 text-center text-slate-500">No shipments match these filters.</td></tr>}</tbody></table></div>
      <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4"><span className="text-sm text-slate-500">Page {page} of {Math.max(1, pages)}</span><div className="flex gap-2"><button onClick={() => onPage(page - 1)} disabled={page <= 1} className="rounded-lg border border-slate-300 p-2 disabled:opacity-40" aria-label="Previous page"><FiChevronLeft /></button><button onClick={() => onPage(page + 1)} disabled={page >= pages} className="rounded-lg border border-slate-300 p-2 disabled:opacity-40" aria-label="Next page"><FiChevronRight /></button></div></div>
    </div>
    {editing ? <CostEditor row={editing} vendors={vendors} onClose={() => setEditing(null)} onUpdated={onUpdated} /> : null}
  </>;
}
