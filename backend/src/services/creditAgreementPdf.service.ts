import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import type { ICreditAgreement } from "../models/creditAgreement.model.js";

const PAGE_WIDTH = 595.28;
const CONTENT_LEFT = 44;
const CONTENT_WIDTH = PAGE_WIDTH - 88;

function formatDate(value: Date | null | undefined) {
  if (!value) return "Not specified";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(value).replaceAll("/", "-");
}

function formatMoney(minor: number) {
  return `INR ${new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(minor / 100)}`;
}

function value(input: string | null | undefined) {
  return input?.trim() || "Not provided";
}

function drawField(doc: PDFKit.PDFDocument, label: string, fieldValue: string, x: number, y: number, width: number) {
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#64748b").text(label.toUpperCase(), x, y, { width });
  doc.font("Helvetica").fontSize(9).fillColor("#0f172a").text(fieldValue, x, y + 12, { width, lineGap: 2 });
}

function drawSectionTitle(doc: PDFKit.PDFDocument, title: string, y: number) {
  doc.rect(CONTENT_LEFT, y, CONTENT_WIDTH, 25).fill("#0f2f5f");
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text(title.toUpperCase(), CONTENT_LEFT + 10, y + 8, {
    width: CONTENT_WIDTH - 20
  });
}

function drawClause(doc: PDFKit.PDFDocument, number: number, title: string, body: string, y: number) {
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a").text(`${number}. ${title}`, CONTENT_LEFT, y, {
    width: CONTENT_WIDTH
  });
  doc.font("Helvetica").fontSize(8.5).fillColor("#334155").text(body, CONTENT_LEFT, y + 15, {
    width: CONTENT_WIDTH,
    lineGap: 3,
    align: "justify"
  });
  return doc.y + 12;
}

type AgreementSignature = {
  name: string;
  email: string;
  jobTitle: string;
  signedAt: Date;
};

