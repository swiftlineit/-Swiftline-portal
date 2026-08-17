import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { amountMinorToWords } from "./taxInvoice.service.js";
import type { serializeShipmentInvoice } from "./shipmentInvoice.service.js";
import { getShipmentLevelInvoiceLines } from "./shipmentPricing.service.js";

type ShipmentInvoiceDocument = ReturnType<typeof serializeShipmentInvoice>;

// The built-in Helvetica face is WinAnsi encoded and has no rupee glyph, so a
// symbol-style format renders as a stray superscript. The currency code is
// printed instead, matching the credit billing statement PDF.
function money(minor: number, currency: string) {
  const amount = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(minor / 100);
  return `${currency} ${amount}`;
}

function date(value: Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(value).replaceAll("/", "-");
}

function textValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : "Not provided";
}

function numberValue(record: Record<string, unknown>, key: string) {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : 0;
}

const columns = [42, 220, 285, 350, 415, 480, 549];

function dimensions(record: Record<string, unknown>) {
  const length = numberValue(record, "lengthCm");
  const width = numberValue(record, "widthCm");
  const height = numberValue(record, "heightCm");
  return length && width && height
    ? `${length.toFixed(2)} x ${width.toFixed(2)} x ${height.toFixed(2)}`
    : "";
}

function boxLabel(record: Record<string, unknown>, sequence: string) {
  const size = dimensions(record);
  return size ? `BOX ${sequence} | DIMENSIONS (CM): ${size}` : `BOX ${sequence} | DIMENSIONS: Not provided`;
}

function drawColumnSeparators(doc: PDFKit.PDFDocument, y: number, height: number, color: string) {
  doc.lineWidth(0.5).strokeColor(color);
  for (const x of columns.slice(1, -1)) doc.moveTo(x, y).lineTo(x, y + height).stroke();
}

function drawLabelValue(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number, width: number) {
  doc.rect(x, y, width, 48).lineWidth(0.8).strokeColor("#cbd5e1").stroke();
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#64748b").text(label.toUpperCase(), x + 8, y + 9, { width: width - 16 });
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a").text(value, x + 8, y + 24, { width: width - 16, lineGap: 2 });
}

function optionalTextValue(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function measurePartyBoxHeight(
  doc: PDFKit.PDFDocument,
  party: Record<string, unknown>,
  width: number,
  isSupplier: boolean
) {
  const innerWidth = width - 20;
  const name = isSupplier ? textValue(party, "legalName") : textValue(party, "companyName");
  const address = isSupplier ? textValue(party, "address") : textValue(party, "billingAddress");
  const contact = [optionalTextValue(party, "email"), optionalTextValue(party, "phone")].filter(Boolean).join(" | ");
  const nameHeight = doc.font("Helvetica-Bold").fontSize(10).heightOfString(name, { width: innerWidth });
  const addressHeight = doc.font("Helvetica").fontSize(8).heightOfString(address, { width: innerWidth, lineGap: 2 });
  const contactHeight = contact ? doc.heightOfString(contact, { width: innerWidth, lineGap: 2 }) : 0;
  return Math.max(112, 9 + 10 + 8 + nameHeight + 6 + addressHeight + 7 + 10 + (contactHeight ? 5 + contactHeight : 0) + 10);
}

function drawPartyBox(
  doc: PDFKit.PDFDocument,
  title: string,
  party: Record<string, unknown>,
  x: number,
  y: number,
  width: number,
  height: number,
  isSupplier: boolean
) {
  doc.rect(x, y, width, height).lineWidth(0.8).strokeColor("#cbd5e1").stroke();
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text(title.toUpperCase(), x + 10, y + 9, { width: width - 20 });
  const name = isSupplier ? textValue(party, "legalName") : textValue(party, "companyName");
  const address = isSupplier ? textValue(party, "address") : textValue(party, "billingAddress");
  const contact = [optionalTextValue(party, "email"), optionalTextValue(party, "phone")].filter(Boolean).join(" | ");
  const innerWidth = width - 20;
  let cursor = y + 25;
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a").text(name, x + 10, cursor, { width: innerWidth });
  cursor = doc.y + 6;
  doc.font("Helvetica").fontSize(8).text(address, x + 10, cursor, { width: innerWidth, lineGap: 2 });
  cursor = doc.y + 7;
  // Left blank rather than "Not provided": an unregistered recipient has no
  // GSTIN, and printing a placeholder reads as missing paperwork.
  doc.font("Helvetica-Bold").text(`GSTIN: ${optionalTextValue(party, "gstin")}`, x + 10, cursor, { width: innerWidth });
  cursor = doc.y + 5;
  if (contact) doc.font("Helvetica").fillColor("#64748b").text(contact, x + 10, cursor, { width: innerWidth, lineGap: 2 });
}

function drawTaxRow(doc: PDFKit.PDFDocument, label: string, amountMinor: number | null, y: number, currency: string, bold = false) {
  const height = bold ? 22 : 18;
  doc.lineWidth(0.5).strokeColor("#94a3b8");
  doc.rect(350, y - 4, 199, height).stroke();
  doc.moveTo(455, y - 4).lineTo(455, y - 4 + height).stroke();
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9).fillColor("#0f172a");
  doc.text(label, 354, y, { width: 97 });
  doc.text(amountMinor === null ? "-" : money(amountMinor, currency), 459, y, { width: 86, align: "right" });
}

