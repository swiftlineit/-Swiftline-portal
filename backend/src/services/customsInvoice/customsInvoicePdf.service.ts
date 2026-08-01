// Renders the customs (shipment) invoice as a PDF laid out like the customer's
// Excel template: a bordered header block (invoice no / other reference, shipper /
// consignee, origin / destination, note), then one row per content item grouped
// under a full-width box header, then the amount-chargeable footer.
//
// The header block repeats on every page, matching the template's behaviour when
// item rows overflow. There is deliberately NO revision/version line — unlike the
// GST tax invoice, this document is always regenerated fresh from the shipment.

import PDFDocument from "pdfkit";
import type { CustomsInvoiceBox, CustomsInvoiceModel, CustomsInvoiceParty } from "./customsInvoiceModel.service.js";
import { customsInvoiceFooterNote } from "./customsInvoiceConstants.js";

const pageMargin = 32;
const pageWidth = 595.28; // A4 portrait
const contentLeft = pageMargin;
const contentRight = pageWidth - pageMargin;
const contentWidth = contentRight - contentLeft;
const pageBottom = 800;

// Item table columns, proportioned like the template: SR NO | DESCRIPTION |
// HS CODE | UNIT TYPE | QUANTITY | UNIT RATES | AMOUNT.
const columnWidths = [34, 168, 78, 55, 60, 62, 74];
const columnOffsets = columnWidths.reduce<number[]>((offsets, width) => {
  offsets.push((offsets.at(-1) ?? contentLeft) + width);
  return offsets;
}, [contentLeft]);

const border = "#000000";

// Section heights, in PDF points. Generous enough that each band reads as its own
// section rather than a cramped line; named so the PDF stays proportional to the
// Excel export, which uses an equivalent set.
const rowHeights = {
  title: 22,
  metaLine: 13,      // per line inside the other-reference block
  metaMinimum: 42,
  sectionLabel: 19,
  partyLine: 2.5,    // extra leading between party lines
  partyPadding: 18,
  originDestination: 22,
  noteMinimum: 22,
  notePadding: 12,
  tableHeading: 28,
  boxHeader: 24,
  itemMinimum: 22,
  itemPadding: 12,
  total: 32,
  footerLabel: 20,
  footerNoteMinimum: 54
};

function money(value: number) {
  return value.toFixed(2);
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Kolkata"
  }).format(value).replaceAll("/", "-");
}

function box(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number) {
  doc.rect(x, y, width, height).lineWidth(0.8).strokeColor(border).stroke();
}

/** Height a party block needs, so both sides of the header can share one row. */
function partyLines(party: CustomsInvoiceParty): string[] {
  const lines = [`COMPANY NAME : ${party.companyName}`];
  if (party.address) lines.push(`ADDRESS : ${party.address}`);
  lines.push([party.countryName, party.postcode].filter(Boolean).join(", "));
  if (party.email) lines.push(`EMAIL ${party.email}`);
  if (party.phone) lines.push(`PHONE NUMBER : ${party.phone}`);
  return lines;
}

function drawParty(doc: PDFKit.PDFDocument, party: CustomsInvoiceParty, x: number, y: number, width: number) {
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#000000")
    .text(party.name.toUpperCase(), x + 6, y + 8, { width: width - 12 });
  let cursor = doc.y + rowHeights.partyLine;
  doc.font("Helvetica").fontSize(7.5);
  for (const line of partyLines(party)) {
    doc.text(line, x + 6, cursor, { width: width - 12 });
    cursor = doc.y + rowHeights.partyLine;
  }
  return cursor;
}

function measurePartyHeight(doc: PDFKit.PDFDocument, party: CustomsInvoiceParty, width: number) {
  let height = doc.font("Helvetica-Bold").fontSize(8.5).heightOfString(party.name.toUpperCase(), { width: width - 12 });
  doc.font("Helvetica").fontSize(7.5);
  for (const line of partyLines(party)) {
    height += doc.heightOfString(line, { width: width - 12 }) + rowHeights.partyLine;
  }
  return height + rowHeights.partyPadding;
}

/**
 * Draws the repeating header block and returns the y the item table starts at.
 */