export function createCreditAgreementPdf(agreement: ICreditAgreement, generatedAt: Date, signature?: AgreementSignature) {
  const doc = new PDFDocument({ size: "A4", margin: CONTENT_LEFT, bufferPages: true, info: {
    Title: `Credit Account Agreement ${agreement.agreementNumber}`,
    Author: "Swiftline Cargo and Express Logistics Pvt. Ltd.",
    Subject: "Business credit account agreement",
    CreationDate: generatedAt,
    ModDate: generatedAt
  } });
  const { business, credit } = agreement.snapshot;
  const logoPath = path.resolve(process.cwd(), "assets", "swiftline-invoice-logo.jpeg");

  if (fs.existsSync(logoPath)) doc.image(logoPath, CONTENT_LEFT, 38, { fit: [180, 54] });
  else doc.font("Helvetica-Bold").fontSize(22).fillColor("#17468f").text("Swiftline", CONTENT_LEFT, 46);

  doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f172a").text("CREDIT ACCOUNT AGREEMENT", 280, 42, {
    width: 271,
    align: "right"
  });
  doc.font("Helvetica").fontSize(8).fillColor("#475569");
  doc.text(`Agreement No: ${agreement.agreementNumber}`, 280, 67, { width: 271, align: "right" });
  doc.text(`Version: ${agreement.version} | Terms: ${agreement.termsVersion}`, 280, 79, { width: 271, align: "right" });
  doc.text(`Generated: ${formatDate(generatedAt)}`, 280, 91, { width: 271, align: "right" });
  doc.moveTo(CONTENT_LEFT, 112).lineTo(CONTENT_LEFT + CONTENT_WIDTH, 112).lineWidth(1.5).strokeColor("#0f172a").stroke();

  drawSectionTitle(doc, "Parties", 128);
  doc.rect(CONTENT_LEFT, 153, CONTENT_WIDTH, 123).strokeColor("#cbd5e1").stroke();
  drawField(doc, "Service Provider", "Swiftline Cargo and Express Logistics Pvt. Ltd.", 56, 166, 230);
  drawField(doc, "Customer", business.companyName, 305, 166, 230);
  drawField(doc, "Business Account", business.accountId, 56, 204, 230);
  drawField(doc, "GSTIN / Registration", business.gstin || business.registrationId || "Not provided", 305, 204, 230);
  drawField(doc, "Authorised Contact", `${value(business.contactName)} | ${value(business.contactEmail)}`, 56, 242, 230);
  drawField(doc, "Registered Address", [business.registeredAddress, business.city, business.stateOrProvince, business.postalCode, business.addressCountry].filter(Boolean).join(", ") || "Not provided", 305, 242, 230);

  drawSectionTitle(doc, "Approved Credit Facility", 296);
  doc.rect(CONTENT_LEFT, 321, CONTENT_WIDTH, 132).strokeColor("#cbd5e1").stroke();
  drawField(doc, "Approved Credit Limit", formatMoney(credit.approvedCreditLimitMinor), 56, 334, 150);
  drawField(doc, "Billing Cycle", credit.billingCycle, 223, 334, 145);
  drawField(doc, "Payment Terms", credit.paymentTermsDays ? `${credit.paymentTermsDays} days` : "Due immediately", 385, 334, 150);
  drawField(doc, "Facility Validity", `${formatDate(credit.validFrom)} to ${formatDate(credit.validUntil)}`, 56, 378, 150);
  drawField(doc, "Grace Period", `${credit.gracePeriodDays} days`, 223, 378, 145);
  drawField(doc, "Maximum Overdue", `${credit.maxOverdueDays} days`, 385, 378, 150);
  drawField(doc, "Warning Threshold", `${credit.creditWarningThresholdPercent}% of approved limit`, 56, 420, 150);
  drawField(doc, "Required Deposit", formatMoney(credit.securityDepositRequiredMinor), 223, 420, 145);
  drawField(doc, "Currency", credit.currency, 385, 420, 150);

  doc.font("Helvetica").fontSize(8.5).fillColor("#334155").text(
    "This agreement records the approved credit facility for the customer named above. The facility becomes usable only after Swiftline completes all required approval, agreement and deposit checks.",
    CONTENT_LEFT,
    477,
    { width: CONTENT_WIDTH, lineGap: 3 }
  );

  doc.addPage();
  drawSectionTitle(doc, "Credit Terms", 44);
  let y = 82;
  y = drawClause(doc, 1, "Use of the facility", "The facility may be used only for eligible Swiftline shipment services booked under the stated business account. The approved limit is shared by authorised members of that business account and does not create a separate personal limit for each member.", y);
  y = drawClause(doc, 2, "Booking capacity", "A shipment can be booked only when the account has enough available booking capacity. Customer advance is applied first and the remaining eligible amount is reserved against approved credit. A security deposit does not form part of booking capacity.", y);
  y = drawClause(doc, 3, "Invoices and amendments", "Swiftline will issue a tax invoice for a booked shipment. If an approved shipment amendment changes the charge, Swiftline may issue a new invoice revision while preserving earlier invoice versions in the shipment record.", y);
  y = drawClause(doc, 4, "Payment and allocation", `Invoices are payable within ${credit.paymentTermsDays} day(s) under a ${credit.billingCycle.toLowerCase()} billing cycle. Customer payments are allocated against outstanding invoices and restore available credit. Any eligible excess is held as customer advance and does not increase the approved credit limit.`, y);
  y = drawClause(doc, 5, "Overdue amounts", `The configured grace period is ${credit.gracePeriodDays} day(s), with a maximum overdue period of ${credit.maxOverdueDays} day(s). Swiftline may warn, restrict booking or suspend the facility when payment or risk conditions are not met.`, y);
  y = drawClause(doc, 6, "Rates and final charges", "Booking estimates are calculated from the applicable rate card and estimated GST. Final charges may change after operational weight verification or an approved amendment. Any additional amount requires sufficient available booking capacity.", y);
  y = drawClause(doc, 7, "Customer responsibility", "The customer is responsible for accurate shipment information, lawful contents, valid tax details and timely payment. Prohibited or restricted goods remain subject to Swiftline policy and applicable law.", y);
  y = drawClause(doc, 8, "Terms document", `This agreement incorporates the Swiftline Payment Terms document version ${agreement.termsVersion}. In case of a conflict, applicable law and the specifically approved facility values recorded in this agreement will govern.`, y);

  const signatureY = Math.max(y + 15, 610);
  doc.rect(CONTENT_LEFT, signatureY, CONTENT_WIDTH, 116).strokeColor("#cbd5e1").stroke();
  doc.moveTo(297.5, signatureY).lineTo(297.5, signatureY + 116).strokeColor("#cbd5e1").stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#0f172a").text("FOR THE CUSTOMER", 56, signatureY + 13, { width: 220 });
  doc.text("FOR SWIFTLINE", 310, signatureY + 13, { width: 225 });
  doc.font("Helvetica").fontSize(8).fillColor("#475569");
  doc.text(`Name: ${signature?.name ?? ""}`, 56, signatureY + 46, { width: 220 });
  doc.text(`Designation: ${signature?.jobTitle ?? ""}`, 56, signatureY + 64, { width: 220 });
  doc.text(`Date: ${signature ? formatDate(signature.signedAt) : ""}`, 56, signatureY + 82, { width: 220 });
  if (signature) doc.fontSize(7).fillColor("#64748b").text(`Electronically accepted by ${signature.email}`, 56, signatureY + 99, { width: 220 });
  doc.text("Authorised Signatory", 310, signatureY + 86, { width: 225, align: "right" });

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc.font("Helvetica").fontSize(7).fillColor("#64748b").text(
      `Computer generated by Swiftline Portal | ${agreement.agreementNumber} | Page ${index + 1} of ${range.count}`,
      CONTENT_LEFT,
      806,
      { width: CONTENT_WIDTH, align: "center" }
    );
  }

  return doc;
}

export async function renderCreditAgreementPdf(agreement: ICreditAgreement, generatedAt: Date, signature?: AgreementSignature) {
  const document = createCreditAgreementPdf(agreement, generatedAt, signature);
  const chunks: Buffer[] = [];
  return new Promise<Buffer>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    document.end();
  });
}
