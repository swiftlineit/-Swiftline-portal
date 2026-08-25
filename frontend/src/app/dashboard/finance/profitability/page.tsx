"use client";

import { useEffect, useState } from "react";
import { DashboardLoading } from "@/components/DashboardShell";
import BuyingRatesPanel from "@/components/profitability/BuyingRatesPanel";
import ProfitabilityOverviewPanel from "@/components/profitability/ProfitabilityOverviewPanel";
import ShipmentMarginsTable from "@/components/profitability/ShipmentMarginsTable";
import { listBranches, type Branch } from "@/lib/branches";
import {
  getProfitabilityOverview,
  listProfitabilityRates,
  listProfitabilityShipments,
  listProfitabilityVendors,
  type LogisticsVendor,
  type ProfitabilityOverview,
  type ProfitabilityRow,
  type VendorCostRate
} from "@/lib/profitability";
import { FINANCE_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

type Tab = "OVERVIEW" | "SHIPMENTS" | "RATES";

function indiaToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export default function ProfitabilityPage() {
  const { user, loading } = useAdminUser(FINANCE_AREA);
  const today = indiaToday();
  const [tab, setTab] = useState<Tab>("OVERVIEW");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [vendors, setVendors] = useState<LogisticsVendor[]>([]);
  const [rates, setRates] = useState<VendorCostRate[]>([]);
  const [overview, setOverview] = useState<ProfitabilityOverview | null>(null);
  const [rows, setRows] = useState<ProfitabilityRow[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [branchId, setBranchId] = useState(""); const [service, setService] = useState("");
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`); const [to, setTo] = useState(today);
  const [searchInput, setSearchInput] = useState(""); const [search, setSearch] = useState("");
  const [coverage, setCoverage] = useState(""); const [result, setResult] = useState("");
  const [dataLoading, setDataLoading] = useState(true); const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    let active = true;
    async function initialLoad() {
      setDataLoading(true); setError("");
      try {
        const [branchResult, vendorResult, rateResult] = await Promise.all([listBranches("", "ACTIVE"), listProfitabilityVendors(), listProfitabilityRates()]);
        if (active) { setBranches(branchResult.branches); setVendors(vendorResult.vendors); setRates(rateResult.rates); }
      } catch (caught) { if (active) setError(caught instanceof Error ? caught.message : "Profitability could not be loaded."); }
      finally { if (active) setDataLoading(false); }
    }
    void initialLoad(); return () => { active = false; };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const handle = window.setTimeout(() => { setSearch(searchInput.trim()); }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput, user]);

  useEffect(() => {
    if (!user || dataLoading) return;
    let active = true;
    async function refresh() {
      try {
        const [overviewResult, shipmentResult] = await Promise.all([
          getProfitabilityOverview({ branchId, service }),
          listProfitabilityShipments({ from, to, branchId, service, search, coverage, result, page: 1, limit: 25 })
        ]);
        if (active) { setOverview(overviewResult); setRows(shipmentResult.rows); setPagination({ page: shipmentResult.pagination.page, pages: shipmentResult.pagination.pages, total: shipmentResult.pagination.total }); setError(""); }
      } catch (caught) { if (active) setError(caught instanceof Error ? caught.message : "Profitability could not be refreshed."); }
    }
    void refresh();
    return () => { active = false; };
  }, [branchId, coverage, dataLoading, from, result, search, service, to, user]);

  async function loadPage(page: number) {
    const response = await listProfitabilityShipments({ from, to, branchId, service, search, coverage, result, page, limit: 25 });
    setRows(response.rows); setPagination({ page: response.pagination.page, pages: response.pagination.pages, total: response.pagination.total });
  }
  async function reloadRates() { const [vendorResult, rateResult] = await Promise.all([listProfitabilityVendors(), listProfitabilityRates()]); setVendors(vendorResult.vendors); setRates(rateResult.rates); }
  function updateRow(updated: ProfitabilityRow) { setRows((current) => current.map((row) => row.id === updated.id ? updated : row)); void getProfitabilityOverview({ branchId, service }).then(setOverview); }

  if (loading || !user) return <DashboardLoading />;

  return <div className="mx-auto max-w-[1600px] space-y-5">
    <header className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#0D1282]">Finance</p><h1 className="mt-1 text-2xl font-bold text-slate-950">Profitability / Margin</h1></header>

    <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">{([{"id":"OVERVIEW","label":"Overview"},{"id":"SHIPMENTS","label":"Shipment margins"},{"id":"RATES","label":"Buying rates"}] as Array<{id:Tab;label:string}>).map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`h-10 whitespace-nowrap rounded-lg px-4 text-sm font-semibold ${tab === item.id ? "bg-[#0D1282] text-white" : "text-slate-600 hover:bg-slate-100"}`}>{item.label}</button>)}</div>

    {tab !== "RATES" ? <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-end gap-3"><label className="min-w-48 text-sm font-semibold text-slate-700">Branch<select value={branchId} onChange={(event) => setBranchId(event.target.value)} className="mt-2 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal"><option value="">All accessible branches</option>{branches.map((branch) => <option key={branch._id} value={branch._id}>{branch.name} ({branch.code})</option>)}</select></label><label className="min-w-40 text-sm font-semibold text-slate-700">Service<select value={service} onChange={(event) => setService(event.target.value)} className="mt-2 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal"><option value="">All services</option><option value="COURIER">Courier</option><option value="CARGO">Cargo</option></select></label>{tab === "SHIPMENTS" ? <><label className="text-sm font-semibold text-slate-700">From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-2 block h-10 rounded-lg border border-slate-300 px-3 font-normal" /></label><label className="text-sm font-semibold text-slate-700">To<input type="date" value={to} min={from} max={today} onChange={(event) => setTo(event.target.value)} className="mt-2 block h-10 rounded-lg border border-slate-300 px-3 font-normal" /></label><label className="min-w-52 flex-1 text-sm font-semibold text-slate-700">Search<input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="AWB, customer or destination" className="mt-2 block h-10 w-full rounded-lg border border-slate-300 px-3 font-normal" /></label><label className="min-w-36 text-sm font-semibold text-slate-700">Coverage<select value={coverage} onChange={(event) => setCoverage(event.target.value)} className="mt-2 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal"><option value="">All</option><option value="ACTUAL">Actual</option><option value="ESTIMATED">Estimated</option><option value="PARTIAL">Partial</option><option value="MISSING">Missing</option></select></label><label className="min-w-32 text-sm font-semibold text-slate-700">Result<select value={result} onChange={(event) => setResult(event.target.value)} className="mt-2 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-normal"><option value="">All</option><option value="PROFIT">Profit</option><option value="LOSS">Loss</option></select></label></> : null}</div></section> : null}

    {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
    {dataLoading ? <div className="rounded-2xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-500 shadow-sm">Loading profitability…</div> : null}
    {!dataLoading && tab === "OVERVIEW" && overview ? <ProfitabilityOverviewPanel overview={overview} /> : null}
    {!dataLoading && tab === "SHIPMENTS" ? <ShipmentMarginsTable rows={rows} vendors={vendors} page={pagination.page} pages={pagination.pages} total={pagination.total} onPage={(page) => void loadPage(page)} onUpdated={updateRow} /> : null}
    {!dataLoading && tab === "RATES" ? <BuyingRatesPanel vendors={vendors} rates={rates} reload={reloadRates} /> : null}
  </div>;
}
