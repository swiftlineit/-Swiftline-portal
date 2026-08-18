import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import type { IRateCardShare } from "../models/rateCardShare.model.js";
import { formatShareService, groupShareRows } from "./rateCardShare.service.js";

// The portal's brand navy, matching the client shell chrome. Everything else is
// slate, so the sheet reads as one document rather than a palette.
const BRAND = "#0D1282";
const INK = "#0f172a";
const MUTED = "#64748b";
const BORDER = "#cbd5e1";
const ZEBRA = "#f8fafc";

const LEFT = 42;
const RIGHT = 549;
const WIDTH = RIGHT - LEFT;
const PAGE_BOTTOM = 762;

// From KG | To KG | Rate / KG | Max Box KG, summing to WIDTH.
const COLUMNS = [
  { label: "FROM KG", width: 110, align: "left" as const },
  { label: "TO KG", width: 110, align: "left" as const },
  { label: "RATE / KG", width: 160, align: "right" as const },
  { label: "MAX BOX KG", width: 127, align: "right" as const }
];

function columnX(index: number) {
  return LEFT + COLUMNS.slice(0, index).reduce((sum, column) => sum + column.width, 0);
}

function date(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata"
  }).format(value);
}

/**
 * Standard PDF Helvetica is WinAnsi-encoded and has no rupee glyph, so the
 * currency is spelled out rather than rendering as a blank box.
 */
function rate(value: number, currency: string) {
  return `${currency} ${new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  }).format(value)}`;
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number) {
  doc.rect(LEFT, y, WIDTH, 20).fill("#e2e8f0");
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#475569");
  COLUMNS.forEach((column, index) => {
    doc.text(column.label, columnX(index) + 10, y + 7, { width: column.width - 20, align: column.align });
  });
  return y + 20;
}

function drawCountryStrip(doc: PDFKit.PDFDocument, y: number, countryName: string, countryCode: string, service: string) {
  doc.rect(LEFT, y, WIDTH, 26).fill(BRAND);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#ffffff")
    .text(`${countryName.toUpperCase()} (${countryCode})`, LEFT + 12, y + 8, { width: 320 });
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#c7d2fe")
    .text(formatShareService(service).toUpperCase(), RIGHT - 172, y + 10, { width: 160, align: "right" });
  return y + 26;
}

function drawSectionTitle(doc: PDFKit.PDFDocument, y: number, title: string) {
  doc.font("Helvetica-Bold").fontSize(9).fillColor(BRAND).text(title.toUpperCase(), LEFT, y, { width: WIDTH, characterSpacing: 0.6 });
  doc.moveTo(LEFT, y + 14).lineTo(RIGHT, y + 14).lineWidth(0.8).strokeColor(BRAND).stroke();
  return y + 24;
}

/**
 * Builds the shareable rate card. Rows are grouped country-then-service and the
 * slab table header repeats on every page break, so a sheet that runs to four
 * pages stays readable printed and unstapled.
 */
