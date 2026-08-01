"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FiDownload, FiEye, FiFileText } from "react-icons/fi";
import {
  customsInvoicePageUrl,
  downloadCustomsInvoicePdf,
  downloadCustomsInvoiceWorkbook,
  getCustomsInvoice,
  type CustomsInvoice,
  type CustomsInvoiceAudience
} from "@/lib/customsInvoice";

/**
 * Shipment (customs) invoice panel on the shipment detail page, alongside the
 * Tax Invoices panel.
 *
 * There is no version list: this document is regenerated from the shipment each
 * time it is opened, so an amendment is reflected without a new revision.
 */
export default function CustomsInvoiceCard({
  draftId,
  audience
}: {
  draftId: string;
  audience: CustomsInvoiceAudience;
}) {
  const [invoice, setInvoice] = useState<CustomsInvoice | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"pdf" | "xlsx" | "">("");

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const result = await getCustomsInvoice(draftId, audience);
        if (mounted) setInvoice(result);
      } catch (caughtError) {
        if (mounted) {
          setError(caughtError instanceof Error ? caughtError.message : "Unable to load the shipment invoice.");
        }
      }
    }

    void load();
    return () => { mounted = false; };
  }, [audience, draftId]);

  async function handleDownload(format: "pdf" | "xlsx") {
    setBusy(format);
    setError("");
    try {
      await (format === "pdf"
        ? downloadCustomsInvoicePdf(draftId, audience)
        : downloadCustomsInvoiceWorkbook(draftId, audience));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to download the shipment invoice.");
    } finally {
      setBusy("");
    }
  }

  const itemCount = invoice?.boxes.reduce((total, box) => total + box.items.length, 0) ?? 0;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-slate-500">
            <FiFileText aria-hidden="true" className="h-4 w-4" />
            <h2 className="text-sm font-semibold uppercase tracking-wide">Shipment Invoice</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Goods declaration that travels with the shipment.
          </p>
        </div>
        {invoice ? <p className="text-sm font-semibold text-slate-700">{invoice.invoiceNumber}</p> : null}
      </div>

      {error ? (
        <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">{error}</div>
      ) : null}

      {!invoice && !error ? (
        <p className="px-5 py-5 text-sm font-medium text-slate-500">Loading shipment invoice...</p>
      ) : invoice ? (
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">Boxes</dt>
              <dd className="mt-1 font-semibold text-slate-950">{invoice.boxes.length}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">Items</dt>
              <dd className="mt-1 font-semibold text-slate-950">{itemCount}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">Declared Value</dt>
              <dd className="mt-1 font-semibold text-slate-950">
                {invoice.totalAmount.toFixed(2)} {invoice.currency}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Link
              href={customsInvoicePageUrl(draftId, audience)}
              className="inline-flex h-10 items-center gap-2 rounded-4xl border border-slate-300 px-3.5 text-sm font-semibold text-slate-700 transition hover:border-slate-500"
            >
              <FiEye aria-hidden="true" className="h-4 w-4" />View
            </Link>
            <button
              type="button"
              onClick={() => void handleDownload("xlsx")}
              disabled={Boolean(busy)}
              className="inline-flex h-10 items-center gap-2 rounded-4xl border border-emerald-700 px-3.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:border-slate-300 disabled:text-slate-400"
            >
              <FiDownload aria-hidden="true" className="h-4 w-4" />
              {busy === "xlsx" ? "Downloading..." : "Excel"}
            </button>
            <button
              type="button"
              onClick={() => void handleDownload("pdf")}
              disabled={Boolean(busy)}
              className="inline-flex h-10 items-center gap-2 rounded-4xl bg-blue-900 px-3.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:bg-slate-400"
            >
              <FiDownload aria-hidden="true" className="h-4 w-4" />
              {busy === "pdf" ? "Downloading..." : "PDF"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
