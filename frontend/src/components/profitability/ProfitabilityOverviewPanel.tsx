import { formatCreditMoney } from "@/lib/creditAccounts";
import type { ProfitabilityOverview } from "@/lib/profitability";

function money(value: number) {
  return formatCreditMoney(value, "INR");
}

function margin(value: number | null) {
  return value === null ? "-" : `${(value / 100).toFixed(2)}%`;
}

function Kpi({ label, value, tone = "text-slate-950" }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p><p className={`mt-2 text-2xl font-bold tabular-nums ${tone}`}>{value}</p></div>;
}

function CoverageBadge({ coverage }: { coverage: string }) {
  const classes = coverage === "ACTUAL" ? "bg-emerald-50 text-emerald-700" : coverage === "MISSING" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";
  return <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${classes}`}>{coverage}</span>;
}

export default function ProfitabilityOverviewPanel({ overview }: { overview: ProfitabilityOverview }) {
  const peak = Math.max(1, ...overview.monthlyTrend.map((point) => Math.abs(point.profitMinor)));
  const coverageTotal = overview.coverage.reduce((sum, item) => sum + item.count, 0);

  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <Kpi label="Revenue today" value={money(overview.today.revenueMinor)} />
      <Kpi label="Cost today" value={money(overview.today.costMinor)} />
      <Kpi label="Profit today" value={money(overview.today.profitMinor)} tone={overview.today.profitMinor < 0 ? "text-red-700" : "text-emerald-700"} />
      <Kpi label="Margin today" value={margin(overview.today.marginBasisPoints)} tone={(overview.today.marginBasisPoints ?? 0) < 0 ? "text-red-700" : "text-[#0D1282]"} />
      <Kpi label="Monthly profit" value={money(overview.monthlyProfitMinor ?? 0)} tone={(overview.monthlyProfitMinor ?? 0) < 0 ? "text-red-700" : "text-emerald-700"} />
    </div>

    <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3"><h2 className="font-bold text-slate-950">Monthly profit</h2><span className="text-xs font-semibold text-slate-500">INR</span></div>
        <div className="mt-6 flex h-48 items-end gap-2 overflow-x-auto border-b border-slate-200 pb-px">
          {overview.monthlyTrend.length ? overview.monthlyTrend.map((point) => {
            const height = Math.max(3, Math.round((Math.abs(point.profitMinor) / peak) * 150));
            const positive = point.profitMinor >= 0;
            return <div key={point.date} className="flex min-w-8 flex-1 flex-col items-center justify-end gap-2" title={`${point.date}: ${money(point.profitMinor)}`}>
              <div className={`w-full max-w-8 rounded-t-md ${positive ? "bg-emerald-500" : "bg-red-500"}`} style={{ height }} />
              <span className="text-[10px] font-medium text-slate-500">{point.date.slice(-2)}</span>
            </div>;
          }) : <div className="m-auto text-sm text-slate-500">No shipment revenue this month.</div>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-950">Cost coverage</h2>
        <div className="mt-5 space-y-3">
          {(["ACTUAL", "ESTIMATED", "PARTIAL", "MISSING"] as const).map((key) => {
            const count = overview.coverage.find((item) => item.coverage === key)?.count ?? 0;
            const width = coverageTotal ? Math.round((count / coverageTotal) * 100) : 0;
            return <div key={key}><div className="mb-1.5 flex items-center justify-between"><CoverageBadge coverage={key} /><span className="text-sm font-bold tabular-nums text-slate-700">{count}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#0D1282]" style={{ width: `${width}%` }} /></div></div>;
          })}
        </div>
      </section>
    </div>

    <div className="grid gap-5 xl:grid-cols-3">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold text-slate-950">Loss-making shipments</h2></div><div className="divide-y divide-slate-100">{overview.lossMaking.length ? overview.lossMaking.map((row) => <div key={row.id} className="flex items-center justify-between gap-4 px-5 py-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{row.awb}</p><p className="truncate text-xs text-slate-500">{row.customerName}</p></div><div className="text-right"><p className="text-sm font-bold text-red-700">{money(row.grossProfitMinor)}</p><CoverageBadge coverage={row.coverage} /></div></div>) : <p className="px-5 py-8 text-center text-sm text-slate-500">No loss-making shipments.</p>}</div></section>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold text-slate-950">Most profitable customers</h2></div><div className="divide-y divide-slate-100">{overview.mostProfitableCustomers.length ? overview.mostProfitableCustomers.map((row) => <div key={row.businessAccountId} className="flex items-center justify-between gap-4 px-5 py-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{row.customerName}</p><p className="text-xs text-slate-500">{row.shipments} shipments</p></div><p className={`text-sm font-bold ${row.profitMinor < 0 ? "text-red-700" : "text-emerald-700"}`}>{money(row.profitMinor)}</p></div>) : <p className="px-5 py-8 text-center text-sm text-slate-500">No customer data.</p>}</div></section>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold text-slate-950">Most profitable lanes</h2></div><div className="divide-y divide-slate-100">{overview.mostProfitableLanes.length ? overview.mostProfitableLanes.map((row) => <div key={`${row.originCountryCode}:${row.destinationCountryCode}:${row.serviceType}`} className="flex items-center justify-between gap-4 px-5 py-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{row.originCountryCode} → {row.destinationCountryName}</p><p className="text-xs text-slate-500">{row.serviceType} · {row.shipments} shipments</p></div><p className={`text-sm font-bold ${row.profitMinor < 0 ? "text-red-700" : "text-emerald-700"}`}>{money(row.profitMinor)}</p></div>) : <p className="px-5 py-8 text-center text-sm text-slate-500">No lane data.</p>}</div></section>
    </div>

    <div className="grid gap-5 xl:grid-cols-3">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold text-slate-950">Loss-making flights</h2></div><div className="divide-y divide-slate-100">{overview.lossMakingFlights?.length ? overview.lossMakingFlights.map((row) => <div key={row.id} className="flex items-center justify-between gap-4 px-5 py-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{row.manifestNumber} · {row.mawbNumber}</p><p className="truncate text-xs text-slate-500">{row.flightNumber} · {row.destinationCountryName}</p></div><div className="text-right"><p className="text-sm font-bold text-red-700">{money(row.grossProfitMinor)}</p><span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">{row.status.replaceAll("_"," ")}</span></div></div>) : <p className="px-5 py-8 text-center text-sm text-slate-500">No loss-making flights.</p>}</div></section>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold text-slate-950">Most profitable destinations</h2></div><div className="divide-y divide-slate-100">{overview.mostProfitableDestinations?.length ? overview.mostProfitableDestinations.map((row) => <div key={row.destinationCountryCode} className="flex items-center justify-between gap-4 px-5 py-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{row.destinationCountryName}</p><p className="text-xs text-slate-500">{row.destinationCountryCode} · {row.shipments} shipments</p></div><p className={`text-sm font-bold ${row.profitMinor < 0 ? "text-red-700" : "text-emerald-700"}`}>{money(row.profitMinor)}</p></div>) : <p className="px-5 py-8 text-center text-sm text-slate-500">No destination data.</p>}</div></section>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h2 className="font-bold text-slate-950">Sheets requiring completion</h2></div><div className="divide-y divide-slate-100">{overview.sheetsRequiringCompletion?.length ? overview.sheetsRequiringCompletion.map((row) => <div key={row.id} className="flex items-center justify-between gap-4 px-5 py-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900">{row.manifestNumber}</p><p className="truncate text-xs text-slate-500">{row.mawbNumber} · {row.flightNumber} · {row.flightDate}</p></div><div className="text-right"><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${row.status==="REVIEW_REQUIRED"?"bg-amber-50 text-amber-700":"bg-blue-50 text-[#0D1282]"}`}>{row.status.replaceAll("_"," ")}</span><p className="mt-1 text-xs font-semibold text-slate-500">{money(row.totalCostMinor)} {row.status==="REVIEW_REQUIRED"?"· Review required":"· Provisional"}</p></div></div>) : <p className="px-5 py-8 text-center text-sm text-slate-500">All sheets completed.</p>}</div></section>
    </div>
  </div>;
}