export function createRateCardSharePdf(share: IRateCardShare, recipientLabel: string) {
  const doc = new PDFDocument({ size: "A4", margin: LEFT, bufferPages: true });
  const logoPath = path.resolve(process.cwd(), "assets", "swiftline-invoice-logo.jpeg");

  if (fs.existsSync(logoPath)) doc.image(logoPath, LEFT, 38, { fit: [170, 52] });
  doc.font("Helvetica-Bold").fontSize(17).fillColor(INK)
    .text(share.adjustmentMode === "NONE" ? "YOUR SWIFTLINE RATE CARD" : "EXTERNAL RATE PROPOSAL", 250, 42, { width: 299, align: "right" });
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED)
    .text("COURIER & CARGO TARIFF", 290, 64, { width: 259, align: "right", characterSpacing: 0.8 });
  doc.font("Helvetica").fontSize(8).fillColor(INK)
    .text(`Reference: ${share.shareNumber}`, 290, 80, { width: 259, align: "right" });
  doc.text(`Issued: ${date(share.createdAt)}`, 290, 92, { width: 259, align: "right" });
  doc.moveTo(LEFT, 108).lineTo(RIGHT, 108).lineWidth(1.5).strokeColor(BRAND).stroke();

  // Prepared-for panel. The validity window sits opposite the customer name
  // because "until when" is the first question a rate sheet has to answer.
  doc.rect(LEFT, 124, WIDTH, 74).fillAndStroke(ZEBRA, BORDER);
  doc.font("Helvetica-Bold").fontSize(7).fillColor(MUTED).text("PREPARED FOR", LEFT + 12, 136, { characterSpacing: 0.6 });
  doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(recipientLabel, LEFT + 12, 152, { width: 290 });
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(share.title, LEFT + 12, 174, { width: 290 });

  doc.font("Helvetica-Bold").fontSize(7).fillColor(MUTED).text("RATES VALID", RIGHT - 192, 136, { width: 180, align: "right", characterSpacing: 0.6 });
  doc.font("Helvetica-Bold").fontSize(11).fillColor(INK)
    .text(`${date(share.terms.validFrom)}  -  ${date(share.terms.validUntil)}`, RIGHT - 232, 152, { width: 220, align: "right" });
  doc.font("Helvetica").fontSize(8).fillColor(MUTED)
    .text(`All rates in ${share.currency}, per kilogram`, RIGHT - 232, 176, { width: 220, align: "right" });

  let y = drawSectionTitle(doc, 220, "Weight slabs & rates");
  y = drawTableHeader(doc, y);

  for (const group of groupShareRows(share.rows)) {
    // A country strip plus its header and first row must not be orphaned at the
    // foot of a page- 90pt is that block's height.
    if (y + 90 > PAGE_BOTTOM) {
      doc.addPage();
      y = 56;
    }

    y = drawCountryStrip(doc, y, group.countryName, group.countryCode, group.service);
    y = drawTableHeader(doc, y);

    group.rows.forEach((row, index) => {
      if (y + 22 > PAGE_BOTTOM) {
        doc.addPage();
        y = 56;
        y = drawCountryStrip(doc, y, group.countryName, group.countryCode, `${group.service} (continued)`);
        y = drawTableHeader(doc, y);
      }

      if (index % 2 === 1) doc.rect(LEFT, y, WIDTH, 22).fill(ZEBRA);
      doc.rect(LEFT, y, WIDTH, 22).lineWidth(0.5).strokeColor("#e2e8f0").stroke();

      const values = [
        `${row.fromKg}`,
        `${row.toKg}`,
        rate(row.chargesPerKg, share.currency),
        `${row.maxBoxKg}`
      ];

      values.forEach((value, index_) => {
        const column = COLUMNS[index_];
        if (!column) return;
        doc.font(index_ === 2 ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(INK)
          .text(value, columnX(index_) + 10, y + 7, { width: column.width - 20, align: column.align });
      });

      y += 22;
    });

    y += 14;
  }

  const terms = buildTermsLines(share);
  if (terms.length) {
    if (y + 60 + terms.length * 14 > PAGE_BOTTOM) {
      doc.addPage();
      y = 56;
    }

    y = drawSectionTitle(doc, y + 6, "Commercial terms");
    for (const term of terms) {
      if (y + 16 > PAGE_BOTTOM) {
        doc.addPage();
        y = 56;
      }
      doc.circle(LEFT + 3, y + 4.5, 1.8).fill(BRAND);
      doc.font("Helvetica").fontSize(8.5).fillColor("#334155").text(term, LEFT + 14, y, { width: WIDTH - 14, lineGap: 2 });
      y += Math.max(doc.heightOfString(term, { width: WIDTH - 14, lineGap: 2 }), 12) + 5;
    }
  }

  if (share.terms.remarks) {
    if (y + 70 > PAGE_BOTTOM) {
      doc.addPage();
      y = 56;
    }
    y = drawSectionTitle(doc, y + 8, "Remarks");
    doc.font("Helvetica").fontSize(8.5).fillColor("#334155").text(share.terms.remarks, LEFT, y, { width: WIDTH, lineGap: 3 });
  }

  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page += 1) {
    doc.switchToPage(page);
    doc.moveTo(LEFT, 790).lineTo(RIGHT, 790).lineWidth(0.5).strokeColor(BORDER).stroke();
    doc.font("Helvetica").fontSize(7).fillColor(MUTED).text(
      `${share.shareNumber}  |  Rates valid to ${date(share.terms.validUntil)}  |  Computer generated by Swiftline Portal  |  Page ${page + 1} of ${range.count}`,
      LEFT,
      798,
      { width: WIDTH, align: "center" }
    );
  }

  return doc;
}

/**
 * The terms a freight rate sheet is expected to state. Zeroed fields are left
 * out rather than printed as "0%", which would read as a commitment.
 */
export function buildTermsLines(share: IRateCardShare) {
  const { terms } = share;
  const lines: string[] = [
    `Rates are quoted in ${share.currency} per kilogram and apply to the weight slabs listed above.`,
    `This rate card is valid from ${date(terms.validFrom)} to ${date(terms.validUntil)} and supersedes all previous rate cards.`
  ];

  if (terms.fuelSurchargePercent > 0) lines.push(`A fuel surcharge of ${terms.fuelSurchargePercent}% applies on the net freight and is revised monthly.`);
  if (terms.gstPercent > 0) lines.push(`GST at ${terms.gstPercent}% is charged additionally as applicable under Indian tax law.`);
  if (terms.minChargeableWeightKg > 0) lines.push(`Minimum chargeable weight is ${terms.minChargeableWeightKg} kg per shipment.`);
  if (terms.volumetricDivisor > 0) lines.push(`Chargeable weight is the greater of actual weight and volumetric weight (L x W x H in cm / ${terms.volumetricDivisor}).`);

  lines.push(
    "Rates exclude duties, taxes, customs clearance charges and any charges levied at destination.",
    "Rates are subject to revision on account of carrier tariff changes, currency movement or regulatory action.",
    "Shipments are accepted subject to Swiftline's standard terms and conditions of carriage."
  );

  for (const charge of share.routeCharges ?? []) {
    const details = [
      charge.fuelSurchargePercent > 0 ? `fuel ${charge.fuelSurchargePercent}%` : "",
      charge.remoteAreaCharge > 0 ? `remote area ${share.currency} ${charge.remoteAreaCharge.toFixed(2)}` : "",
      charge.handlingCharge > 0 ? `handling ${share.currency} ${charge.handlingCharge.toFixed(2)}` : "",
      charge.insurancePercent > 0
        ? `insurance ${charge.insurancePercent}% (minimum ${share.currency} ${charge.insuranceMinimum.toFixed(2)})`
        : "",
      charge.discountPercent > 0 ? `discount ${charge.discountPercent}%` : ""
    ].filter(Boolean);
    lines.push(`${charge.countryCode} ${formatShareService(charge.service)} route charges: ${details.length ? details.join(", ") : "none"}.`);
    if (charge.remoteAreaPostcodes.length) {
      lines.push(`${charge.countryCode} ${formatShareService(charge.service)} remote postcode prefixes: ${charge.remoteAreaPostcodes.join(", ")}.`);
    }
  }

  return [...lines, ...terms.customTerms.filter((term) => term.trim())];
}