function drawHeader(doc: PDFKit.PDFDocument, invoice: CustomsInvoiceModel) {
  let y = pageMargin;

  // Title
  box(doc, contentLeft, y, contentWidth, rowHeights.title);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#000000")
    .text("INVOICE", contentLeft, y + 7, { width: contentWidth, align: "center" });
  y += rowHeights.title;

  // Invoice number / date, and the other-reference block beside it.
  const half = contentWidth / 2;
  const referenceLines = ["OTHER REFERENCE"];
  if (invoice.otherReference) referenceLines.push(`REFERENCE : ${invoice.otherReference}`);
  if (invoice.aadhaarNumber) referenceLines.push(`AADHAAR NUMBER : ${invoice.aadhaarNumber}`);
  const metaHeight = Math.max(rowHeights.metaMinimum, referenceLines.length * rowHeights.metaLine + 12);

  box(doc, contentLeft, y, half, metaHeight);
  box(doc, contentLeft + half, y, half, metaHeight);
  doc.font("Helvetica-Bold").fontSize(7.5).text(
    `INVOICE NO. : ${invoice.invoiceNumber}    INVOICE DATE. : ${formatDate(invoice.invoiceDate)}`,
    contentLeft + 6, y + 8, { width: half - 10 }
  );
  doc.font("Helvetica-Bold").fontSize(7.5).text(referenceLines[0]!, contentLeft + half + 6, y + 8, { width: half - 10 });
  doc.font("Helvetica").fontSize(7.5);
  referenceLines.slice(1).forEach((line, index) => {
    doc.text(line, contentLeft + half + 6, y + 20 + index * rowHeights.metaLine, { width: half - 10 });
  });
  y += metaHeight;

  // Shipper / consignee labels
  box(doc, contentLeft, y, half, rowHeights.sectionLabel);
  box(doc, contentLeft + half, y, half, rowHeights.sectionLabel);
  doc.font("Helvetica-Bold").fontSize(7.5).text("SHIPPER", contentLeft + 6, y + 6, { width: half - 10 });
  doc.text("CONSIGNEE", contentLeft + half + 6, y + 6, { width: half - 10 });
  y += rowHeights.sectionLabel;

  // Party details, both boxes sharing the taller of the two heights.
  const partyHeight = Math.max(
    measurePartyHeight(doc, invoice.shipper, half),
    measurePartyHeight(doc, invoice.consignee, half)
  );
  box(doc, contentLeft, y, half, partyHeight);
  box(doc, contentLeft + half, y, half, partyHeight);
  drawParty(doc, invoice.shipper, contentLeft, y, half);
  drawParty(doc, invoice.consignee, contentLeft + half, y, half);
  y += partyHeight;

  // Country of origin / destination
  const quarter = contentWidth / 4;
  box(doc, contentLeft, y, quarter, rowHeights.originDestination);
  box(doc, contentLeft + quarter, y, quarter, rowHeights.originDestination);
  box(doc, contentLeft + quarter * 2, y, quarter, rowHeights.originDestination);
  box(doc, contentLeft + quarter * 3, y, quarter, rowHeights.originDestination);
  doc.font("Helvetica-Bold").fontSize(7.5);
  doc.text("COUNTRY OF ORIGIN", contentLeft + 6, y + 8, { width: quarter - 10 });
  doc.text(invoice.countryOfOrigin, contentLeft + quarter, y + 8, { width: quarter, align: "center" });
  doc.text("DESTINATION", contentLeft + quarter * 2, y + 8, { width: quarter, align: "center" });
  doc.text(invoice.destination, contentLeft + quarter * 3, y + 8, { width: quarter, align: "center" });
  y += rowHeights.originDestination;

  // Note
  const noteHeight = Math.max(rowHeights.noteMinimum, doc.font("Helvetica-Bold").fontSize(7.5)
    .heightOfString(invoice.note, { width: contentWidth - quarter - 10 }) + rowHeights.notePadding);
  box(doc, contentLeft, y, quarter, noteHeight);
  box(doc, contentLeft + quarter, y, contentWidth - quarter, noteHeight);
  doc.text("NOTE", contentLeft + 6, y + 8, { width: quarter - 10 });
  doc.text(invoice.note, contentLeft + quarter + 6, y + 8, { width: contentWidth - quarter - 10, align: "center" });
  y += noteHeight;

  // Item table column headings
  box(doc, contentLeft, y, contentWidth, rowHeights.tableHeading);
  const headings = ["SR. NO.", "DESCRIPTION", "HS CODE", "UNIT TYPE", "QUANTITY", "UNIT RATES", "AMOUNT"];
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#000000");
  headings.forEach((heading, index) => {
    const x = columnOffsets[index]!;
    if (index > 0) doc.moveTo(x, y).lineTo(x, y + rowHeights.tableHeading).lineWidth(0.8).strokeColor(border).stroke();
    doc.text(heading, x + 3, y + 10, { width: columnWidths[index]! - 6, align: "center" });
  });
  y += rowHeights.tableHeading;

  return y;
}

function drawBoxHeader(doc: PDFKit.PDFDocument, parcel: CustomsInvoiceBox, y: number) {
  const dimensions = parcel.lengthCm && parcel.widthCm && parcel.heightCm
    ? `${parcel.lengthCm.toFixed(2)} * ${parcel.widthCm.toFixed(2)} * ${parcel.heightCm.toFixed(2)}`
    : "NOT PROVIDED";
  box(doc, contentLeft, y, contentWidth, rowHeights.boxHeader);
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000").text(
    `BOX NO: ${parcel.boxNumber} , DIMENSIONS (CMS) ${dimensions} , ACTUAL WEIGHT - ${parcel.actualWeightKg.toFixed(2)} KG`,
    contentLeft, y + 8, { width: contentWidth, align: "center" }
  );
  return y + rowHeights.boxHeader;
}

