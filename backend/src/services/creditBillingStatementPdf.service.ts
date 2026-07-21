import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import type { serializeCreditBillingStatement } from "./creditBillingCycle.service.js";

type StatementDocument = ReturnType<typeof serializeCreditBillingStatement>;

function date(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(value).replaceAll("/", "-");
}

function money(amountMinor: number) {
  return `INR ${new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amountMinor / 100)}`;
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number) {
  doc.rect(42, y, 507, 25).fill("#0f2f5f");
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#ffffff");
  doc.text("INVOICE", 48, y + 9, { width: 145 });
  doc.text("VERSION", 200, y + 9, { width: 60, align: "center" });
  doc.text("INVOICE DATE", 267, y + 9, { width: 105, align: "center" });
  doc.text("OUTSTANDING", 380, y + 9, { width: 163, align: "right" });
}

export function createCreditBillingStatementPdf(input: {
  statement: StatementDocument;
  customer: { accountId: string; companyName: string };
}) {
  const { statement, customer } = input;
  const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true });
  const logoPath = path.resolve(process.cwd(), "assets", "swiftline-invoice-logo.jpeg");

  if (fs.existsSync(logoPath)) doc.image(logoPath, 42, 38, { fit: [190, 58] });
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#0f172a").text("CREDIT BILLING STATEMENT", 290, 42, { width: 259, align: "right" });
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text("NON-TAX COLLECTION DOCUMENT", 290, 65, { width: 259, align: "right" });
  doc.font("Helvetica").fontSize(8).fillColor("#0f172a").text(`Statement No: ${statement.statementNumber}`, 290, 82, { width: 259, align: "right" });
  doc.text(`Issued: ${date(statement.issuedAt)}`, 290, 94, { width: 259, align: "right" });
  doc.text(`Due: ${date(statement.dueAt)}`, 290, 106, { width: 259, align: "right" });
  doc.moveTo(42, 122).lineTo(549, 122).lineWidth(1.5).strokeColor("#0f172a").stroke();

  doc.rect(42, 138, 507, 82).strokeColor("#cbd5e1").stroke();
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text("CUSTOMER", 54, 150);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text(customer.companyName, 54, 168, { width: 300 });
  doc.font("Helvetica").fontSize(8).text(`Business Account: ${customer.accountId}`, 54, 188, { width: 300 });
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#64748b").text("BILLING PERIOD", 375, 150, { width: 160, align: "right" });
  const inclusivePeriodEnd = new Date(statement.periodEnd.getTime() - 1);
  doc.font("Helvetica").fontSize(9).fillColor("#0f172a").text(`${date(statement.periodStart)} to ${date(inclusivePeriodEnd)}`, 355, 168, { width: 180, align: "right" });
  doc.text(statement.billingCycle, 375, 188, { width: 160, align: "right" });

  let y = 242;
  drawTableHeader(doc, y);
  y += 25;
  for (const line of statement.lines) {
    if (y > 730) {
      doc.addPage();
      y = 48;
      drawTableHeader(doc, y);
      y += 25;
    }
    doc.rect(42, y, 507, 30).strokeColor("#cbd5e1").stroke();
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a").text(line.invoiceNumber, 48, y + 10, { width: 145 });
    doc.font("Helvetica").text(String(line.invoiceRevision), 200, y + 10, { width: 60, align: "center" });
    doc.text(date(line.invoiceIssuedAt), 267, y + 10, { width: 105, align: "center" });
    doc.font("Helvetica-Bold").text(money(line.outstandingAmountMinor), 380, y + 10, { width: 163, align: "right" });
    y += 30;
  }

  if (statement.adjustments.length) {
    y += 14;
    if (y > 700) {
      doc.addPage();
      y = 48;
    }
    doc.rect(42, y, 507, 25).fill("#e2e8f0");
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#334155");
    doc.text("BILLING ADJUSTMENT", 48, y + 9, { width: 350 });
    doc.text("AMOUNT", 405, y + 9, { width: 138, align: "right" });
    y += 25;
    for (const adjustment of statement.adjustments) {
      const height = 38;
      doc.rect(42, y, 507, height).strokeColor("#cbd5e1").stroke();
      doc.font("Helvetica").fontSize(8).fillColor("#0f172a").text(adjustment.description, 48, y + 9, { width: 350 });
      doc.font("Helvetica-Bold").text(money(adjustment.amountMinor), 405, y + 9, { width: 138, align: "right" });
      y += height;
    }
  }

  y += 16;
  doc.rect(330, y, 219, 88).strokeColor("#0f172a").stroke();
  doc.font("Helvetica").fontSize(9).fillColor("#0f172a").text("Statement Total", 342, y + 10, { width: 95 });
  doc.font("Helvetica-Bold").text(money(statement.totalAmountMinor), 437, y + 10, { width: 100, align: "right" });
  doc.font("Helvetica").text("Paid", 342, y + 34, { width: 95 });
  doc.font("Helvetica-Bold").text(money(statement.paidAmountMinor + statement.creditAdjustmentMinor), 437, y + 34, { width: 100, align: "right" });
  doc.font("Helvetica").text("Outstanding", 342, y + 60, { width: 95 });
  doc.font("Helvetica-Bold").fontSize(11).text(money(statement.outstandingAmountMinor), 437, y + 59, { width: 100, align: "right" });

  doc.font("Helvetica-Bold").fontSize(8).fillColor("#0f172a").text("Important", 42, y + 4);
  doc.font("Helvetica").fontSize(8).fillColor("#475569").text(
    "This statement groups unpaid shipment tax invoices for collection. GST is recorded only on the individual shipment tax invoices and is not charged again on this statement.",
    42,
    y + 20,
    { width: 260, lineGap: 3 }
  );

  const range = doc.bufferedPageRange();
  for (let page = range.start; page < range.start + range.count; page += 1) {
    doc.switchToPage(page);
    doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(
      `This is a computer generated credit billing statement from Swiftline Portal | Page ${page + 1} of ${range.count}`,
      42,
      806,
      { width: 507, align: "center" }
    );
  }

  return doc;
}
