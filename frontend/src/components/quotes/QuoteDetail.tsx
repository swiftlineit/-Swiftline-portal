"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FiCheck, FiSend, FiTruck, FiX } from "react-icons/fi";
import { toast } from "react-toastify";
import { formatDashboardDate } from "@/lib/dateFormat";
import {
  convertShipmentQuote, formatQuoteMoney, publishShipmentQuote,
  updateShipmentQuoteStatus, type QuoteAudience, type ShipmentQuote
} from "@/lib/shipmentQuotes";
import { Status } from "./QuoteList";

export default function QuoteDetail({ quote: initialQuote, audience }: { quote: ShipmentQuote; audience: QuoteAudience }) {
  const router = useRouter();
  const [quote, setQuote] = useState(initialQuote);
  const [busy, setBusy] = useState("");
  const [freight, setFreight] = useState(String((quote.estimate.freightMinor || 0) / 100));
  const [fuel, setFuel] = useState("0");
  const [addons, setAddons] = useState("0");
  const [validUntil, setValidUntil] = useState(() => {
    const value = new Date(); value.setDate(value.getDate() + 7); return value.toISOString().slice(0, 10);
  });
  const [customerNote, setCustomerNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const preview = useMemo(() => {
    const taxable = [freight, fuel, addons].reduce((sum, value) => sum + Math.max(0, Math.round((Number(value) || 0) * 100)), 0);
    const gst = Math.round(taxable * 0.18);
    return { taxable, gst, total: taxable + gst };
  }, [addons, freight, fuel]);

  async function markReview() {
    setBusy("review");
    try { setQuote((await updateShipmentQuoteStatus(quote.id, "UNDER_REVIEW")).quote); toast.success("Quote marked under review."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update the quote."); }
    finally { setBusy(""); }
  }

  async function decline() {
    if (!customerNote.trim()) { toast.error("Add a customer-facing reason before declining."); return; }
    setBusy("decline");
    try { setQuote((await updateShipmentQuoteStatus(quote.id, "DECLINED", customerNote)).quote); toast.success("Quote request declined."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to decline the quote."); }
    finally { setBusy(""); }
  }

  async function publish() {
    if (!validUntil) { toast.error("Select a validity date."); return; }
    setBusy("publish");
    try {
      setQuote((await publishShipmentQuote(quote.id, {
        freightMinor: Math.round((Number(freight) || 0) * 100),
        fuelSurchargeMinor: Math.round((Number(fuel) || 0) * 100),
        taxableAddOnsMinor: Math.round((Number(addons) || 0) * 100),
        validUntil: new Date(`${validUntil}T23:59:59+05:30`).toISOString(), customerNote, internalNote
      })).quote);
      toast.success("Shipment quote published.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to publish the quote."); }
    finally { setBusy(""); }
  }

  async function convert() {
    setBusy("convert");
    try {
      const result = await convertShipmentQuote(audience, quote.id);
      toast.success("Shipment draft created from this quote.");
      router.push(audience === "client" ? `/client/dpd-labels/${result.shipmentDraftId}` : `/dashboard/dpd-labels/${result.shipmentDraftId}`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to create the shipment draft."); }
    finally { setBusy(""); }
  }

  const canReview = audience === "admin" && ["REQUESTED", "UNDER_REVIEW"].includes(quote.status);
  const displayedPricing = quote.finalPricing;

  return (
    <div className="space-y-5">
      <section className="border border-slate-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div><p className="text-xs font-semibold uppercase text-slate-500">Shipment Quote</p><h1 className="mt-1 text-2xl font-semibold text-slate-950">{quote.quoteNumber}</h1><p className="mt-1 text-sm text-slate-500">Requested {formatDashboardDate(quote.createdAt)}</p></div>
          <Status value={quote.status} />
        </div>
        <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
          <Info label="Customer" value={quote.account?.companyName || "-"} />
          <Info label="Assigned Branch" value={quote.account ? `${quote.account.branchName} (${quote.account.branchCode})` : "-"} />
          <Info label="Route" value={`${quote.request.originCity} to ${quote.request.destinationCountryName}`} />
          <Info label="Service" value={quote.request.serviceType === "COURIER" ? "Courier" : "Cargo"} />
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="border border-slate-200 bg-white">
          <Heading title="Package Breakdown" subtitle={`${quote.request.parcels.length} box${quote.request.parcels.length === 1 ? "" : "es"} | ${quote.request.contents}`} />
          <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead className="bg-slate-100 text-xs uppercase text-slate-600"><tr><th className="px-4 py-3 text-left">Box</th><th className="px-4 py-3 text-right">Actual KG</th><th className="px-4 py-3 text-right">Volumetric KG</th><th className="px-4 py-3 text-right">Chargeable KG</th><th className="px-4 py-3 text-right">Rate / KG</th><th className="px-4 py-3 text-right">Freight</th></tr></thead><tbody className="divide-y divide-slate-200">{quote.estimate.parcels.map((parcel) => <tr key={parcel.sequence}><td className="px-4 py-4 font-semibold">{parcel.sequence}</td><td className="px-4 py-4 text-right">{parcel.actualWeightKg.toFixed(2)}</td><td className="px-4 py-4 text-right">{parcel.volumetricWeightKg.toFixed(2)}</td><td className="px-4 py-4 text-right font-semibold">{parcel.chargeableWeightKg.toFixed(2)}</td><td className="px-4 py-4 text-right">{parcel.chargesPerKg === null ? "No rate" : formatQuoteMoney(parcel.chargesPerKg * 100)}</td><td className="px-4 py-4 text-right font-semibold">{formatQuoteMoney(parcel.baseAmountMinor)}</td></tr>)}</tbody></table></div>
          <div className="grid gap-px border-t border-slate-200 bg-slate-200 sm:grid-cols-3"><Info label="Shipment Type" value={quote.request.shipmentType.replaceAll("_", " ")} /><Info label="Goods Value" value={formatQuoteMoney(quote.request.goodsValueMinor)} /><Info label="Source" value={quote.source === "CLIENT" ? "Customer Request" : "Swiftline"} /></div>
        </section>

        <aside className="space-y-5">
          <section className="border border-slate-200 bg-white">
            <Heading title={displayedPricing ? "Approved Quote" : "Rate-card Estimate"} subtitle={displayedPricing && quote.validUntil ? `Valid until ${formatDashboardDate(quote.validUntil)}` : "Initial server-calculated estimate"} />
            <div className="space-y-3 p-5 text-sm">
              <MoneyLine label="Freight" value={displayedPricing?.freightMinor ?? quote.estimate.freightMinor} />
              <MoneyLine label="Fuel Surcharge" value={displayedPricing?.fuelSurchargeMinor ?? null} />
              <MoneyLine label="Taxable Add-ons" value={displayedPricing?.taxableAddOnsMinor ?? null} />
              <MoneyLine label="GST" value={displayedPricing?.gstMinor ?? quote.estimate.gstMinor} />
              <div className="flex items-end justify-between border-t border-slate-300 pt-4"><span className="font-semibold">Total</span><span className="text-2xl font-semibold text-blue-950">{formatQuoteMoney(displayedPricing?.totalMinor ?? quote.estimate.totalMinor)}</span></div>
              {quote.customerNote ? <div className="border border-slate-200 bg-slate-50 p-3 text-slate-700">{quote.customerNote}</div> : null}
              {quote.status === "QUOTED" ? <button type="button" onClick={() => void convert()} disabled={Boolean(busy)} className="inline-flex h-11 w-full items-center justify-center gap-2 bg-blue-950 px-4 font-semibold text-white disabled:bg-slate-400"><FiTruck />{busy === "convert" ? "Creating Draft..." : "Book Shipment"}</button> : null}
              {quote.status === "CONVERTED" && quote.convertedDraftId ? <button type="button" onClick={() => router.push(audience === "client" ? `/client/dpd-labels/${quote.convertedDraftId}` : `/dashboard/dpd-labels/${quote.convertedDraftId}`)} className="h-11 w-full border border-blue-900 font-semibold text-blue-900">Open Shipment Draft</button> : null}
            </div>
          </section>
        </aside>
      </div>

      {canReview ? <section className="border border-slate-200 bg-white"><Heading title="Swiftline Review" subtitle="Enter final commercial charges and publish an immutable quote." /><div className="grid gap-4 p-5 md:grid-cols-3"><Amount label="Freight (INR)" value={freight} set={setFreight} /><Amount label="Fuel Surcharge (INR)" value={fuel} set={setFuel} /><Amount label="Taxable Add-ons (INR)" value={addons} set={setAddons} /><label><Label>Valid Until</Label><input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} className={inputClass} /></label><label className="md:col-span-2"><Label>Customer Note</Label><textarea rows={3} value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} className={`${inputClass} h-auto py-3`} placeholder="Pricing notes visible to the customer" /></label><label className="md:col-span-3"><Label>Internal Note</Label><textarea rows={2} value={internalNote} onChange={(event) => setInternalNote(event.target.value)} className={`${inputClass} h-auto py-3`} placeholder="Internal review note, not visible to customers" /></label></div><div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 bg-slate-50 px-5 py-4"><p className="font-semibold text-slate-900">Final total: {formatQuoteMoney(preview.total)} including {formatQuoteMoney(preview.gst)} GST</p><div className="flex gap-2">{quote.status === "REQUESTED" ? <button type="button" onClick={() => void markReview()} disabled={Boolean(busy)} className="inline-flex h-10 items-center gap-2 border border-slate-300 bg-white px-4 text-sm font-semibold"><FiCheck />Start Review</button> : null}<button type="button" onClick={() => void decline()} disabled={Boolean(busy)} className="inline-flex h-10 items-center gap-2 border border-red-300 bg-white px-4 text-sm font-semibold text-red-700"><FiX />Decline</button><button type="button" onClick={() => void publish()} disabled={Boolean(busy)} className="inline-flex h-10 items-center gap-2 bg-blue-950 px-4 text-sm font-semibold text-white"><FiSend />{busy === "publish" ? "Publishing..." : "Publish Quote"}</button></div></div></section> : null}
    </div>
  );
}

const inputClass = "h-11 w-full border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-900 focus:ring-1 focus:ring-blue-900";
function Label({ children }: { children: React.ReactNode }) { return <span className="mb-2 block text-xs font-semibold uppercase text-slate-600">{children}</span>; }
function Amount({ label, value, set }: { label: string; value: string; set: (value: string) => void }) { return <label><Label>{label}</Label><input type="number" min="0" step="0.01" value={value} onChange={(event) => set(event.target.value)} className={inputClass} /></label>; }
function Heading({ title, subtitle }: { title: string; subtitle: string }) { return <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-950">{title}</h2><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="bg-white px-5 py-4"><p className="text-xs font-semibold uppercase text-slate-500">{label}</p><p className="mt-2 font-semibold text-slate-950">{value}</p></div>; }
function MoneyLine({ label, value }: { label: string; value: number | null }) { return <div className="flex justify-between gap-4"><span className="text-slate-600">{label}</span><span className="font-semibold text-slate-950">{formatQuoteMoney(value)}</span></div>; }
