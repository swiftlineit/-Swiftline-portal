import ExcelJS from "exceljs";
import type { IRateCardShare } from "../models/rateCardShare.model.js";
import { formatShareService, groupShareRows, rateCardDisplayAmount, rateCardGstLabel } from "./rateCardShare.service.js";
import { buildTermsLines } from "./rateCardSharePdf.service.js";

// ExcelJS wants ARGB without the "#".
const BRAND = "FF0D1282";
const INK = "FF0F172A";
const MUTED = "FF64748B";
const HEADER_FILL = "FFE2E8F0";
const ZEBRA = "FFF8FAFC";
const WHITE = "FFFFFFFF";

const HEADERS = ["Country", "Code", "Service", "From KG", "To KG", "Rate / KG", "Max Box KG", "GST", "GST %"];
const COLUMN_WIDTHS = [28, 8, 12, 12, 12, 16, 14, 16, 8];

function date(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata"
  }).format(value);
}

function fill(cell: ExcelJS.Cell, argb: string) {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function outline(cell: ExcelJS.Cell) {
  const edge = { style: "thin" as const, color: { argb: "FFE2E8F0" } };
  cell.border = { top: edge, left: edge, bottom: edge, right: edge };
}

/**
 * Two sheets: "Rate Card" carries the tariff a customer will filter and sort,
 * and "Terms" carries the same commercial terms the PDF prints. The rate sheet
 * deliberately stays a flat table with one header row so Excel's own filter,
 * sort and pivot tools work on it- a merged, decorated layout would look
 * better and be useless.
 */
export async function buildRateCardShareWorkbook(share: IRateCardShare, recipientLabel: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Swiftline Portal";
  workbook.created = share.createdAt;

  const sheet = workbook.addWorksheet("Rate Card", {
    views: [{ state: "frozen", ySplit: 8 }],
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });

  COLUMN_WIDTHS.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });

  const titleRow = sheet.addRow([
    share.adjustmentMode === "NONE" ? "YOUR SWIFTLINE RATE CARD" : "SWIFTLINE EXTERNAL RATE PROPOSAL"
  ]);
  sheet.mergeCells(titleRow.number, 1, titleRow.number, HEADERS.length);
  titleRow.height = 26;
  titleRow.getCell(1).font = { bold: true, size: 14, color: { argb: BRAND } };
  titleRow.getCell(1).alignment = { vertical: "middle" };

  const metadata: Array<[string, string]> = [
    ["Reference", share.shareNumber],
    ["Prepared for", recipientLabel],
    ["Rates valid", `${date(share.terms.validFrom)} to ${date(share.terms.validUntil)}`],
    ["Currency", `${share.currency} per kilogram`],
    ["Issued", date(share.createdAt)]
  ];

  for (const [label, value] of metadata) {
    const row = sheet.addRow([label, value]);
    sheet.mergeCells(row.number, 2, row.number, HEADERS.length);
    row.getCell(1).font = { bold: true, size: 9, color: { argb: MUTED } };
    row.getCell(2).font = { size: 10, color: { argb: INK } };
  }

  sheet.addRow([]);

  const headerRow = sheet.addRow(HEADERS);
  headerRow.height = 20;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 9, color: { argb: WHITE } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    fill(cell, BRAND);
  });

  let striped = 0;
  for (const group of groupShareRows(share.rows)) {
    for (const row of group.rows) {
      const dataRow = sheet.addRow([
        group.countryName,
        group.countryCode,
        formatShareService(group.service),
        row.fromKg,
        row.toKg,
        rateCardDisplayAmount(row),
        row.maxBoxKg,
        rateCardGstLabel(row),
        row.gstRatePercent ?? 0
      ]);
      dataRow.height = 17;
      const zebra = striped % 2 === 1;
      dataRow.eachCell((cell) => {
        cell.font = { size: 10, color: { argb: INK } };
        cell.alignment = { vertical: "middle" };
        outline(cell);
        if (zebra) fill(cell, ZEBRA);
      });
      // Weights read as plain numbers; the rate is money and carries the symbol
      // so a pasted column keeps its meaning.
      dataRow.getCell(4).numFmt = "0.00";
      dataRow.getCell(5).numFmt = "0.00";
      dataRow.getCell(6).numFmt = `"${share.currency} "#,##0.00`;
      dataRow.getCell(6).font = { size: 10, bold: true, color: { argb: INK } };
      dataRow.getCell(7).numFmt = "0.00";
      striped += 1;
    }
  }

  sheet.autoFilter = {
    from: { row: headerRow.number, column: 1 },
    to: { row: headerRow.number + striped, column: HEADERS.length }
  };

  const termsSheet = workbook.addWorksheet("Terms", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  termsSheet.getColumn(1).width = 4;
  termsSheet.getColumn(2).width = 110;

  const termsTitle = termsSheet.addRow(["", "COMMERCIAL TERMS"]);
  termsTitle.height = 24;
  termsTitle.getCell(2).font = { bold: true, size: 13, color: { argb: BRAND } };

  const reference = termsSheet.addRow(["", `${share.shareNumber}- valid ${date(share.terms.validFrom)} to ${date(share.terms.validUntil)}`]);
  reference.getCell(2).font = { size: 9, color: { argb: MUTED } };
  termsSheet.addRow([]);

  for (const term of buildTermsLines(share)) {
    const row = termsSheet.addRow(["•", term]);
    row.getCell(1).font = { size: 10, color: { argb: BRAND } };
    row.getCell(2).font = { size: 10, color: { argb: INK } };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    row.height = Math.max(16, Math.ceil(term.length / 95) * 15);
  }

  if (share.terms.remarks) {
    termsSheet.addRow([]);
    const remarksTitle = termsSheet.addRow(["", "REMARKS"]);
    remarksTitle.getCell(2).font = { bold: true, size: 10, color: { argb: BRAND } };
    const remarks = termsSheet.addRow(["", share.terms.remarks]);
    remarks.getCell(2).font = { size: 10, color: { argb: INK } };
    remarks.getCell(2).alignment = { wrapText: true, vertical: "top" };
    remarks.height = Math.max(16, Math.ceil(share.terms.remarks.length / 95) * 15);
    fill(remarks.getCell(2), HEADER_FILL);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
