"use client";

import { useEffect, useState } from "react";
import { ClientDashboardLoading, ClientDashboardShell } from "@/components/client/ClientDashboardShell";
import QuoteForm from "@/components/quotes/QuoteForm";
import { getQuoteContext, type QuoteContext } from "@/lib/shipmentQuotes";
import { useClientUser } from "@/lib/useClientUser";

export default function ClientGetQuotePage() {
  const { user, loading } = useClientUser();
  const [context, setContext] = useState<QuoteContext | null>(null);
  const [error, setError] = useState("");
  const [contextLoading, setContextLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    getQuoteContext("client")
      .then((result) => setContext(result.context ?? null))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load quote access."))
      .finally(() => setContextLoading(false));
  }, [user]);

  if (loading || !user) return <ClientDashboardLoading />;
  return (
    <ClientDashboardShell user={user}>
      <div className="mx-auto max-w-7xl">
        <div className="mb-6"><h1 className="text-2xl font-semibold text-slate-950">Get Quote</h1><p className="mt-1 text-sm text-slate-500">Estimate shipment charges or request reviewed pricing from Swiftline.</p></div>
        {error ? <div className="border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div> : null}
        {contextLoading ? <div className="border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading quote workspace...</div> : null}
        {context ? <QuoteForm audience="client" contexts={[context]} initialContext={context} /> : null}
      </div>
    </ClientDashboardShell>
  );
}
