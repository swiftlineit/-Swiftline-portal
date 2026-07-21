"use client";

import {
  computeInvoiceSubTotalMinor,
  computeInvoiceTotalMinor,
  computeTaxSummaryTotalMinor,
  TaxInvoicePayload
} from "@/lib/taxInvoices";

const logoPath = "/swiftline-invoice-logo.jpeg";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function formatDimensions(box: TaxInvoicePayload["boxes"][number]) {
  const { length, width, height, unit } = box.dimensions;
  if (!length && !width && !height) return "-";
  return `${Number(length ?? 0).toFixed(2)} * ${Number(width ?? 0).toFixed(2)} * ${Number(height ?? 0).toFixed(2)} ${unit.toUpperCase()}`;
}

function inlineAddress(address: string) {
  return address.split("\n").filter(Boolean).join("<br />");
}

function formatMinorNumber(value: number) {
  return ((value || 0) / 100).toFixed(2);
}

function hasTaxRow(invoice: TaxInvoicePayload) {
  return invoice.taxSummary.some((row) => row.hsnSac || row.taxableValueMinor || row.gstRatePercent);
}

type RenderMode = "preview" | "document";

export function renderTaxInvoiceHtml(invoice: TaxInvoicePayload, logoUrl: string, mode: RenderMode = "document") {
  const subTotalMinor = computeInvoiceSubTotalMinor(invoice.boxes);
  const taxTotalMinor = computeTaxSummaryTotalMinor(invoice.taxSummary);
  const totalMinor = computeInvoiceTotalMinor(invoice.boxes, invoice.taxSummary);
  const itemColumnGroup = `
    <colgroup>
      <col style="width:5%" />
      <col style="width:39%" />
      <col style="width:15%" />
      <col style="width:10%" />
      <col style="width:7%" />
      <col style="width:12%" />
      <col style="width:12%" />
    </colgroup>
  `;
  const taxColumnGroup = `
    <colgroup>
      <col style="width:20%" />
      <col style="width:16%" />
      <col style="width:24%" />
      <col style="width:16%" />
      <col style="width:24%" />
    </colgroup>
  `;
  const boxTables = invoice.boxes.map((box) => {
    const rows = box.items.map((item, itemIndex) => {
      const amountMinor = (item.quantity || 0) * (item.unitRateMinor || 0);

      return `
        <tr>
          <td class="col-serial center">${itemIndex + 1}</td>
          <td class="col-description">${escapeHtml((item.description || "-").toUpperCase())}</td>
          <td class="col-hsn center">${escapeHtml(item.hsCode || "-")}</td>
          <td class="col-unit center">${escapeHtml(item.unitType || "PCS")}</td>
          <td class="col-qty right">${item.quantity || 0}</td>
          <td class="col-rate right">${formatMinorNumber(item.unitRateMinor || 0)}</td>
          <td class="col-amount right">${formatMinorNumber(amountMinor)}</td>
        </tr>
      `;
    }).join("");

    return `
      <table class="box-table">
        ${itemColumnGroup}
        <tbody>
          <tr>
            <td colspan="7" class="box-heading">
              BOX NO: ${escapeHtml(box.boxNumber || "-")} , DIMENSIONS (${escapeHtml(box.dimensions.unit.toUpperCase() || "CMS")}) ${escapeHtml(formatDimensions(box).replace(` ${box.dimensions.unit.toUpperCase()}`, ""))} , ACTUAL WEIGHT - ${Number(box.actualWeight ?? 0).toFixed(2)} ${escapeHtml((box.weightUnit || "kg").toUpperCase())}
            </td>
          </tr>
          ${rows || `<tr><td colspan="7">No items added.</td></tr>`}
        </tbody>
      </table>
    `;
  }).join("");

  const taxRows = invoice.taxSummary.map((row) => {
    const taxAmountMinor = Math.round((row.taxableValueMinor || 0) * (row.gstRatePercent || 0) / 100);

    return `
      <tr>
        <td>${escapeHtml(row.hsnSac || "-")}</td>
        <td class="center">${escapeHtml(row.gstType || "IGST")}</td>
        <td class="right">${formatMinorNumber(row.taxableValueMinor)}</td>
        <td class="center">${row.gstRatePercent ? `${row.gstRatePercent}%` : "-"}</td>
        <td class="right">${formatMinorNumber(taxAmountMinor)}</td>
      </tr>
    `;
  }).join("");
  const screenCss = mode === "preview"
    ? `
      html, body { overflow: hidden; }
      body { background: white; }
      .sheet { width: 125%; min-height: 122vh; margin: 0; padding: 10mm; transform: scale(0.8); transform-origin: top left; }
    `
    : `
      html, body { overflow-x: hidden; overflow-y: auto; }
      body { background: #f8fafc; }
      .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 13mm; transform: none; }
    `;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Tax Invoice ${escapeHtml(invoice.invoiceNumber || "Draft")}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body { color: #0f172a; font-family: Arial, sans-serif; }
    .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; background: white; padding: 13mm; position: relative; overflow: hidden; display: flex; flex-direction: column; }
    .sheet > *:not(.watermark) { position: relative; z-index: 1; }
    .watermark { position: absolute; top: 42%; left: 50%; width: 410px; opacity: 0.099; transform: translate(-50%, -50%); z-index: 0; }
    .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111827; padding-bottom: 12px; }
    .logo { width: 245px; height: auto; object-fit: contain; }
    h3 { margin:0, margin-top: 16px; color: #111827; font-size: 20px; letter-spacing: 0; text-align: right; text-transform: uppercase; }
    .meta { text-align: right; font-size: 8px; line-height: 1.2; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 18px; }
    .box { border: 1px solid #cbd5e1; padding: 12px; min-height: 155px; }
    .label { color: #475569; font-size: 10px; text-transform: uppercase; font-weight: 700; margin-bottom: 6px; }
    .party { font-size: 12px; line-height: 1.55; }
    .party strong { font-size: 13px; }
    .details { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 16px; }
    .detail { border: 1px solid #cbd5e1; padding: 9px; font-size: 12px; min-height: 54px; }
    .commercial { display: grid; grid-template-columns: 1fr 1fr; margin-top: 10px; border-top: 1.5px solid #111827; border-left: 1.5px solid #111827; }
    .commercial-item { min-height: 44px; padding: 7px 9px; border-right: 1.5px solid #111827; border-bottom: 1.5px solid #111827; font-size: 11px; }
    .commercial-wide { grid-column: 1 / -1; }
    table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 14px; font-size: 11px; }
    th { background: #f1f5f9; color: #0f172a; text-align: left; padding: 6px; border: 1.5px solid #111827; }
    td { padding: 6px; border: 1.5px solid #111827; vertical-align: top; }
    .right { text-align: right; }
    .center { text-align: center; }
    .strong { font-weight: 700; }
    .col-serial { width: 5%; }
    .col-description { width: 39%; }
    .col-hsn { width: 15%; }
    .col-unit { width: 10%; }
    .col-qty { width: 7%; }
    .col-rate { width: 12%; }
    .col-amount { width: 12%; }
    .box-table { margin-top: 0; font-size: 13px; }
    .box-table + .box-table { margin-top: 0; }
    .box-heading { text-align: center; font-size: 14px; font-weight: 600; padding: 10px; text-transform: uppercase; }
    .tax-table .col-tax-hsn { width: 20%; }
    .tax-table .col-tax-type { width: 16%; }
    .tax-table .col-taxable { width: 24%; }
    .tax-table .col-tax-rate { width: 16%; }
    .tax-table .col-tax-amount { width: 24%; }
    .muted { color: #64748b; font-size: 10px; margin-top: 3px; }
    .summary { display: grid; grid-template-columns: 1fr 270px; gap: 0; margin-top: 0; }
    .total { border: 1.5px solid #111827; }
    .total-row { display: flex; justify-content: space-between; gap: 16px; padding: 8px 10px; border-bottom: 1.5px solid #111827; font-size: 12px; }
    .total-row:last-child { border-bottom: 0; background: #f8fafc; color: #111827; font-size: 15px; font-weight: 800; }
    .note { border: 1.5px solid #111827; border-right: 0; padding: 12px; font-size: 12px; line-height: 1.55; }
    .amount-words { border: 1.5px solid #111827; border-top: 0; padding: 8px; font-size: 12px; }
    .bottom-grid { display: grid; grid-template-columns: 1fr 269px; border: 1.5px solid #111827; border-top: 0; }
    .bottom-cell { padding: 9px; min-height: 80px; font-size: 12px; line-height: 1.4; }
    .bottom-cell + .bottom-cell { border-left: 1.5px solid #111827; text-align: center; }
    .sign { margin-top: 34px; display: flex; justify-content: flex-end; font-size: 12px; }
    .sign-line { width: 210px; border-top: 1px solid #334155; padding-top: 8px; text-align: center; }
    .footer { margin-top: auto; border-top: 1.5px solid #111827; padding-top: 8px; text-align: center; font-size: 10px; font-weight: 700; text-transform: uppercase; }
    .computer-note { margin-top: 5px; color: #475569; font-size: 9px; font-weight: 600; text-transform: none; }
    @media print {
      html, body { overflow: visible; }
      body { background: white; }
      .sheet { width: 190mm; min-height: 277mm; margin: 0 auto; padding: 0; transform: none; }
    }
    @media screen {
      ${screenCss}
    }
  </style>
</head>
<body>
  <main class="sheet">
    <img src="${logoUrl}" alt="" class="watermark" />
    <section class="top">
      <img src="${logoUrl}" alt="Swiftline Cargo" class="logo" />
      <div>
        <h3>TAX INVOICE</h3>
        <div class="meta">
          <div><strong>Invoice No:</strong> ${escapeHtml(invoice.invoiceNumber || "Auto on save")}</div>
          <div><strong>Date:</strong> ${escapeHtml(formatDate(invoice.invoiceDate))}</div>
          <div><strong>Reference:</strong> ${escapeHtml(invoice.otherReference || "-")}</div>
        </div>
      </div>
    </section>

    <section class="grid">
      <div class="box">
        <div class="label">Shipper</div>
        <div class="party">
          <strong>${escapeHtml(invoice.shipper.companyName || invoice.shipper.name || "-")}</strong><br />
          ${invoice.shipper.name && invoice.shipper.companyName ? `${escapeHtml(invoice.shipper.name)}<br />` : ""}
          ${inlineAddress(escapeHtml(invoice.shipper.address || "")) || "-"}<br />
          ${escapeHtml(invoice.shipper.email || "")}${invoice.shipper.email && invoice.shipper.phone ? " | " : ""}${escapeHtml(invoice.shipper.phone || "")}
          <br /><strong>GSTIN/UIN:</strong> ${escapeHtml(invoice.shipper.gstinUin || "-")}
          <br /><strong>State:</strong> ${escapeHtml(invoice.shipper.state || "-")} &nbsp; <strong>Code:</strong> ${escapeHtml(invoice.shipper.stateCode || "-")}
          ${invoice.shipperIdNumber ? `<br /><strong>${escapeHtml(invoice.shipperIdType || "ID")}:</strong> ${escapeHtml(invoice.shipperIdNumber)}` : ""}
        </div>
      </div>
      <div class="box">
        <div class="label">Consignee</div>
        <div class="party">
          <strong>${escapeHtml(invoice.consignee.companyName || invoice.consignee.name || "-")}</strong><br />
          ${invoice.consignee.name && invoice.consignee.companyName ? `${escapeHtml(invoice.consignee.name)}<br />` : ""}
          ${inlineAddress(escapeHtml(invoice.consignee.address || "")) || "-"}<br />
          ${escapeHtml(invoice.consignee.email || "")}${invoice.consignee.email && invoice.consignee.phone ? " | " : ""}${escapeHtml(invoice.consignee.phone || "")}
          <br /><strong>GSTIN/UIN:</strong> ${escapeHtml(invoice.consignee.gstinUin || "-")}
          <br /><strong>State:</strong> ${escapeHtml(invoice.consignee.state || "-")} &nbsp; <strong>Code:</strong> ${escapeHtml(invoice.consignee.stateCode || "-")}
        </div>
      </div>
    </section>

    <section class="details">
      <div class="detail"><div class="label">Origin</div>${escapeHtml(invoice.countryOfOrigin || "-")}</div>
      <div class="detail"><div class="label">Destination</div>${escapeHtml(invoice.destinationCountry || "-")}</div>
      <div class="detail"><div class="label">Currency</div>${escapeHtml(invoice.currency || "INR")}</div>
      <div class="detail"><div class="label">Boxes</div>${invoice.boxes.length}</div>
    </section>

    <section class="commercial">
      <div class="commercial-item"><div class="label">Mode / Terms Of Payment</div>${escapeHtml(invoice.paymentTerms || "-")}</div>
      <div class="commercial-item"><div class="label">Buyer Order Number</div>${escapeHtml(invoice.buyerOrderNumber || "-")}</div>
      <div class="commercial-item"><div class="label">Dispatch Document Number</div>${escapeHtml(invoice.dispatchDocumentNumber || "-")}</div>
      <div class="commercial-item"><div class="label">Dispatched Through</div>${escapeHtml(invoice.dispatchedThrough || "-")}</div>
      <div class="commercial-item commercial-wide"><div class="label">Terms Of Delivery</div>${escapeHtml(invoice.termsOfDelivery || "-")}</div>
    </section>

    <table>
      ${itemColumnGroup}
      <thead>
        <tr>
          <th class="col-serial center">S.No</th>
          <th class="col-description">Description</th>
          <th class="col-hsn center">HSN/SAC</th>
          <th class="col-unit center">Unit</th>
          <th class="col-qty right">Qty</th>
          <th class="col-rate right">Rate</th>
          <th class="col-amount right">Amount</th>
        </tr>
      </thead>
    </table>
    ${boxTables || `<table><tbody><tr><td>No items added.</td></tr></tbody></table>`}

    <section class="amount-words">
      <strong>Amount Chargeable (in words)</strong> : 
      ${escapeHtml(invoice.currency || "INR")} ${escapeHtml(invoice.amountInWords || "-")}
    </section>

    ${hasTaxRow(invoice) ? `
    <table class="tax-table">
      ${taxColumnGroup}
      <thead>
        <tr>
          <th class="col-tax-hsn">HSN/SAC</th>
          <th class="col-tax-type center">GST Type</th>
          <th class="col-taxable right">Taxable Value</th>
          <th class="col-tax-rate center">GST Rate</th>
          <th class="col-tax-amount right">GST Amount</th>
        </tr>
      </thead>
      <tbody>
        ${taxRows}
        <tr>
          <td class="right strong">Total</td>
          <td></td>
          <td class="right strong">${formatMinorNumber(invoice.taxSummary.reduce((total, row) => total + row.taxableValueMinor, 0))}</td>
          <td></td>
          <td class="right strong">${formatMinorNumber(taxTotalMinor)}</td>
        </tr>
      </tbody>
    </table>
    <section class="amount-words">
      <strong>Tax Amount (in words):</strong> ${escapeHtml(invoice.currency || "INR")} ${escapeHtml(invoice.taxAmountInWords || "-")}
    </section>` : ""}

    <section class="summary">
      <div class="note">
        <div class="label">Notes</div>
        ${escapeHtml(invoice.notes || "-")}
      </div>
      <div class="total">
        <div class="total-row"><span>Subtotal</span><span>${formatMinorNumber(subTotalMinor)}</span></div>
        <div class="total-row"><span>Tax</span><span>${formatMinorNumber(taxTotalMinor)}</span></div>
        <div class="total-row"><span>Total</span><span>${formatMinorNumber(totalMinor)}</span></div>
      </div>
    </section>

    <section class="bottom-grid">
      <div class="bottom-cell">
        <strong>Declaration</strong><br />
        ${escapeHtml(invoice.declarationNote || "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.")}
      </div>
      <div class="bottom-cell">
        <strong>For SWIFTLINE CARGO AND EXPRESS LOGISTICS PVT. LTD.</strong>
        <div class="sign">
          <div class="sign-line">Authorised Signatory</div>
        </div>
      </div>
    </section>

    <footer class="footer">
      SWIFTLINE CARGO AND EXPRESS LOGISTICS PL S/F KRISHNA COMPLEX NEAR 33KV S STN, UTTAM NAGAR REWARI HARYANA - 12340
      <div class="computer-note">This is a computer generated invoice from Swiftline Portal.</div>
    </footer>
  </main>
</body>
</html>`;
}

export function TaxInvoicePreview({ invoice }: { invoice: TaxInvoicePayload }) {
  const html = renderTaxInvoiceHtml(invoice, logoPath, "preview");

  return (
    <div className="h-[calc(100vh-170px)] min-h-180 w-full overflow-y-auto overflow-x-hidden border border-slate-200 bg-white">
      <iframe
        title="Tax invoice preview"
        srcDoc={html}
        className="h-350 w-full border-0 bg-white"
      />
    </div>
  );
}

export function printTaxInvoice(invoice: TaxInvoicePayload) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  printWindow.document.write(renderTaxInvoiceHtml(invoice, `${window.location.origin}${logoPath}`, "document"));
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => {
    printWindow.print();
  }, 500);
}

export function downloadTaxInvoiceHtml(invoice: TaxInvoicePayload) {
  const html = renderTaxInvoiceHtml(invoice, `${window.location.origin}${logoPath}`, "document");
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${invoice.invoiceNumber || "tax-invoice-draft"}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
