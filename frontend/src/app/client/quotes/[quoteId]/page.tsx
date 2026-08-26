"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  ClientDashboardLoading,
} from "@/components/client/ClientDashboardShell";
import QuoteDetail from "@/components/quotes/QuoteDetail";
import { getShipmentQuote, type ShipmentQuote } from "@/lib/shipmentQuotes";
import { useClientUser } from "@/lib/useClientUser";
import { FiArrowLeft } from "react-icons/fi";

export default function ClientQuoteDetailPage() {
  const { user, loading } = useClientUser();
  const params = useParams<{ quoteId: string }>();
  const [quote, setQuote] = useState<ShipmentQuote | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!user || !params.quoteId) return;
    getShipmentQuote("client", params.quoteId)
      .then((result) => setQuote(result.quote))
      .catch((caught) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load this quote.",
        ),
      );
  }, [params.quoteId, user]);
  if (loading || !user) return <ClientDashboardLoading />;
  return (
      <div className="mx-auto max-w-7xl">
        {error ? (
          <div className="border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
            {error}
          </div>
        ) : null}
        {quote ? (
          <QuoteDetail quote={quote} audience="client" />
        ) : !error ? (
          <div className="border border-slate-200 bg-white p-8 text-sm text-slate-500">
            Loading quote...
          </div>
        ) : null}
      </div>
  );
}
