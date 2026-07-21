"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import TaxInvoiceShell, { TaxInvoiceLoading } from "@/components/tax-invoices/TaxInvoiceShell";
import { deleteTaxInvoice, formatMinorMoney, listTaxInvoices, TaxInvoice } from "@/lib/taxInvoices";
import { useAdminUser } from "@/lib/useAdminUser";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

export default function TaxInvoicesPage() {
  const { user, loading } = useAdminUser();
  const [invoices, setInvoices] = useState<TaxInvoice[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;

    async function loadInvoices() {
      setDataLoading(true);
      setError("");

      try {
        const result = await listTaxInvoices(search, status);
        setInvoices(result.invoices);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load tax invoices.");
      } finally {
        setDataLoading(false);
      }
    }

    const timeout = window.setTimeout(() => {
      void loadInvoices();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [search, status, user]);

  async function handleDelete(invoiceId: string) {
    setError("");

    try {
      await deleteTaxInvoice(invoiceId);
      setInvoices((current) => current.filter((invoice) => invoice._id !== invoiceId));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to delete invoice.");
    }
  }

  if (loading || !user) return <TaxInvoiceLoading />;

  return (
    <TaxInvoiceShell user={user}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Tax Invoices</h1>
          <p className="mt-1 text-sm text-slate-500">Create standalone tax invoices for staff paperwork.</p>
        </div>
        <Link href="/dashboard/tax-invoices/new" className="bg-blue-900 px-4 py-2 text-sm font-semibold text-white">
          Create Invoice
        </Link>
      </div>

      <div className="mb-4 grid gap-4 border border-slate-200 bg-white p-4 md:grid-cols-[1fr_220px]">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by invoice, shipper, consignee"
          className="h-10 w-full border border-slate-300 px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="h-10 w-full border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-900 focus:ring-2 focus:ring-blue-100"
        >
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="FINALIZED">Finalized</option>
        </select>
      </div>

      {error ? <div className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

      <div className="overflow-x-auto border border-slate-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Invoice</th>
              <th className="px-4 py-3">Consignee</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {dataLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading tax invoices...</td></tr>
            ) : invoices.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No tax invoices found.</td></tr>
            ) : invoices.map((invoice) => (
              <tr key={invoice._id} className="border-b border-slate-100 last:border-b-0">
                <td className="px-4 py-3">
                  <Link href={`/dashboard/tax-invoices/${invoice._id}`} className="font-semibold text-blue-900 hover:text-blue-700">
                    {invoice.invoiceNumber}
                  </Link>
                  <p className="mt-1 text-xs text-slate-500">{invoice.otherReference || "No reference"}</p>
                </td>
                <td className="px-4 py-3">{invoice.consignee.companyName || invoice.consignee.name || "Not set"}</td>
                <td className="px-4 py-3">{formatDate(invoice.invoiceDate)}</td>
                <td className="px-4 py-3 font-semibold">{formatMinorMoney(invoice.totalAmountMinor, invoice.currency)}</td>
                <td className="px-4 py-3">
                  <span className={invoice.status === "FINALIZED" ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
                    {invoice.status === "FINALIZED" ? "Finalized" : "Draft"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/dashboard/tax-invoices/${invoice._id}`} className="font-semibold text-blue-900 hover:text-blue-700">
                    View
                  </Link>
                  {invoice.status === "DRAFT" ? (
                    <button type="button" onClick={() => void handleDelete(invoice._id)} className="ml-4 font-semibold text-red-600 hover:text-red-700">
                      Delete
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TaxInvoiceShell>
  );
}
