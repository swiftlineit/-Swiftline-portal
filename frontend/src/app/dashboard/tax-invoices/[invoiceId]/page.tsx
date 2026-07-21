"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import TaxInvoiceForm from "@/components/tax-invoices/TaxInvoiceForm";
import TaxInvoiceShell, { TaxInvoiceLoading } from "@/components/tax-invoices/TaxInvoiceShell";
import { getTaxInvoice, invoiceToPayload, TaxInvoice } from "@/lib/taxInvoices";
import { useAdminUser } from "@/lib/useAdminUser";

export default function TaxInvoiceDetailPage() {
  const params = useParams<{ invoiceId: string }>();
  const { user, loading } = useAdminUser();
  const [invoice, setInvoice] = useState<TaxInvoice | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user || !params.invoiceId) return;

    async function loadInvoice() {
      setDataLoading(true);
      setError("");

      try {
        const result = await getTaxInvoice(params.invoiceId);
        setInvoice(result.invoice);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load tax invoice.");
      } finally {
        setDataLoading(false);
      }
    }

    void loadInvoice();
  }, [params.invoiceId, user]);

  if (loading || !user) return <TaxInvoiceLoading />;

  return (
    <TaxInvoiceShell user={user}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">{invoice?.invoiceNumber || "Tax Invoice"}</h1>
          <p className="mt-1 text-sm text-slate-500">{invoice?.status === "FINALIZED" ? "Finalized invoice is locked." : "Draft invoice can be edited and finalized."}</p>
        </div>
        <Link href="/dashboard/tax-invoices" className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
          Back To List
        </Link>
      </div>

      {error ? (
        <div className="border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
      ) : dataLoading || !invoice ? (
        <TaxInvoiceLoading />
      ) : (
        <TaxInvoiceForm invoice={invoice} initialPayload={invoiceToPayload(invoice)} />
      )}
    </TaxInvoiceShell>
  );
}
