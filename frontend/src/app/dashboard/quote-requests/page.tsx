"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FiPlus, FiRefreshCw } from "react-icons/fi";
import BusinessAccountsShell, { BusinessAccountsLoading } from "@/components/business-accounts/BusinessAccountsShell";
import QuoteList from "@/components/quotes/QuoteList";
import { listShipmentQuotes, type QuoteStatus, type ShipmentQuote } from "@/lib/shipmentQuotes";
import { useAdminUser } from "@/lib/useAdminUser";

export default function AdminQuoteRequestsPage() {
  const { user, loading } = useAdminUser();
  const [quotes, setQuotes] = useState<ShipmentQuote[]>([]);
  const [status, setStatus] = useState<"" | QuoteStatus>("");
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setDataLoading(true); setError("");
    try { setQuotes((await listShipmentQuotes("admin", status)).quotes); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load quote requests."); }
    finally { setDataLoading(false); }
  }, [status]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void Promise.resolve().then(() => { if (active) return load(); });
    return () => { active = false; };
  }, [load, user]);
  if (loading || !user) return <BusinessAccountsLoading />;

  return (
    <BusinessAccountsShell user={user}>
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div><h1 className="text-2xl font-semibold text-slate-950">Quote Requests</h1><p className="mt-1 text-sm text-slate-500">Review customer requests and publish valid Swiftline pricing.</p></div>
          <div className="flex gap-2">
            <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="h-10 border border-slate-300 bg-white px-3 pr-9 text-sm font-semibold text-slate-700">
              <option value="">All statuses</option>
              {["REQUESTED", "UNDER_REVIEW", "QUOTED", "DECLINED", "EXPIRED", "CONVERTED"].map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
            </select>
            <button type="button" onClick={() => void load()} title="Refresh quotes" className="flex h-10 w-10 items-center justify-center border border-slate-300 bg-white text-blue-900"><FiRefreshCw className={dataLoading ? "animate-spin" : ""} /></button>
            <Link href="/dashboard/quote-requests/new" className="inline-flex h-10 items-center gap-2 bg-blue-950 px-4 text-sm font-semibold text-white"><FiPlus />Create Quote</Link>
          </div>
        </div>
        {error ? <div className="mb-5 border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div> : null}
        <QuoteList quotes={quotes} audience="admin" loading={dataLoading} />
      </div>
    </BusinessAccountsShell>
  );
}