export function createShipmentInvoicePdf(invoice: ShipmentInvoiceDocument) {
  const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
  const supplier = invoice.supplier as Record<string, unknown>;
  const customer = invoice.customer as Record<string, unknown>;
  const shipment = invoice.shipment as Record<string, unknown>;
  const parcels = Array.isArray(shipment.parcels) ? shipment.parcels as Record<string, unknown>[] : [];
  // Carries the freight / CSB-V clearance split behind the taxable value.
  const pricingSnapshot = invoice.pricingSnapshot as Record<string, unknown>;
  const logoPath = path.resolve(process.cwd(), "assets", "swiftline-invoice-logo.png");

  if (fs.existsSync(logoPath)) doc.image(logoPath, 42, 25, { fit: [185, 100] });
  else doc.font("Helvetica-Bold").fontSize(22).fillColor("#0f2f5f").text("SWIFTLINE", 42, 48);
  const noGst = invoice.taxTreatment === "NO_GST" || invoice.gstRatePercent === 0;
  const invoiceTitle = noGst
    ? (invoice.status === "ISSUED" ? "INVOICE" : "DRAFT INVOICE")
    : (invoice.status === "ISSUED" ? "TAX INVOICE" : "DRAFT TAX INVOICE");
  doc.font("Helvetica-Bold").fontSize(18).fillColor("#0f172a").text(invoiceTitle, 310, 40, { width: 239, align: "right" });
  doc.font("Helvetica-Bold").fontSize(8).text(`Invoice No: ${invoice.invoiceNumber}`, 310, 72, { width: 239, align: "right" });
  doc.font("Helvetica").text(`Date: ${date(invoice.issuedAt)}`, 310, 87, { width: 239, align: "right" });
  doc.text(`AWB / Tracking No.: ${textValue(shipment, "shipmentReference")}`, 310, 102, { width: 239, align: "right" });
  doc.moveTo(42, 132).lineTo(549, 132).lineWidth(1.5).strokeColor("#0f172a").stroke();

  const partyY = 148;
  const partyHeight = Math.max(
    measurePartyBoxHeight(doc, supplier, 247, true),
    measurePartyBoxHeight(doc, customer, 247, false)
  );
  drawPartyBox(doc, "Supplier / Shipper Branch", supplier, 42, partyY, 247, partyHeight, true);
  drawPartyBox(doc, "Bill To / Customer", customer, 302, partyY, 247, partyHeight, false);

  const detailY = partyY + partyHeight + 16;
  drawLabelValue(doc, "Origin", textValue(shipment, "origin"), 42, detailY, 120);
  drawLabelValue(doc, "Destination", textValue(shipment, "destination"), 169, detailY, 120);
  drawLabelValue(doc, "Currency", invoice.currency, 296, detailY, 120);
  drawLabelValue(doc, "Boxes", String(parcels.length), 423, detailY, 126);

  let y = detailY + 64;
  doc.rect(42, y, 507, 25).fill("#0f2f5f");
  drawColumnSeparators(doc, y, 25, "#ffffff");
  const headers = ["Description", "Actual KG", "Volumetric KG", "Chargeable KG", "Rate/KG", "Amount"];
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff");
  headers.forEach((header, index) => doc.text(header, columns[index]! + 4, y + 9, {
    width: columns[index + 1]! - columns[index]! - 8,
    align: "center"
  }));
  y += 25;

  for (const [index, parcel] of parcels.entries()) {
    const boxHeight = 50;
    if (y + boxHeight > 640) {
      doc.addPage();
      y = 48;
    }
    doc.lineWidth(0.75);
    doc.rect(42, y, 507, 22).fillAndStroke("#f8fafc", "#0f172a");
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a").text(
      boxLabel(parcel, String(parcel.sequence ?? index + 1)),
      48,
      y + 7,
      { width: 495, align: "center" }
    );
    y += 22;
    doc.lineWidth(0.75);
    doc.rect(42, y, 507, 28).fillAndStroke("#ffffff", "#0f172a");
    drawColumnSeparators(doc, y, 28, "#0f172a");
    const values = [
      textValue(parcel, "contentsDescription").toUpperCase(),
      numberValue(parcel, "actualWeightKg").toFixed(3),
      numberValue(parcel, "volumetricWeightKg").toFixed(3),
      numberValue(parcel, "chargeableWeightKg").toFixed(3),
      money(Math.round(numberValue(parcel, "chargesPerKg") * 100), invoice.currency),
      money(Math.round(numberValue(parcel, "baseAmount") * 100), invoice.currency)
    ];
    doc.font("Helvetica").fontSize(7).fillColor("#0f172a");
    values.forEach((value, valueIndex) => doc.text(value, columns[valueIndex]! + 4, y + 8, {
      width: columns[valueIndex + 1]! - columns[valueIndex]! - 8,
      align: "center"
    }));
    y += 28;
  }

  // Charges that apply to the whole shipment rather than to one box: surcharges,
  // customs clearance, handling, insurance and any discount. Each gets its own
  // line under the per-box rows, so the rows above plus these always add up to the
  // taxable value printed below.
  for (const line of getShipmentLevelInvoiceLines(pricingSnapshot)) {
    if (y + 28 > 640) {
      doc.addPage();
      y = 48;
    }
    doc.lineWidth(0.75);
    doc.rect(42, y, 507, 28).fillAndStroke("#ffffff", "#0f172a");
    doc.lineWidth(0.5).strokeColor("#0f172a").moveTo(columns[5]!, y).lineTo(columns[5]!, y + 28).stroke();
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#0f172a").text(
      line.label.toUpperCase(),
      columns[0]! + 4,
      y + 8,
      { width: columns[4]! - columns[0]! - 8, align: "left" }
    );
    doc.font("Helvetica").fontSize(7).text(
      `${line.kind === "DEDUCTION" ? "-" : ""}${money(line.amountMinor, invoice.currency)}`,
      columns[5]! + 4,
      y + 8,
      { width: columns[6]! - columns[5]! - 8, align: "center" }
    );
    y += 28;
  }

  y += 16;
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text("DELIVERY ADDRESS", 42, y);
  doc.font("Helvetica").fontSize(8).fillColor("#0f172a").text(textValue(shipment, "deliveryAddress"), 42, y + 14, { width: 280, height: 48 });

  drawTaxRow(doc, "Taxable Value", invoice.taxableValueMinor, y, invoice.currency);
  if (invoice.taxType === "CGST_SGST") {
    drawTaxRow(doc, noGst ? "CGST" : `CGST ${invoice.gstRatePercent / 2}%`, noGst ? null : invoice.cgstAmountMinor, y + 18, invoice.currency);
    drawTaxRow(doc, noGst ? "SGST" : `SGST ${invoice.gstRatePercent / 2}%`, noGst ? null : invoice.sgstAmountMinor, y + 36, invoice.currency);
  } else {
    drawTaxRow(doc, noGst ? "IGST" : `IGST ${invoice.gstRatePercent}%`, noGst ? null : invoice.igstAmountMinor, y + 18, invoice.currency);
  }
  drawTaxRow(doc, "Total Chargeable", invoice.totalAmountMinor, y + 58, invoice.currency, true);

  const wordsY = y + 92;
  doc.lineWidth(1).rect(42, wordsY, 507, 44).strokeColor("#cbd5e1").stroke();
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a").text("Amount in words", 52, wordsY + 8);
  doc.font("Helvetica").fontSize(8).text(amountMinorToWords(invoice.totalAmountMinor, invoice.currency), 52, wordsY + 21, { width: 487 });

  const declarationY = wordsY + 58;
  doc.font("Helvetica-Bold").fontSize(8).text("Declaration", 42, declarationY);
  doc.font("Helvetica").fontSize(7).text("We declare that this invoice records the shipment service and applicable charges shown above.", 42, declarationY + 13, { width: 310 });
  doc.font("Helvetica-Bold").fontSize(8).text("For Swiftline Cargo and Express Logistics Pvt. Ltd.", 330, declarationY, { width: 219, align: "right" });
  doc.font("Helvetica").fontSize(8).text("Authorised Signatory", 330, declarationY + 35, { width: 219, align: "right" });

  if (invoice.status === "DRAFT") {
    doc.save().rotate(-35, { origin: [300, 420] }).font("Helvetica-Bold").fontSize(54).fillColor("#dc2626").opacity(0.08).text("DRAFT", 135, 385, { width: 340, align: "center" }).restore().opacity(1);
  }

const range = doc.bufferedPageRange();
for (let index = range.start; index < range.start + range.count; index += 1) {
  doc.switchToPage(index);
  const bottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0; // prevent auto page-break for footer text
  doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(
    `This is a computer generated invoice from Swiftline Portal | Page ${index + 1} of ${range.count}`,
    42,
    806,
    { width: 507, align: "center", lineBreak: false }
  );
  doc.page.margins.bottom = bottomMargin;
}
  return doc;
}
