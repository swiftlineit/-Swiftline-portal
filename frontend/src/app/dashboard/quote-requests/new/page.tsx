"use client";

import { useEffect, useState } from "react";
import { DashboardLoading } from "@/components/DashboardShell";
import QuoteForm from "@/components/quotes/QuoteForm";
import { getQuoteContext, type QuoteContext } from "@/lib/shipmentQuotes";
import { useAdminUser } from "@/lib/useAdminUser";

export default function NewAdminQuotePage() {
  const { user, loading } = useAdminUser();
  const [contexts, setContexts] = useState<QuoteContext[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    getQuoteContext("admin")
      .then((result) => setContexts(result.accounts ?? []))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load business accounts."));
  }, [user]);

  if (loading || !user) return <DashboardLoading />;
  return (
      <div className="mx-auto max-w-7xl">
        <div className="mb-6"><h1 className="text-2xl font-semibold text-slate-950">Create Shipment Quote</h1><p className="mt-1 text-sm text-slate-500">Calculate or submit a quote for a business account.</p></div>
        {error ? <div className="mb-5 border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div> : null}
        {contexts.length ? <QuoteForm audience="admin" contexts={contexts} /> : !error ? <div className="border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading eligible accounts...</div> : null}
      </div>
  );
}