export function createCustomsInvoicePdf(invoice: CustomsInvoiceModel) {
  const doc = new PDFDocument({ size: "A4", margin: pageMargin, bufferPages: true });
  let y = drawHeader(doc, invoice);

  for (const parcel of invoice.boxes) {
    // Keep a box header with at least its first row rather than orphaning it.
    if (y + rowHeights.boxHeader + rowHeights.itemMinimum > pageBottom) {
      doc.addPage();
      y = drawHeader(doc, invoice);
    }
    y = drawBoxHeader(doc, parcel, y);

    for (const item of parcel.items) {
      const rowHeight = Math.max(rowHeights.itemMinimum, doc.font("Helvetica").fontSize(7.5)
        .heightOfString(item.description, { width: columnWidths[1]! - 6 }) + rowHeights.itemPadding);

      if (y + rowHeight > pageBottom) {
        doc.addPage();
        y = drawHeader(doc, invoice);
        y = drawBoxHeader(doc, parcel, y);
      }

      box(doc, contentLeft, y, contentWidth, rowHeight);
      const values = [
        String(item.serialNumber),
        item.description,
        item.hsCode,
        item.unitType,
        String(item.quantity),
        money(item.unitRate),
        money(item.amount)
      ];
      doc.font("Helvetica").fontSize(7.5).fillColor("#000000");
      values.forEach((value, index) => {
        const x = columnOffsets[index]!;
        if (index > 0) doc.moveTo(x, y).lineTo(x, y + rowHeight).lineWidth(0.8).strokeColor(border).stroke();
        doc.text(value, x + 3, y + 7, {
          width: columnWidths[index]! - 6,
          align: index === 1 ? "left" : "center"
        });
      });
      y += rowHeight;
    }
  }

  // Amount chargeable footer
  if (y + rowHeights.total + rowHeights.footerLabel + rowHeights.footerNoteMinimum > pageBottom) {
    doc.addPage();
    y = drawHeader(doc, invoice);
  }
  const wordsWidth = contentWidth - 150;
  box(doc, contentLeft, y, 110, rowHeights.total);
  box(doc, contentLeft + 110, y, wordsWidth - 110 + 40, rowHeights.total);
  box(doc, contentLeft + wordsWidth + 40, y, contentWidth - wordsWidth - 40, rowHeights.total);
  doc.font("Helvetica-Bold").fontSize(7.5).text("AMOUNT CHARGEABLE", contentLeft + 6, y + 12, { width: 100 });
  doc.font("Helvetica").fontSize(7.5)
    .text(invoice.totalAmountInWords, contentLeft + 115, y + 12, { width: wordsWidth - 80 });
  doc.font("Helvetica-Bold").fontSize(8).text(
    `TOTAL: ${money(invoice.totalAmount)} ${invoice.currency}`,
    contentLeft + wordsWidth + 45, y + 12, { width: contentWidth - wordsWidth - 50, align: "right" }
  );
  y += rowHeights.total;

  // Notes / signature
  const half = contentWidth / 2;
  box(doc, contentLeft, y, half, rowHeights.footerLabel);
  box(doc, contentLeft + half, y, half, rowHeights.footerLabel);
  doc.font("Helvetica-Bold").fontSize(7.5).text("NOTES", contentLeft + 6, y + 6, { width: half - 10 });
  doc.text("SIGNATURE / STAMP", contentLeft + half + 6, y + 6, { width: half - 10 });
  y += rowHeights.footerLabel;

  const footerNoteHeight = Math.max(rowHeights.footerNoteMinimum, doc.font("Helvetica").fontSize(7.5)
    .heightOfString(invoice.note, { width: half - 10 }) + 14);
  box(doc, contentLeft, y, half, footerNoteHeight);
  box(doc, contentLeft + half, y, half, footerNoteHeight);
  doc.font("Helvetica").fontSize(7.5).text(invoice.note, contentLeft + 6, y + 8, { width: half - 12 });
  doc.font("Helvetica").fontSize(7).fillColor("#475569").text(
    "For Swiftline Cargo and Express Logistics Pvt. Ltd.",
    contentLeft + half + 6, y + footerNoteHeight - 16, { width: half - 12, align: "right" }
  );
  y += footerNoteHeight;

  doc.font("Helvetica").fontSize(7).fillColor("#475569").text(
    customsInvoiceFooterNote,
    contentLeft, y + 12, { width: contentWidth, align: "center" }
  );

  doc.end();
  return doc;
}

export function renderCustomsInvoicePdfBuffer(invoice: CustomsInvoiceModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = createCustomsInvoicePdf(invoice);
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}
