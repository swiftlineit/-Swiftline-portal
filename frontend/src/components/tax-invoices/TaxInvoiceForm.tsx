"use client";

import { useRouter } from "next/navigation";
import { cloneElement, isValidElement, useMemo, useState } from "react";
import {
  amountMinorToWords,
  computeInvoiceTotalMinor,
  computeInvoiceSubTotalMinor,
  computeTaxSummaryTotalMinor,
  createEmptyBox,
  createEmptyItem,
  createEmptyTaxSummary,
  createTaxInvoice,
  finalizeTaxInvoice,
  formatMinorMoney,
  invoiceToPayload,
  TaxInvoice,
  TaxInvoiceBox,
  TaxInvoiceItem,
  TaxInvoiceParty,
  TaxInvoicePayload,
  TaxInvoiceTaxSummary,
  updateTaxInvoice
} from "@/lib/taxInvoices";
import { downloadTaxInvoiceHtml, printTaxInvoice, TaxInvoicePreview } from "@/components/tax-invoices/TaxInvoicePreview";

type Props = {
  initialPayload: TaxInvoicePayload;
  invoice?: TaxInvoice | null;
};

const textInputClass = "h-10 min-w-0 w-full border border-[#d9d4c8] bg-white px-3 text-sm text-[#16213e] outline-none transition placeholder:text-[#8f8879] focus:border-[#16213e] focus:ring-2 focus:ring-[#16213e]/10 disabled:bg-[#f4f2ec] disabled:text-[#6b6355]";
const textAreaClass = "min-h-24 w-full border border-[#d9d4c8] bg-white px-3 py-2 text-sm text-[#16213e] outline-none transition placeholder:text-[#8f8879] focus:border-[#16213e] focus:ring-2 focus:ring-[#16213e]/10 disabled:bg-[#f4f2ec] disabled:text-[#6b6355]";
const selectClass = `${textInputClass} bg-white`;
const primaryButtonClass = "border border-[#16213e] bg-[#16213e] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0d1730] disabled:cursor-not-allowed disabled:opacity-50";
const successButtonClass = "border border-[#2f6f4f] bg-[#2f6f4f] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#255a3f] disabled:cursor-not-allowed disabled:opacity-50";
const outlineButtonClass = "border border-[#d9d4c8] bg-white px-4 py-2 text-sm font-semibold text-[#16213e] transition hover:border-[#16213e] disabled:cursor-not-allowed disabled:opacity-50";
const ghostAddClass = "border border-[#16213e] px-4 py-2 text-sm font-semibold text-[#16213e] transition hover:bg-[#16213e] hover:text-white";
const removeLinkClass = "text-sm font-semibold text-[#b3261e] transition hover:text-[#8a1c17]";
const thinScrollbarClass = "[scrollbar-width:thin] [scrollbar-color:#b8b0a2_transparent] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#b8b0a2]";

function rupeesToMinor(value: string) {
  const normalized = Number(value || 0);
  if (!Number.isFinite(normalized)) return 0;
  return Math.max(0, Math.round(normalized * 100));
}

