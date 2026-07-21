import assert from "node:assert/strict";
import { describe, test } from "node:test";
import mongoose from "mongoose";
import { CreditBillingStatement } from "../models/creditBillingStatement.model.js";
import {
  calculateCreditStatementDueAt,
  getPreviousClosedBillingPeriod
} from "../services/creditBillingCycle.service.js";
import { formatIndiaDate } from "../utils/dateFormat.js";
import { createCreditBillingStatementPdf } from "../services/creditBillingStatementPdf.service.js";

function renderStatementPdf() {
  const doc = createCreditBillingStatementPdf({
    customer: { accountId: "BA-PDF-1", companyName: "Statement PDF Customer" },
    statement: {
      id: new mongoose.Types.ObjectId().toString(),
      statementNumber: "CBS/26-27/00002",
      businessAccountId: new mongoose.Types.ObjectId().toString(),
      creditAccountId: new mongoose.Types.ObjectId().toString(),
      billingCycle: "MONTHLY",
      periodStart: new Date("2026-06-30T18:30:00.000Z"),
      periodEnd: new Date("2026-07-31T18:30:00.000Z"),
      issuedAt: new Date("2026-08-01T04:30:00.000Z"),
      dueAt: new Date("2026-08-31T04:30:00.000Z"),
      currency: "INR",
      lines: [{
        sourceType: "SHIPMENT_INVOICE",
        shipmentInvoiceId: new mongoose.Types.ObjectId().toString(),
        cancellationFeeInvoiceId: null,
        shipmentDraftId: new mongoose.Types.ObjectId().toString(),
        invoiceNumber: "SL/26-27/00001",
        invoiceRevision: 2,
        invoiceIssuedAt: new Date("2026-07-15T04:30:00.000Z"),
        outstandingAmountMinor: 5_000
      }],
      adjustments: [{
        adjustmentId: new mongoose.Types.ObjectId().toString(),
        shipmentInvoiceId: new mongoose.Types.ObjectId().toString(),
        originalStatementId: new mongoose.Types.ObjectId().toString(),
        description: "Additional credit charge from an approved shipment update.",
        amountMinor: 500,
        affectsAmountDue: true
      }],
      totalAmountMinor: 5_500,
      paidAmountMinor: 1_000,
      creditAdjustmentMinor: 0,
      outstandingAmountMinor: 4_500,
      status: "PARTIALLY_PAID"
    }
  });

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

describe("credit billing cycle foundation", () => {
  test("formats portal dates as DD-MM-YYYY in India time", () => {
    assert.equal(formatIndiaDate(new Date("2026-07-05T04:30:00.000Z")), "05-07-2026");
  });

  test("returns the previous complete calendar week", () => {
    const period = getPreviousClosedBillingPeriod("WEEKLY", new Date("2026-07-16T12:00:00.000Z"));
    assert.equal(period.start.toISOString(), "2026-07-05T18:30:00.000Z");
    assert.equal(period.end.toISOString(), "2026-07-12T18:30:00.000Z");
  });

  test("returns the previous complete calendar month", () => {
    const period = getPreviousClosedBillingPeriod("MONTHLY", new Date("2026-07-16T12:00:00.000Z"));
    assert.equal(period.start.toISOString(), "2026-05-31T18:30:00.000Z");
    assert.equal(period.end.toISOString(), "2026-06-30T18:30:00.000Z");
  });

  test("calculates due dates from supported payment terms", () => {
    assert.equal(
      calculateCreditStatementDueAt(new Date("2026-07-16T10:30:00.000Z"), 30).toISOString(),
      "2026-08-15T10:30:00.000Z"
    );
    assert.throws(() => calculateCreditStatementDueAt(new Date(), 12), /Unsupported credit payment terms/);
  });

  test("validates immutable statement line totals and invoice uniqueness", async () => {
    const invoiceId = new mongoose.Types.ObjectId();
    const statement = new CreditBillingStatement({
      statementNumber: "CBS/26-27/00001",
      businessAccountId: new mongoose.Types.ObjectId(),
      creditAccountId: new mongoose.Types.ObjectId(),
      billingCycle: "MONTHLY",
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      issuedAt: new Date("2026-07-01T00:00:00.000Z"),
      dueAt: new Date("2026-07-31T00:00:00.000Z"),
      lines: [
        { shipmentInvoiceId: invoiceId, shipmentDraftId: new mongoose.Types.ObjectId(), invoiceNumber: "SL/26-27/00001", invoiceRevision: 2, invoiceIssuedAt: new Date(), outstandingAmountMinor: 5_000 },
        { shipmentInvoiceId: invoiceId, shipmentDraftId: new mongoose.Types.ObjectId(), invoiceNumber: "SL/26-27/00001", invoiceRevision: 2, invoiceIssuedAt: new Date(), outstandingAmountMinor: 5_000 }
      ],
      totalAmountMinor: 9_000,
      paidAmountMinor: 0,
      outstandingAmountMinor: 9_000,
      status: "ISSUED",
      createdBy: new mongoose.Types.ObjectId()
    });

    const validation = await statement.validate().then(
      () => null,
      (error: unknown) => error as mongoose.Error.ValidationError
    );
    assert.ok(validation?.errors.lines);
    assert.ok(validation?.errors.totalAmountMinor);
  });

  test("renders a non-empty statement PDF with invoice and adjustment details", async () => {
    const pdf = await renderStatementPdf();
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    assert.ok(pdf.length > 2_000);
  });
});
