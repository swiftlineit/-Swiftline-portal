"use client";

import Link from "next/link";
import TaxInvoiceForm from "@/components/tax-invoices/TaxInvoiceForm";
import TaxInvoiceShell, { TaxInvoiceLoading } from "@/components/tax-invoices/TaxInvoiceShell";
import { createEmptyTaxInvoicePayload } from "@/lib/taxInvoices";
import { useAdminUser } from "@/lib/useAdminUser";

export default function NewTaxInvoicePage() {
  const { user, loading } = useAdminUser();

  if (loading || !user) return <TaxInvoiceLoading />;

  return (
    <TaxInvoiceShell user={user}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Create Tax Invoice</h1>
          <p className="mt-1 text-sm text-slate-500">Standalone invoice, not linked to labels or shipments.</p>
        </div>
        <Link href="/dashboard/tax-invoices" className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
          Back To List
        </Link>
      </div>

      <TaxInvoiceForm initialPayload={createEmptyTaxInvoicePayload()} />
    </TaxInvoiceShell>
  );
}
