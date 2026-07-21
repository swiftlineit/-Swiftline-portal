"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FiPlus } from "react-icons/fi";
import { ClientDashboardLoading, ClientDashboardShell } from "@/components/client/ClientDashboardShell";
import QuoteList from "@/components/quotes/QuoteList";
import { listShipmentQuotes, type ShipmentQuote } from "@/lib/shipmentQuotes";
import { useClientUser } from "@/lib/useClientUser";

export default function ClientQuotesPage() {
  const { user, loading } = useClientUser();
  const [quotes, setQuotes] = useState<ShipmentQuote[]>([]);
  const [error, setError] = useState("");
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    listShipmentQuotes("client")
      .then((result) => setQuotes(result.quotes))
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Unable to load quotes."))
      .finally(() => setDataLoading(false));
  }, [user]);

  if (loading || !user) return <ClientDashboardLoading />;
  return (
    <ClientDashboardShell user={user}>
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div><h1 className="text-2xl font-semibold text-slate-950">Shipment Quotes</h1><p className="mt-1 text-sm text-slate-500">Review estimates and branch-approved live quotes.</p></div>
          <Link href="/client/get-quote" className="inline-flex h-10 items-center gap-2 bg-blue-950 px-4 text-sm font-semibold text-white hover:bg-blue-900"><FiPlus />Get Quote</Link>
        </div>
        {error ? <div className="mb-5 border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div> : null}
        <QuoteList quotes={quotes} audience="client" loading={dataLoading} />
      </div>
    </ClientDashboardShell>
  );
}