function minorToRupees(value: number) {
  return value ? String(value / 100) : "";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const child = isValidElement<{ placeholder?: string; "aria-label"?: string }>(children)
    ? cloneElement(children, {
        placeholder: children.props.placeholder ?? label,
        "aria-label": children.props["aria-label"] ?? label
      })
    : children;

  return (
    <label className="block">
      {child}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-[#d9d4c8] bg-white p-5 shadow-sm">
      <h2 className="mb-5 border-b border-[#efece3] pb-3 text-xs font-bold uppercase tracking-[0.08em] text-[#9c6b2f]">{title}</h2>
      {children}
    </section>
  );
}

export default function TaxInvoiceForm({ initialPayload, invoice }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<TaxInvoicePayload>(initialPayload);
  const [saving, setSaving] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [amountWordsTouched, setAmountWordsTouched] = useState(Boolean(initialPayload.amountInWords));
  const [taxWordsTouched, setTaxWordsTouched] = useState(Boolean(initialPayload.taxAmountInWords));
  const isFinalized = invoice?.status === "FINALIZED";
  const subTotalMinor = useMemo(() => computeInvoiceSubTotalMinor(form.boxes), [form.boxes]);
  const taxTotalMinor = useMemo(() => computeTaxSummaryTotalMinor(form.taxSummary), [form.taxSummary]);
  const totalMinor = useMemo(() => computeInvoiceTotalMinor(form.boxes, form.taxSummary), [form.boxes, form.taxSummary]);
  const amountInWords = isFinalized || amountWordsTouched
    ? form.amountInWords
    : amountMinorToWords(totalMinor, form.currency);
  const taxAmountInWords = isFinalized || taxWordsTouched
    ? form.taxAmountInWords
    : taxTotalMinor > 0
      ? amountMinorToWords(taxTotalMinor, form.currency)
      : "";
  const invoicePreviewPayload = useMemo(() => ({
    ...form,
    amountInWords,
    taxAmountInWords
  }), [amountInWords, form, taxAmountInWords]);

  function updateField<K extends keyof TaxInvoicePayload>(key: K, value: TaxInvoicePayload[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateParty(party: "shipper" | "consignee", key: keyof TaxInvoiceParty, value: string) {
    setForm((current) => ({
      ...current,
      [party]: { ...current[party], [key]: value }
    }));
  }

  function updateBox(boxIndex: number, update: Partial<TaxInvoiceBox>) {
    setForm((current) => ({
      ...current,
      boxes: current.boxes.map((box, index) => index === boxIndex ? { ...box, ...update } : box)
    }));
  }

  function updateBoxDimension(boxIndex: number, key: keyof TaxInvoiceBox["dimensions"], value: string) {
    setForm((current) => ({
      ...current,
      boxes: current.boxes.map((box, index) => index === boxIndex
        ? {
            ...box,
            dimensions: {
              ...box.dimensions,
              [key]: key === "unit" ? value : value === "" ? null : Number(value)
            }
          }
        : box)
    }));
  }

  function updateItem(boxIndex: number, itemIndex: number, key: keyof TaxInvoiceItem, value: string) {
    setForm((current) => ({
      ...current,
      boxes: current.boxes.map((box, currentBoxIndex) => currentBoxIndex === boxIndex
        ? {
            ...box,
            items: box.items.map((item, currentItemIndex) => currentItemIndex === itemIndex
              ? {
                  ...item,
                  [key]: key === "quantity"
                    ? Number(value || 0)
                    : key === "unitRateMinor"
                      ? rupeesToMinor(value)
                      : value
                }
              : item)
          }
        : box)
    }));
  }

  function addBox() {
    setForm((current) => ({ ...current, boxes: [...current.boxes, createEmptyBox(current.boxes.length + 1)] }));
  }

  function removeBox(boxIndex: number) {
    setForm((current) => ({ ...current, boxes: current.boxes.filter((_, index) => index !== boxIndex) }));
  }

  function addItem(boxIndex: number) {
    setForm((current) => ({
      ...current,
      boxes: current.boxes.map((box, index) => index === boxIndex ? { ...box, items: [...box.items, createEmptyItem()] } : box)
    }));
  }

  function removeItem(boxIndex: number, itemIndex: number) {
    setForm((current) => ({
      ...current,
      boxes: current.boxes.map((box, index) => index === boxIndex
        ? { ...box, items: box.items.filter((_, currentItemIndex) => currentItemIndex !== itemIndex) }
        : box)
    }));
  }

  function updateTaxSummary(rowIndex: number, key: keyof TaxInvoiceTaxSummary, value: string) {
    setForm((current) => ({
      ...current,
      taxSummary: current.taxSummary.map((row, index) => index === rowIndex
        ? {
            ...row,
            [key]: key === "hsnSac" || key === "gstType"
              ? value
              : key === "gstRatePercent"
                ? Number(value || 0)
                : rupeesToMinor(value)
          }
        : row)
    }));
  }

  function addTaxSummaryRow() {
    setForm((current) => ({ ...current, taxSummary: [...current.taxSummary, createEmptyTaxSummary()] }));
  }

  function removeTaxSummaryRow(rowIndex: number) {
    setForm((current) => ({ ...current, taxSummary: current.taxSummary.filter((_, index) => index !== rowIndex) }));
  }

  async function handleSave() {
    const invalidGstinParty = (["shipper", "consignee"] as const).find((party) => {
      const gstinUin = form[party].gstinUin.trim().toUpperCase();
      return gstinUin && !/^[0-9A-Z]{15}$/.test(gstinUin);
    });
    if (invalidGstinParty) {
      setError(`${invalidGstinParty === "shipper" ? "Shipper" : "Consignee"} GSTIN/UIN must contain 15 letters and numbers.`);
      return;
    }

    const invalidStateCodeParty = (["shipper", "consignee"] as const).find((party) => {
      const stateCode = form[party].stateCode.trim();
      return stateCode && !/^\d{2}$/.test(stateCode);
    });
    if (invalidStateCodeParty) {
      setError(`${invalidStateCodeParty === "shipper" ? "Shipper" : "Consignee"} state code must contain 2 digits.`);
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const result = invoice
        ? await updateTaxInvoice(invoice._id, invoicePreviewPayload)
        : await createTaxInvoice(invoicePreviewPayload);

      setNotice("Draft saved.");
      if (!invoice) router.replace(`/dashboard/tax-invoices/${result.invoice._id}`);
      else setForm(invoiceToPayload(result.invoice));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to save invoice.");
    } finally {
      setSaving(false);
    }
  }

  async function handleFinalize() {
    if (!invoice) {
      setError("Save the draft before finalizing.");
      return;
    }

    setFinalizing(true);
    setError("");
    setNotice("");

    try {
      await updateTaxInvoice(invoice._id, form);
      const result = await finalizeTaxInvoice(invoice._id);
      setNotice("Invoice finalized.");
      router.replace(`/dashboard/tax-invoices/${result.invoice._id}`);
      router.refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to finalize invoice.");
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <div className="grid gap-6 bg-[#f4f2ec] 2xl:grid-cols-[minmax(0,1fr)_620px]">
      <div className="space-y-5">
        {error ? <div className="border border-[#e3b4ae] bg-[#fbebe9] px-4 py-3 text-sm font-semibold text-[#8a1c17]">{error}</div> : null}
        {notice ? <div className="border border-[#b7d6c4] bg-[#eaf5ef] px-4 py-3 text-sm font-semibold text-[#255a3f]">{notice}</div> : null}

        <Section title="Invoice Header">
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            <Field label="Invoice Number">
              <input disabled={isFinalized} value={form.invoiceNumber} onChange={(event) => updateField("invoiceNumber", event.target.value)} placeholder="Auto on save" className={`${textInputClass} font-mono`} />
            </Field>
            <Field label="Invoice Date">
              <input disabled={isFinalized} type="date" value={form.invoiceDate} onChange={(event) => updateField("invoiceDate", event.target.value)} className={textInputClass} />
            </Field>
            <Field label="Other Reference">
              <input disabled={isFinalized} value={form.otherReference} onChange={(event) => updateField("otherReference", event.target.value)} className={textInputClass} />
            </Field>
          </div>
        </Section>

        <Section title="Invoice And Dispatch Details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mode / Terms Of Payment">
              <input disabled={isFinalized} value={form.paymentTerms} onChange={(event) => updateField("paymentTerms", event.target.value)} className={textInputClass} />
            </Field>
            <Field label="Buyer Order Number">
              <input disabled={isFinalized} value={form.buyerOrderNumber} onChange={(event) => updateField("buyerOrderNumber", event.target.value)} className={textInputClass} />
            </Field>
            <Field label="Dispatch Document Number">
              <input disabled={isFinalized} value={form.dispatchDocumentNumber} onChange={(event) => updateField("dispatchDocumentNumber", event.target.value)} className={textInputClass} />
            </Field>
            <Field label="Dispatched Through">
              <input disabled={isFinalized} value={form.dispatchedThrough} onChange={(event) => updateField("dispatchedThrough", event.target.value)} className={textInputClass} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Terms Of Delivery">
                <textarea disabled={isFinalized} value={form.termsOfDelivery} onChange={(event) => updateField("termsOfDelivery", event.target.value)} rows={3} className={textAreaClass} />
              </Field>
            </div>
          </div>
        </Section>

        <Section title="Shipper And Consignee">
          <div className="grid gap-5 lg:grid-cols-2">
            {(["shipper", "consignee"] as const).map((party) => (
              <div key={party} className="space-y-3 border border-[#efece3] p-4">
                <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[#16213e]">{party}</h3>
                <Field label="Name">
                  <input disabled={isFinalized} value={form[party].name} onChange={(event) => updateParty(party, "name", event.target.value)} className={textInputClass} />
                </Field>
                <Field label="Company Name">
                  <input disabled={isFinalized} value={form[party].companyName} onChange={(event) => updateParty(party, "companyName", event.target.value)} className={textInputClass} />
                </Field>
                <Field label="GSTIN / UIN">
                  <input disabled={isFinalized} value={form[party].gstinUin} maxLength={15} onChange={(event) => updateParty(party, "gstinUin", event.target.value.toUpperCase())} className={`${textInputClass} font-mono uppercase`} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
                  <Field label="State">
                    <input disabled={isFinalized} value={form[party].state} onChange={(event) => updateParty(party, "state", event.target.value)} className={textInputClass} />
                  </Field>
                  <Field label="State Code">
                    <input disabled={isFinalized} inputMode="numeric" maxLength={2} value={form[party].stateCode} onChange={(event) => updateParty(party, "stateCode", event.target.value.replace(/\D/g, "").slice(0, 2))} className={`${textInputClass} font-mono`} />
                  </Field>
                </div>
                <Field label="Address">
                  <textarea disabled={isFinalized} value={form[party].address} onChange={(event) => updateParty(party, "address", event.target.value)} className={textAreaClass} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Email">
                    <input disabled={isFinalized} type="email" value={form[party].email} onChange={(event) => updateParty(party, "email", event.target.value)} className={textInputClass} />
                  </Field>
                  <Field label="Phone">
                    <input disabled={isFinalized} value={form[party].phone} onChange={(event) => updateParty(party, "phone", event.target.value)} className={textInputClass} />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Shipment And Declaration">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Shipper ID Type">
              <select disabled={isFinalized} value={form.shipperIdType} onChange={(event) => updateField("shipperIdType", event.target.value)} className={selectClass}>
                <option value="">Select ID Type</option>
                <option value="Aadhaar">Aadhaar</option>
                <option value="PAN">PAN</option>
                <option value="GSTIN/UIN">GSTIN/UIN</option>
              </select>
            </Field>
            <Field label="Shipper ID Number">
              <input disabled={isFinalized} value={form.shipperIdNumber} onChange={(event) => updateField("shipperIdNumber", event.target.value)} className={`${textInputClass} font-mono`} />
            </Field>
            <Field label="Country Of Origin">
              <input disabled={isFinalized} value={form.countryOfOrigin} onChange={(event) => updateField("countryOfOrigin", event.target.value)} className={textInputClass} />
            </Field>
            <Field label="Destination Country">
              <input disabled={isFinalized} value={form.destinationCountry} onChange={(event) => updateField("destinationCountry", event.target.value)} className={textInputClass} />
            </Field>
            <Field label="Currency">
              <input disabled={isFinalized} value={form.currency} onChange={(event) => updateField("currency", event.target.value.toUpperCase())} className={`${textInputClass} font-mono uppercase`} />
            </Field>
          </div>
          <div className="mt-4">
            <Field label="Declaration Note">
              <textarea disabled={isFinalized} value={form.declarationNote} onChange={(event) => updateField("declarationNote", event.target.value)} className={textAreaClass} />
            </Field>
          </div>
        </Section>

        <Section title="Boxes And Items">
          <div className="space-y-5">
            {form.boxes.map((box, boxIndex) => (
              <div key={`${box.boxNumber}-${boxIndex}`} className="border border-[#d9d4c8]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d9d4c8] bg-[#faf9f5] px-4 py-3">
                  <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[#16213e]">Box {boxIndex + 1}</h3>
                  {!isFinalized && form.boxes.length > 1 ? (
                    <button type="button" onClick={() => removeBox(boxIndex)} className={removeLinkClass}>Remove Box</button>
                  ) : null}
                </div>

                <div className={`${thinScrollbarClass} overflow-x-auto`}>
                  <div className="min-w-260">
                    <div className="grid grid-cols-[150px_130px_130px_130px_110px_170px_130px] gap-3 p-4">
                      <Field label="Box Number">
                        <input disabled={isFinalized} value={box.boxNumber} onChange={(event) => updateBox(boxIndex, { boxNumber: event.target.value })} className={textInputClass} />
                      </Field>
                      <Field label="Length">
                        <input disabled={isFinalized} type="number" min="0" value={box.dimensions.length ?? ""} onChange={(event) => updateBoxDimension(boxIndex, "length", event.target.value)} className={textInputClass} />
                      </Field>
                      <Field label="Width">
                        <input disabled={isFinalized} type="number" min="0" value={box.dimensions.width ?? ""} onChange={(event) => updateBoxDimension(boxIndex, "width", event.target.value)} className={textInputClass} />
                      </Field>
                      <Field label="Height">
                        <input disabled={isFinalized} type="number" min="0" value={box.dimensions.height ?? ""} onChange={(event) => updateBoxDimension(boxIndex, "height", event.target.value)} className={textInputClass} />
                      </Field>
                      <Field label="Unit">
                        <input disabled={isFinalized} value={box.dimensions.unit} onChange={(event) => updateBoxDimension(boxIndex, "unit", event.target.value)} className={textInputClass} />
                      </Field>
                      <Field label="Actual Weight">
                        <input disabled={isFinalized} type="number" min="0" value={box.actualWeight ?? ""} onChange={(event) => updateBox(boxIndex, { actualWeight: event.target.value === "" ? null : Number(event.target.value) })} className={textInputClass} />
                      </Field>
                      <Field label="Weight Unit">
                        <input disabled={isFinalized} value={box.weightUnit} onChange={(event) => updateBox(boxIndex, { weightUnit: event.target.value })} className={textInputClass} />
                      </Field>
                    </div>

                    <div className="border-t border-[#d9d4c8]">
                      <table className="w-full table-fixed border-collapse text-left text-sm">
                    <colgroup>
                      <col style={{ width: "32%" }} />
                      <col style={{ width: "15%" }} />
                      <col style={{ width: "9%" }} />
                      <col style={{ width: "11%" }} />
                      <col style={{ width: "13%" }} />
                      <col style={{ width: "14%" }} />
                      <col style={{ width: "6%" }} />
                    </colgroup>
                    <thead className="bg-[#16213e] text-[10px] uppercase tracking-wider text-white">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Description</th>
                        <th className="px-3 py-2 font-semibold">HS Code</th>
                        <th className="px-3 py-2 text-right font-semibold">Qty</th>
                        <th className="px-3 py-2 font-semibold">Unit</th>
                        <th className="px-3 py-2 text-right font-semibold">Rate</th>
                        <th className="px-3 py-2 text-right font-semibold">Amount</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {box.items.map((item, itemIndex) => (
                        <tr key={`${boxIndex}-${itemIndex}`} className="border-t border-[#efece3]">
                          <td className="px-3 py-2"><input disabled={isFinalized} value={item.description} onChange={(event) => updateItem(boxIndex, itemIndex, "description", event.target.value)} className={textInputClass} /></td>
                          <td className="px-3 py-2"><input disabled={isFinalized} value={item.hsCode} onChange={(event) => updateItem(boxIndex, itemIndex, "hsCode", event.target.value)} className={`${textInputClass} font-mono`} /></td>
                          <td className="px-3 py-2"><input disabled={isFinalized} type="number" min="0" value={item.quantity} onChange={(event) => updateItem(boxIndex, itemIndex, "quantity", event.target.value)} className={`${textInputClass} text-right`} /></td>
                          <td className="px-3 py-2"><input disabled={isFinalized} value={item.unitType} onChange={(event) => updateItem(boxIndex, itemIndex, "unitType", event.target.value)} className={textInputClass} /></td>
                          <td className="px-3 py-2"><input disabled={isFinalized} type="number" min="0" step="0.01" value={minorToRupees(item.unitRateMinor)} onChange={(event) => updateItem(boxIndex, itemIndex, "unitRateMinor", event.target.value)} className={`${textInputClass} text-right`} /></td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-[#16213e]">{formatMinorMoney((item.quantity || 0) * (item.unitRateMinor || 0), form.currency)}</td>
                          <td className="px-3 py-2 text-right">
                            {!isFinalized && box.items.length > 1 ? (
                              <button type="button" onClick={() => removeItem(boxIndex, itemIndex)} className={removeLinkClass}>Remove</button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {!isFinalized ? (
                  <div className="border-t border-[#d9d4c8] p-3">
                    <button type="button" onClick={() => addItem(boxIndex)} className="text-sm font-semibold text-[#16213e] hover:text-[#9c6b2f]">+ Add Item</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {!isFinalized ? (
            <button type="button" onClick={addBox} className={`${ghostAddClass} mt-4`}>+ Add Box</button>
          ) : null}
        </Section>

        <Section title="Tax Details">
          <div className="overflow-x-auto border border-[#d9d4c8]">
              <table className="w-full min-w-160 table-fixed border-collapse text-left text-sm">
              <colgroup>
                <col style={{ width: "18%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "18%" }} />
                <col style={{ width: "8%" }} />
              </colgroup>
              <thead className="bg-[#16213e] text-[10px] uppercase tracking-wider text-white">
                <tr>
                  <th className="px-3 py-2 font-semibold">GST Type</th>
                  <th className="px-3 py-2 font-semibold">HSN/SAC</th>
                  <th className="px-3 py-2 text-right font-semibold">Taxable Value</th>
                  <th className="px-3 py-2 text-right font-semibold">GST Rate %</th>
                  <th className="px-3 py-2 text-right font-semibold">Tax Amount</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {form.taxSummary.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-t border-[#efece3]">
                    <td className="px-3 py-2">
                      <select disabled={isFinalized} value={row.gstType} onChange={(event) => updateTaxSummary(rowIndex, "gstType", event.target.value)} className={selectClass}>
                        <option value="CGST">CGST</option>
                        <option value="SGST">SGST</option>
                        <option value="IGST">IGST</option>
                        <option value="UTGST">UTGST</option>
                      </select>
                    </td>
                    <td className="px-3 py-2"><input disabled={isFinalized} value={row.hsnSac} onChange={(event) => updateTaxSummary(rowIndex, "hsnSac", event.target.value)} className={`${textInputClass} font-mono`} /></td>
                    <td className="px-3 py-2"><input disabled={isFinalized} type="number" min="0" step="0.01" value={minorToRupees(row.taxableValueMinor)} onChange={(event) => updateTaxSummary(rowIndex, "taxableValueMinor", event.target.value)} className={textInputClass} /></td>
                    <td className="px-3 py-2"><input disabled={isFinalized} type="number" min="0" step="0.01" value={row.gstRatePercent || ""} onChange={(event) => updateTaxSummary(rowIndex, "gstRatePercent", event.target.value)} className={`${textInputClass} text-right`} /></td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-[#16213e]">{formatMinorMoney(Math.round((row.taxableValueMinor || 0) * (row.gstRatePercent || 0) / 100), form.currency)}</td>
                    <td className="px-3 py-2 text-right">
                      {!isFinalized && form.taxSummary.length > 1 ? (
                        <button type="button" onClick={() => removeTaxSummaryRow(rowIndex)} className={removeLinkClass}>Remove</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!isFinalized ? (
            <button type="button" onClick={addTaxSummaryRow} className={`${ghostAddClass} mt-3`}>+ Add Tax Row</button>
          ) : null}
        </Section>

        <Section title="Totals And Notes">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-4">
              <Field label="Amount In Words">
                <textarea
                  disabled={isFinalized}
                  value={amountInWords}
                  onChange={(event) => {
                    setAmountWordsTouched(true);
                    updateField("amountInWords", event.target.value);
                  }}
                  rows={3}
                  className={textAreaClass}
                />
              </Field>

              <Field label="Tax Amount In Words">
                <textarea
                  disabled={isFinalized}
                  value={taxAmountInWords}
                  onChange={(event) => {
                    setTaxWordsTouched(true);
                    updateField("taxAmountInWords", event.target.value);
                  }}
                  rows={3}
                  className={textAreaClass}
                />
              </Field>

              <Field label="Notes">
                <textarea
                  disabled={isFinalized}
                  value={form.notes}
                  onChange={(event) => updateField("notes", event.target.value)}
                  rows={4}
                  className={textAreaClass}
                />
              </Field>
            </div>

            <aside className="h-fit border border-[#16213e]">
              <div className="border-b border-[#efece3] bg-[#faf9f5] px-4 py-3">
                <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[#9c6b2f]">Invoice Summary</h3>
                <p className="mt-1 text-xs text-[#6b6355]">Calculated from line items</p>
              </div>

              <div className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-[#6b6355]">Subtotal</span>
                  <span className="font-mono font-semibold text-[#16213e]">{formatMinorMoney(subTotalMinor, form.currency)}</span>
                </div>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-[#6b6355]">Tax</span>
                  <span className="font-mono font-semibold text-[#16213e]">{formatMinorMoney(taxTotalMinor, form.currency)}</span>
                </div>
              </div>

              <div className="bg-[#16213e] px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[#c9c2b2]">Grand Total</p>
                <p className="mt-1 font-mono text-2xl font-bold text-white">{formatMinorMoney(totalMinor, form.currency)}</p>
              </div>
            </aside>
          </div>
        </Section>
      </div>

      <aside className="space-y-4">
        <div className="sticky top-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border border-[#d9d4c8] bg-white p-4">
            <div>
              <p className="text-sm font-semibold text-[#16213e]">Invoice Preview</p>
              <p className="text-xs text-[#6b6355]">Print or download this formatted invoice.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => printTaxInvoice(invoicePreviewPayload)} className={outlineButtonClass}>Print</button>
              <button type="button" onClick={() => downloadTaxInvoiceHtml(invoicePreviewPayload)} className={outlineButtonClass}>Download</button>
              {!isFinalized ? (
                <>
                  <button type="button" onClick={handleSave} disabled={saving || finalizing} className={primaryButtonClass}>{saving ? "Saving..." : "Save Draft"}</button>
                  <button type="button" onClick={handleFinalize} disabled={saving || finalizing} className={successButtonClass}>{finalizing ? "Finalizing..." : "Finalize"}</button>
                </>
              ) : null}
            </div>
          </div>
          <TaxInvoicePreview invoice={invoicePreviewPayload} />
        </div>
      </aside>
    </div>
  );
}
