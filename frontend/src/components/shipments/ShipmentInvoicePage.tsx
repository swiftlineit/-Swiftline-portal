"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { FiDownload, FiPrinter } from "react-icons/fi";
import {
  downloadShipmentInvoicePdf,
  getShipmentInvoice,
  ShipmentInvoice,
  ShipmentInvoiceAudience,
  ShipmentInvoiceParcel
} from "@/lib/shipmentInvoices";

function money(minor: number, currency: string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);
}

function date(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value)).replaceAll("/", "-");
}

function value(record: Record<string, unknown>, key: string) {
  const current = record[key];
  return typeof current === "string" && current.trim() ? current : "Not provided";
}

export default function ShipmentInvoicePage({ draftId, audience }: { draftId: string; audience: ShipmentInvoiceAudience }) {
  const [invoice, setInvoice] = useState<ShipmentInvoice | null>(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const searchParams = new URLSearchParams(window.location.search);
        const revisionValue = searchParams.get("revision");
        const requestedRevision = revisionValue && /^\d+$/.test(revisionValue)
          ? Number(revisionValue)
          : undefined;
        const result = await getShipmentInvoice(draftId, audience, requestedRevision);
        setInvoice(result);
        if (searchParams.get("print") === "1") {
          window.setTimeout(() => window.print(), 500);
        }
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load shipment invoice.");
      }
    }
    void load();
  }, [audience, draftId]);

  async function downloadPdf() {
    if (!invoice) return;
    setDownloading(true);
    setError("");
    try {
      await downloadShipmentInvoicePdf(draftId, audience, invoice.invoiceNumber, invoice.revision);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to download shipment invoice PDF.");
    } finally {
      setDownloading(false);
    }
  }

  if (error && !invoice) return <main className="mx-auto mt-12 max-w-3xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">{error}</main>;
  if (!invoice) return <main className="mx-auto mt-12 max-w-3xl border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-500">Loading shipment invoice...</main>;

  const parcels = invoice.shipment.parcels ?? [];

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 print:bg-white print:p-0">
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-600">
          {invoice.invoiceNumber} | Invoice {invoice.revision} of {invoice.versions.length}
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={() => window.print()} className="inline-flex h-10 items-center gap-2 border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:border-slate-500"><FiPrinter aria-hidden="true" />Print</button>
          <button type="button" onClick={() => void downloadPdf()} disabled={downloading} className="inline-flex h-10 items-center gap-2 bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:bg-slate-400"><FiDownload aria-hidden="true" />{downloading ? "Downloading..." : "Download PDF"}</button>
        </div>
      </div>

      {error ? <div className="no-print mx-auto mb-4 max-w-[210mm] border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

      <article className="invoice-sheet relative mx-auto min-h-[297mm] max-w-[210mm] bg-white p-10 text-slate-950 shadow-sm print:min-h-0 print:max-w-none print:p-0 print:shadow-none">
        {invoice.status === "DRAFT" ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-7xl font-bold text-red-600 opacity-[0.06] -rotate-45">DRAFT</div> : null}
        <header className="relative flex items-start justify-between gap-8 border-b-2 border-slate-950 pb-5">
          <Image src="/swiftline-invoice-logo.jpeg" alt="Swiftline Cargo and Express Logistics" width={224} height={64} priority className="h-16 w-56 object-contain object-left" />
          <div className="text-right">
            <h1 className="text-xl font-bold">{invoice.status === "ISSUED" ? "TAX INVOICE" : "DRAFT TAX INVOICE"}</h1>
            <p className="mt-3 text-xs"><strong>Invoice No:</strong> {invoice.invoiceNumber}</p>
            <p className="mt-1 text-xs"><strong>Version:</strong> Invoice {invoice.revision}</p>
            <p className="mt-1 text-xs"><strong>Date:</strong> {date(invoice.issuedAt)}</p>
            <p className="mt-1 text-xs"><strong>Reference:</strong> {value(invoice.shipment, "shipmentReference")}</p>
          </div>
        </header>

        {invoice.validationWarnings.length ? <section className="relative mt-4 border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{invoice.validationWarnings.join(" ")}</section> : null}

        <section className="relative mt-5 grid grid-cols-2 gap-4">
          <Party title="Supplier / Shipper Branch" name={value(invoice.supplier, "legalName")} address={value(invoice.supplier, "address")} gstin={value(invoice.supplier, "gstin")} email={value(invoice.supplier, "email")} phone={value(invoice.supplier, "phone")} />
          <Party title="Bill To / Customer" name={value(invoice.customer, "companyName")} address={value(invoice.customer, "billingAddress")} gstin={value(invoice.customer, "gstin")} email={value(invoice.customer, "email")} phone={value(invoice.customer, "phone")} />
        </section>

        <section className="relative mt-5 grid grid-cols-4 gap-3 text-xs">
          <Meta label="Origin" text={value(invoice.shipment, "origin")} />
          <Meta label="Destination" text={value(invoice.shipment, "destination")} />
          <Meta label="Currency" text={invoice.currency} />
          <Meta label="Boxes" text={String(parcels.length)} />
        </section>

        <section className="relative mt-5 overflow-hidden border border-slate-950">
          <div className="grid grid-cols-[1.8fr_repeat(5,1fr)] bg-slate-100 text-center text-[10px] font-bold uppercase text-slate-700">
            <div className="border-r border-slate-950 px-3 py-2">Description</div>
            <div className="border-r border-slate-950 px-2 py-2">Actual KG</div>
            <div className="border-r border-slate-950 px-2 py-2">Volumetric KG</div>
            <div className="border-r border-slate-950 px-2 py-2">Chargeable KG</div>
            <div className="border-r border-slate-950 px-2 py-2">Rate / KG</div>
            <div className="px-3 py-2">Amount</div>
          </div>
          {parcels.map((parcel) => (
            <div key={parcel.sequence} className="border-t border-slate-950">
              <div className="bg-white px-3 py-2 text-center text-[11px] font-bold uppercase">
                Box {parcel.sequence} | Dimensions: {formatDimensions(parcel)}
              </div>
              <div className="grid grid-cols-[1.8fr_repeat(5,1fr)] border-t border-slate-950 text-center text-[11px]">
                <div className="border-r border-slate-950 px-3 py-3 font-semibold uppercase">{parcel.contentsDescription || "Shipment goods"}</div>
                <div className="border-r border-slate-950 px-2 py-3">{parcel.actualWeightKg.toFixed(3)}</div>
                <div className="border-r border-slate-950 px-2 py-3">{parcel.volumetricWeightKg.toFixed(3)}</div>
                <div className="border-r border-slate-950 px-2 py-3 font-semibold">{parcel.chargeableWeightKg.toFixed(3)}</div>
                <div className="border-r border-slate-950 px-2 py-3">{parcel.chargesPerKg === null ? "-" : money(Math.round(parcel.chargesPerKg * 100), invoice.currency)}</div>
                <div className="px-3 py-3 font-semibold">{money(Math.round(parcel.baseAmount * 100), invoice.currency)}</div>
              </div>
            </div>
          ))}
        </section>

        <section className="relative grid grid-cols-[1fr_280px] border-x border-b border-slate-950 text-xs">
          <div className="p-4"><p className="font-semibold uppercase text-slate-500">Delivery Address</p><p className="mt-2 leading-5">{value(invoice.shipment, "deliveryAddress")}</p></div>
          <div className="border-l border-slate-950">
            <Total label="Taxable Value" amount={invoice.taxableValueMinor} currency={invoice.currency} />
            {invoice.taxType === "CGST_SGST" ? <><Total label={`CGST ${invoice.gstRatePercent / 2}%`} amount={invoice.cgstAmountMinor} currency={invoice.currency} /><Total label={`SGST ${invoice.gstRatePercent / 2}%`} amount={invoice.sgstAmountMinor} currency={invoice.currency} /></> : <Total label={`IGST ${invoice.gstRatePercent}%`} amount={invoice.igstAmountMinor} currency={invoice.currency} />}
            <Total label="Total Chargeable" amount={invoice.totalAmountMinor} currency={invoice.currency} strong />
          </div>
        </section>

        <footer className="relative mt-8 flex items-end justify-between border-t border-slate-300 pt-5 text-xs">
          <div className="max-w-sm"><p className="font-semibold">Declaration</p><p className="mt-2 leading-5 text-slate-600">We declare that this invoice records the shipment charges and applicable taxes shown above.</p></div>
          <div className="text-right"><p className="font-semibold">For Swiftline Cargo and Express Logistics Pvt. Ltd.</p><p className="mt-10 border-t border-slate-500 pt-2">Authorised Signatory</p></div>
        </footer>
        <p className="relative mt-8 border-t border-slate-300 pt-3 text-center text-[10px] font-semibold text-slate-500">This is a computer generated invoice from Swiftline Portal.</p>
      </article>

      <style jsx global>{`@page { size: A4 portrait; margin: 10mm; } @media print { .no-print { display: none !important; } body { background: white !important; } .invoice-sheet { width: 190mm; } }`}</style>
    </main>
  );
}

function Party({ title, name, address, gstin, email, phone }: { title: string; name: string; address: string; gstin: string; email: string; phone: string }) {
  return <div className="min-h-36 border border-slate-300 p-4 text-xs"><p className="font-semibold uppercase text-slate-500">{title}</p><p className="mt-3 text-sm font-bold">{name}</p><p className="mt-2 leading-5">{address}</p><p className="mt-2 font-semibold">GSTIN: {gstin}</p><p className="mt-1 text-slate-600">{email} | {phone}</p></div>;
}

function Meta({ label, text }: { label: string; text: string }) {
  return <div className="border border-slate-300 p-3"><p className="font-semibold uppercase text-slate-500">{label}</p><p className="mt-2 font-semibold">{text}</p></div>;
}

function formatDimensions(parcel: ShipmentInvoiceParcel) {
  if (!parcel.lengthCm || !parcel.widthCm || !parcel.heightCm) return "Not provided";
  return `${parcel.lengthCm.toFixed(2)} x ${parcel.widthCm.toFixed(2)} x ${parcel.heightCm.toFixed(2)} CM`;
}

function Total({ label, amount, currency, strong = false }: { label: string; amount: number; currency: string; strong?: boolean }) {
  return <div className={`flex justify-between gap-3 border-b border-slate-300 px-4 py-3 last:border-b-0 ${strong ? "bg-slate-100 text-sm font-bold" : ""}`}><span>{label}</span><span>{money(amount, currency)}</span></div>;
}
