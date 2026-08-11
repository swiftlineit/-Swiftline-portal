import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import type { ICancellationFeeInvoice } from "../models/cancellationFeeInvoice.model.js";
import type { IShipmentCreditNote } from "../models/shipmentCreditNote.model.js";

const pageLeft = 48;
const pageRight = 547;
const contentWidth = pageRight - pageLeft;
const navy = "#0f2f5f";

function money(minor: number) {
  return `INR ${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function text(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "Not provided";
}

function optionalText(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function addHeader(document: PDFKit.PDFDocument, title: string, number: string, issuedAt: Date) {
  const logoPath = path.resolve(process.cwd(), "assets", "swiftline-invoice-logo.png");
  if (fs.existsSync(logoPath)) document.image(logoPath, pageLeft, 25, { fit: [185, 100] });
  else document.fillColor(navy).font("Helvetica-Bold").fontSize(22).text("SWIFTLINE", pageLeft, 48);

  const numberLabel = title.includes("CREDIT NOTE") ? "Credit Note No" : "Invoice No";
  document.fillColor("#0f172a").font("Helvetica-Bold").fontSize(18)
    .text(title, 300, 40, { width: 247, align: "right" });
  document.fontSize(8.5)
    .text(`${numberLabel}: ${number}`, 300, 72, { width: 247, align: "right" });
  document.font("Helvetica").text(
    `Date: ${issuedAt.toLocaleDateString("en-GB").replaceAll("/", "-")}`,
    300,
    88,
    { width: 247, align: "right" }
  );
  document.moveTo(pageLeft, 132).lineTo(pageRight, 132).strokeColor("#0f172a").lineWidth(1.5).stroke();
  return 148;
}

type PartyLayout = {
  name: string;
  address: string;
  gstin: string;
  contact: string;
  nameHeight: number;
  addressHeight: number;
  contactHeight: number;
  height: number;
};

function measureParty(
  document: PDFKit.PDFDocument,
  party: Record<string, unknown>,
  width: number,
  isSupplier: boolean
): PartyLayout {
  const innerWidth = width - 24;
  const name = isSupplier
    ? text(party, "legalName", "branchName", "name")
    : text(party, "companyName", "contactName", "name");
  const address = isSupplier ? text(party, "address") : text(party, "billingAddress", "address");
  const gstin = text(party, "gstin");
  const email = optionalText(party, "email");
  const phone = optionalText(party, "phone", "mobileNumber");
  const contact = [email, phone].filter(Boolean).join(" | ");
  const nameHeight = document.font("Helvetica-Bold").fontSize(10).heightOfString(name, { width: innerWidth });
  const addressHeight = document.font("Helvetica").fontSize(8).heightOfString(address, { width: innerWidth, lineGap: 2 });
  const contactHeight = contact
    ? document.heightOfString(contact, { width: innerWidth, lineGap: 2 })
    : 0;
  const measuredHeight = 12 + 10 + 10 + nameHeight + 7 + addressHeight + 8 + 10
    + (contactHeight ? 6 + contactHeight : 0) + 12;

  return {
    name,
    address,
    gstin,
    contact,
    nameHeight,
    addressHeight,
    contactHeight,
    height: Math.max(116, measuredHeight)
  };
}

function drawPartyCard(
  document: PDFKit.PDFDocument,
  title: string,
  layout: PartyLayout,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const innerX = x + 12;
  const innerWidth = width - 24;
  document.rect(x, y, width, height).lineWidth(0.8).strokeColor("#cbd5e1").stroke();
  document.fillColor("#64748b").font("Helvetica-Bold").fontSize(8)
    .text(title.toUpperCase(), innerX, y + 12, { width: innerWidth });

  let cursor = y + 32;
  document.fillColor("#0f172a").fontSize(10)
    .text(layout.name, innerX, cursor, { width: innerWidth });
  cursor += layout.nameHeight + 7;
  document.font("Helvetica").fontSize(8)
    .text(layout.address, innerX, cursor, { width: innerWidth, lineGap: 2 });
  cursor += layout.addressHeight + 8;
  document.font("Helvetica-Bold").text(`GSTIN: ${layout.gstin}`, innerX, cursor, { width: innerWidth });
  cursor += 16;
  if (layout.contact) {
    document.fillColor("#64748b").font("Helvetica").text(layout.contact, innerX, cursor, {
      width: innerWidth,
      lineGap: 2
    });
  }
}

function addParties(
  document: PDFKit.PDFDocument,
  supplier: Record<string, unknown>,
  customer: Record<string, unknown>,
  startY: number
) {
  const gap = 12;
  const width = (contentWidth - gap) / 2;
  const supplierLayout = measureParty(document, supplier, width, true);
  const customerLayout = measureParty(document, customer, width, false);
  const height = Math.max(supplierLayout.height, customerLayout.height);

  drawPartyCard(document, "Supplier / Shipper Branch", supplierLayout, pageLeft, startY, width, height);
  drawPartyCard(document, "Bill To / Customer", customerLayout, pageLeft + width + gap, startY, width, height);
  return startY + height;
}

function addAmounts(
  document: PDFKit.PDFDocument,
  rows: Array<[string, number | null]>,
  totalLabel: string,
  total: number,
  startY: number
) {
  const amountX = 388;
  const headerHeight = 24;
  const rowHeight = 25;
  const tableHeight = headerHeight + rows.length * rowHeight;

  document.rect(pageLeft, startY, contentWidth, tableHeight).lineWidth(0.8).strokeColor("#94a3b8").stroke();
  document.rect(pageLeft, startY, contentWidth, headerHeight).fill("#f1f5f9");
  document.moveTo(amountX, startY).lineTo(amountX, startY + tableHeight).strokeColor("#94a3b8").stroke();
  document.fillColor("#0f172a").font("Helvetica-Bold").fontSize(8)
    .text("DESCRIPTION", pageLeft + 10, startY + 8, { width: amountX - pageLeft - 20 })
    .text("AMOUNT", amountX + 8, startY + 8, { width: pageRight - amountX - 16, align: "right" });

  rows.forEach(([label, amount], index) => {
    const rowY = startY + headerHeight + index * rowHeight;
    document.moveTo(pageLeft, rowY).lineTo(pageRight, rowY).strokeColor("#cbd5e1").lineWidth(0.6).stroke();
    document.font("Helvetica").fontSize(9)
      .text(label, pageLeft + 10, rowY + 8, { width: amountX - pageLeft - 20 })
      .text(amount === null ? "-" : money(amount), amountX + 8, rowY + 8, { width: pageRight - amountX - 16, align: "right" });
  });

  const totalY = startY + tableHeight + 14;
  document.moveTo(310, totalY).lineTo(pageRight, totalY).strokeColor("#64748b").lineWidth(1).stroke();
  document.font("Helvetica-Bold").fontSize(12)
    .text(totalLabel, 310, totalY + 13, { width: 110 })
    .text(money(total), 420, totalY + 13, { width: pageRight - 420, align: "right" });
  return totalY + 42;
}

function finish(document: PDFKit.PDFDocument) {
  const bottomMargin = document.page.margins.bottom;
  document.page.margins.bottom = 0;
  document.fillColor("#64748b").font("Helvetica").fontSize(8)
    .text("This is a computer generated document from Swiftline Portal.", pageLeft, 795, {
      width: contentWidth,
      align: "center",
      lineBreak: false
    });
  document.page.margins.bottom = bottomMargin;
}

export function createShipmentCreditNotePdf(note: IShipmentCreditNote) {
  const document = new PDFDocument({ size: "A4", margin: pageLeft, info: { Title: note.creditNoteNumber } });
  const noGst = note.taxTreatment === "NO_GST" || note.gstRatePercent === 0;
  const headerBottom = addHeader(document, noGst ? "CREDIT NOTE" : "GST CREDIT NOTE", note.creditNoteNumber, note.issuedAt);
  const partiesBottom = addParties(document, note.supplier, note.customer, headerBottom);
  const shipment = note.shipment as Record<string, unknown>;
  const referenceY = partiesBottom + 16;
  document.rect(pageLeft, referenceY, contentWidth, 43).lineWidth(0.8).strokeColor("#cbd5e1").stroke();
  document.fillColor("#0f172a").font("Helvetica").fontSize(8.5)
    .text(`Original invoice: ${note.originalInvoiceNumber} (Revision ${note.originalInvoiceRevision})`, pageLeft + 10, referenceY + 10, { width: contentWidth - 20 })
    .text(`Shipment reference: ${text(shipment, "shipmentReference", "dpdShipmentId")}`, pageLeft + 10, referenceY + 25, { width: contentWidth - 20 });
  const totalsBottom = addAmounts(document, [
    ["Taxable value reversed", note.taxableValueMinor],
    ["CGST reversed", noGst ? null : note.cgstAmountMinor],
    ["SGST reversed", noGst ? null : note.sgstAmountMinor],
    ["IGST reversed", noGst ? null : note.igstAmountMinor]
  ], "TOTAL CREDIT", note.totalAmountMinor, referenceY + 59);
  document.fontSize(9).font("Helvetica").text(`Reason: ${note.reason}`, pageLeft, totalsBottom + 18, { width: contentWidth });
  finish(document);
  return document;
}

export function createCancellationFeeInvoicePdf(invoice: ICancellationFeeInvoice) {
  const document = new PDFDocument({ size: "A4", margin: pageLeft, info: { Title: invoice.invoiceNumber } });
  const noGst = invoice.taxTreatment === "NO_GST" || invoice.gstRatePercent === 0;
  const headerBottom = addHeader(document, noGst ? "INVOICE" : "TAX INVOICE", invoice.invoiceNumber, invoice.issuedAt);
  const partiesBottom = addParties(document, invoice.supplier, invoice.customer, headerBottom);
  const totalsBottom = addAmounts(document, [
    ["Shipment cancellation fee", invoice.taxableValueMinor],
    ["CGST", noGst ? null : invoice.cgstAmountMinor],
    ["SGST", noGst ? null : invoice.sgstAmountMinor],
    ["IGST", noGst ? null : invoice.igstAmountMinor]
  ], "TOTAL", invoice.totalAmountMinor, partiesBottom + 24);
  document.fontSize(9).font("Helvetica").text(`Fee reason: ${invoice.feeReason}`, pageLeft, totalsBottom + 18, { width: contentWidth });
  document.text(`Payment status: ${invoice.paymentStatus.replaceAll("_", " ")}`, pageLeft, totalsBottom + 38, { width: contentWidth });
  finish(document);
  return document;
}
