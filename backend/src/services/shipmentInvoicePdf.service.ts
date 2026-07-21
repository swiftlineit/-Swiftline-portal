import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { amountMinorToWords } from "./taxInvoice.service.js";
import type { serializeShipmentInvoice } from "./shipmentInvoice.service.js";

type ShipmentInvoiceDocument = ReturnType<typeof serializeShipmentInvoice>;

function money(minor: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(minor / 100);
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

function dimensions(record: Record<string, unknown>) {
  const length = numberValue(record, "lengthCm");
  const width = numberValue(record, "widthCm");
  const height = numberValue(record, "heightCm");
  return length && width && height
    ? `${length.toFixed(2)} x ${width.toFixed(2)} x ${height.toFixed(2)} CM`
    : "Not provided";
}

function drawLabelValue(doc: PDFKit.PDFDocument, label: string, value: string, x: number, y: number, width: number) {
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#64748b").text(label.toUpperCase(), x, y, { width });
  doc.font("Helvetica").fontSize(9).fillColor("#0f172a").text(value, x, y + 11, { width, lineGap: 2 });
}

function drawPartyBox(
  doc: PDFKit.PDFDocument,
  title: string,
  party: Record<string, unknown>,
  x: number,
  y: number,
  width: number,
  isSupplier: boolean
) {
  doc.rect(x, y, width, 112).strokeColor("#cbd5e1").stroke();
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text(title.toUpperCase(), x + 10, y + 9, { width: width - 20 });
  const name = isSupplier ? textValue(party, "legalName") : textValue(party, "companyName");
  const address = isSupplier ? textValue(party, "address") : textValue(party, "billingAddress");
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a").text(name, x + 10, y + 25, { width: width - 20 });
  doc.font("Helvetica").fontSize(8).text(address, x + 10, y + 43, { width: width - 20, height: 32 });
  doc.font("Helvetica-Bold").text(`GSTIN: ${textValue(party, "gstin")}`, x + 10, y + 80, { width: width - 20 });
  doc.font("Helvetica").text(`${textValue(party, "email")} | ${textValue(party, "phone")}`, x + 10, y + 94, { width: width - 20 });
}

function drawTaxRow(doc: PDFKit.PDFDocument, label: string, amountMinor: number, y: number, currency: string, bold = false) {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9).fillColor("#0f172a");
  doc.text(label, 354, y, { width: 105 });
  doc.text(money(amountMinor, currency), 459, y, { width: 90, align: "right" });
  doc.moveTo(350, y + 15).lineTo(549, y + 15).strokeColor("#cbd5e1").stroke();
}

export function createShipmentInvoicePdf(invoice: ShipmentInvoiceDocument) {
  const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
  const supplier = invoice.supplier as Record<string, unknown>;
  const customer = invoice.customer as Record<string, unknown>;
  const shipment = invoice.shipment as Record<string, unknown>;
  const parcels = Array.isArray(shipment.parcels) ? shipment.parcels as Record<string, unknown>[] : [];
  const logoPath = path.resolve(process.cwd(), "assets", "swiftline-invoice-logo.jpeg");

  if (fs.existsSync(logoPath)) doc.image(logoPath, 42, 38, { fit: [190, 58] });
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#0f172a").text(invoice.status === "ISSUED" ? "TAX INVOICE" : "DRAFT TAX INVOICE", 310, 42, { width: 239, align: "right" });
  doc.font("Helvetica").fontSize(8).text(`Invoice No: ${invoice.invoiceNumber}`, 310, 66, { width: 239, align: "right" });
  doc.text(`Version: Invoice ${invoice.revision}`, 310, 78, { width: 239, align: "right" });
  doc.text(`Invoice Date: ${date(invoice.issuedAt)}`, 310, 90, { width: 239, align: "right" });
  doc.text(`Reference: ${textValue(shipment, "shipmentReference")}`, 310, 102, { width: 239, align: "right" });
  doc.moveTo(42, 116).lineTo(549, 116).lineWidth(1.5).strokeColor("#0f172a").stroke();

  drawPartyBox(doc, "Supplier / Shipper Branch", supplier, 42, 132, 247, true);
  drawPartyBox(doc, "Bill To / Customer", customer, 302, 132, 247, false);

  const detailY = 260;
  drawLabelValue(doc, "Origin", textValue(shipment, "origin"), 42, detailY, 120);
  drawLabelValue(doc, "Destination", textValue(shipment, "destination"), 169, detailY, 120);
  drawLabelValue(doc, "Currency", invoice.currency, 296, detailY, 120);
  drawLabelValue(doc, "Boxes", String(parcels.length), 423, detailY, 126);

  let y = 310;
  const columns = [42, 220, 285, 350, 415, 480, 549];
  doc.rect(42, y, 507, 25).fill("#0f2f5f");
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
    doc.rect(42, y, 507, 22).fill("#f8fafc").strokeColor("#0f172a").stroke();
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a").text(
      `BOX ${String(parcel.sequence ?? index + 1)} | DIMENSIONS: ${dimensions(parcel)}`,
      48,
      y + 7,
      { width: 495, align: "center" }
    );
    y += 22;
    doc.rect(42, y, 507, 28).fill("#ffffff").strokeColor("#0f172a").stroke();
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

  y += 16;
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text("DELIVERY ADDRESS", 42, y);
  doc.font("Helvetica").fontSize(8).fillColor("#0f172a").text(textValue(shipment, "deliveryAddress"), 42, y + 14, { width: 280, height: 48 });

  drawTaxRow(doc, "Taxable Value", invoice.taxableValueMinor, y, invoice.currency);
  if (invoice.taxType === "CGST_SGST") {
    drawTaxRow(doc, `CGST ${invoice.gstRatePercent / 2}%`, invoice.cgstAmountMinor, y + 18, invoice.currency);
    drawTaxRow(doc, `SGST ${invoice.gstRatePercent / 2}%`, invoice.sgstAmountMinor, y + 36, invoice.currency);
  } else {
    drawTaxRow(doc, `IGST ${invoice.gstRatePercent}%`, invoice.igstAmountMinor, y + 18, invoice.currency);
  }
  drawTaxRow(doc, "Total Chargeable", invoice.totalAmountMinor, y + 58, invoice.currency, true);

  const wordsY = y + 92;
  doc.rect(42, wordsY, 507, 44).strokeColor("#cbd5e1").stroke();
  doc.font("Helvetica-Bold").fontSize(8).text("Amount in words", 52, wordsY + 8);
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
    doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(
      `This is a computer generated invoice from Swiftline Portal | Page ${index + 1} of ${range.count}`,
      42,
      806,
      { width: 507, align: "center" }
    );
  }

  return doc;
}
