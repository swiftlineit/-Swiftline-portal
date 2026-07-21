import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import type { ICancellationFeeInvoice } from "../models/cancellationFeeInvoice.model.js";
import type { IShipmentCreditNote } from "../models/shipmentCreditNote.model.js";

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

function addHeader(document: PDFKit.PDFDocument, title: string, number: string, issuedAt: Date) {
  const logoPath = path.resolve(process.cwd(), "assets", "swiftline-invoice-logo.jpeg");
  if (fs.existsSync(logoPath)) document.image(logoPath, 48, 38, { fit: [190, 58] });
  else document.fillColor("#173b72").font("Helvetica-Bold").fontSize(22).text("SWIFTLINE", 48, 45);
  document.fillColor("#111827").fontSize(16).text(title, 330, 45, { width: 215, align: "right" });
  document.font("Helvetica").fontSize(9).text(number, 330, 68, { width: 215, align: "right" });
  document.text(issuedAt.toLocaleDateString("en-GB").replaceAll("/", "-"), 330, 83, { width: 215, align: "right" });
  document.moveTo(48, 110).lineTo(547, 110).strokeColor("#173b72").lineWidth(1.2).stroke();
}

function addParties(
  document: PDFKit.PDFDocument,
  supplier: Record<string, unknown>,
  customer: Record<string, unknown>
) {
  document.fillColor("#475569").font("Helvetica-Bold").fontSize(9).text("SUPPLIER", 48, 130);
  document.fillColor("#111827").fontSize(11).text(text(supplier, "legalName", "branchName", "name"), 48, 148, { width: 220 });
  document.font("Helvetica").fontSize(9).text(text(supplier, "address"), 48, 166, { width: 220, height: 30 });
  document.text(`GSTIN: ${text(supplier, "gstin")}`, 48, 200, { width: 220 });

  document.fillColor("#475569").font("Helvetica-Bold").text("CUSTOMER", 310, 130);
  document.fillColor("#111827").fontSize(11).text(text(customer, "companyName", "contactName", "name"), 310, 148, { width: 237 });
  document.font("Helvetica").fontSize(9).text(text(customer, "billingAddress", "address"), 310, 166, { width: 237, height: 30 });
  document.text(`GSTIN: ${text(customer, "gstin")}`, 310, 200, { width: 237 });
  document.moveTo(48, 230).lineTo(547, 230).strokeColor("#cbd5e1").lineWidth(0.8).stroke();
}

function addAmounts(document: PDFKit.PDFDocument, rows: Array<[string, number]>, totalLabel: string, total: number, startY = 245) {
  let y = startY + 25;
  document.fillColor("#0f172a").font("Helvetica-Bold").fontSize(10)
    .text("DESCRIPTION", 48, startY)
    .text("AMOUNT", 390, startY, { width: 157, align: "right" });
  for (const [label, amount] of rows) {
    document.font("Helvetica").text(label, 48, y, { width: 330 });
    document.text(money(amount), 390, y, { width: 157, align: "right" });
    y += 25;
  }
  document.moveTo(310, y + 2).lineTo(547, y + 2).strokeColor("#94a3b8").stroke();
  document.font("Helvetica-Bold").fontSize(12).text(totalLabel, 310, y + 15);
  document.text(money(total), 390, y + 15, { width: 157, align: "right" });
}

function finish(document: PDFKit.PDFDocument) {
  document.fillColor("#64748b").font("Helvetica").fontSize(8)
    .text("This is a computer generated document from Swiftline Portal.", 48, 750, { width: 499, align: "center" });
}

export function createShipmentCreditNotePdf(note: IShipmentCreditNote) {
  const document = new PDFDocument({ size: "A4", margin: 48, info: { Title: note.creditNoteNumber } });
  addHeader(document, "GST CREDIT NOTE", note.creditNoteNumber, note.issuedAt);
  addParties(document, note.supplier, note.customer);
  const shipment = note.shipment as Record<string, unknown>;
  document.fillColor("#111827").font("Helvetica").fontSize(9)
    .text(`Original invoice: ${note.originalInvoiceNumber} (Revision ${note.originalInvoiceRevision})`, 48, 242)
    .text(`Shipment reference: ${text(shipment, "shipmentReference", "dpdShipmentId")}`, 48, 257);
  addAmounts(document, [
    ["Taxable value reversed", note.taxableValueMinor],
    ["CGST reversed", note.cgstAmountMinor],
    ["SGST reversed", note.sgstAmountMinor],
    ["IGST reversed", note.igstAmountMinor]
  ], "TOTAL CREDIT", note.totalAmountMinor, 285);
  document.fontSize(9).font("Helvetica").text(`Reason: ${note.reason}`, 48, 455, { width: 499 });
  finish(document);
  return document;
}

export function createCancellationFeeInvoicePdf(invoice: ICancellationFeeInvoice) {
  const document = new PDFDocument({ size: "A4", margin: 48, info: { Title: invoice.invoiceNumber } });
  addHeader(document, "TAX INVOICE", invoice.invoiceNumber, invoice.issuedAt);
  addParties(document, invoice.supplier, invoice.customer);
  addAmounts(document, [
    ["Shipment cancellation fee", invoice.taxableValueMinor],
    ["CGST", invoice.cgstAmountMinor],
    ["SGST", invoice.sgstAmountMinor],
    ["IGST", invoice.igstAmountMinor]
  ], "TOTAL", invoice.totalAmountMinor);
  document.fontSize(9).font("Helvetica").text(`Fee reason: ${invoice.feeReason}`, 48, 390, { width: 499 });
  document.text(`Payment status: ${invoice.paymentStatus.replaceAll("_", " ")}`, 48, 410, { width: 499 });
  finish(document);
  return document;
}
