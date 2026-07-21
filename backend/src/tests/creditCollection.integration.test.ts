import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { AuditLog } from "../models/auditLog.model.js";
import { BusinessAccountMember } from "../models/businessAccountMember.model.js";
import { BusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { CreditBillingStatement } from "../models/creditBillingStatement.model.js";
import { CreditLedgerEntry } from "../models/creditLedgerEntry.model.js";
import { CreditPayment } from "../models/creditPayment.model.js";
import { PortalNotification } from "../models/portalNotification.model.js";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import { applyVerifiedCreditPayment, createCreditPayment } from "../services/creditPayment.service.js";

const databaseName = `sl_credit_collection_${Date.now()}`;

before(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: databaseName, family: 4, retryWrites: false });
  await Promise.all([
    AuditLog.init(),
    BusinessAccountMember.init(),
    BusinessCreditAccount.init(),
    CreditBillingStatement.init(),
    CreditLedgerEntry.init(),
    CreditPayment.init(),
    PortalNotification.init(),
    ShipmentInvoice.init()
  ]);
});

after(async () => {
  if (mongoose.connection.readyState !== 0) {
    assert.ok(mongoose.connection.name.startsWith("sl_credit_collection_"));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

async function invoice(input: {
  businessAccountId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  amountMinor: number;
  suffix: string;
  createdBy: mongoose.Types.ObjectId;
  issuedAt: Date;
}) {
  return ShipmentInvoice.create({
    invoiceNumber: `SL/26/${input.suffix}`,
    financialYear: "26-27",
    shipmentDraftId: new mongoose.Types.ObjectId(),
    dpdShipmentId: new mongoose.Types.ObjectId(),
    businessAccountId: input.businessAccountId,
    branchId: input.branchId,
    currency: "INR",
    supplier: {},
    customer: {},
    shipment: {},
    description: "Credit collection integration test",
    taxableValueMinor: input.amountMinor,
    gstRatePercent: 18,
    taxType: "IGST",
    cgstAmountMinor: 0,
    sgstAmountMinor: 0,
    igstAmountMinor: 0,
    totalTaxAmountMinor: 0,
    totalAmountMinor: input.amountMinor,
    status: "ISSUED",
    paymentStatus: "UNPAID",
    advanceAppliedMinor: 0,
    creditOutstandingMinor: input.amountMinor,
    pricingSnapshot: { totalAmount: input.amountMinor / 100 },
    revision: 1,
    issuedAt: input.issuedAt,
    createdBy: input.createdBy
  });
}

describe("credit statement payment lifecycle", () => {
  test("allocates oldest first, supports partial payment and sends excess to Customer Advance", async () => {
    const businessAccountId = new mongoose.Types.ObjectId();
    const branchId = new mongoose.Types.ObjectId();
    const adminId = new mongoose.Types.ObjectId();
    const account = await BusinessCreditAccount.create({
      businessAccountId,
      status: "ACTIVE",
      approvedCreditLimitMinor: 100_000,
      invoicedOutstandingMinor: 15_000,
      customerAdvanceBalanceMinor: 1_000
    });
    const firstInvoice = await invoice({
      businessAccountId,
      branchId,
      amountMinor: 10_000,
      suffix: "01001",
      createdBy: adminId,
      issuedAt: new Date("2026-06-01T10:00:00.000Z")
    });
    const secondInvoice = await invoice({
      businessAccountId,
      branchId,
      amountMinor: 5_000,
      suffix: "01002",
      createdBy: adminId,
      issuedAt: new Date("2026-07-01T10:00:00.000Z")
    });
    const [firstStatement, secondStatement] = await CreditBillingStatement.create([
      {
        statementNumber: "CBS/26-27/01001",
        businessAccountId,
        creditAccountId: account._id,
        billingCycle: "MONTHLY",
        periodStart: new Date("2026-05-31T18:30:00.000Z"),
        periodEnd: new Date("2026-06-30T18:30:00.000Z"),
        issuedAt: new Date("2026-07-01T04:30:00.000Z"),
        dueAt: new Date("2026-07-31T04:30:00.000Z"),
        lines: [{ shipmentInvoiceId: firstInvoice._id, shipmentDraftId: firstInvoice.shipmentDraftId, invoiceNumber: firstInvoice.invoiceNumber, invoiceRevision: 1, invoiceIssuedAt: firstInvoice.issuedAt, outstandingAmountMinor: 10_000 }],
        totalAmountMinor: 10_000,
        outstandingAmountMinor: 10_000,
        createdBy: adminId
      },
      {
        statementNumber: "CBS/26-27/01002",
        businessAccountId,
        creditAccountId: account._id,
        billingCycle: "MONTHLY",
        periodStart: new Date("2026-06-30T18:30:00.000Z"),
        periodEnd: new Date("2026-07-31T18:30:00.000Z"),
        issuedAt: new Date("2026-08-01T04:30:00.000Z"),
        dueAt: new Date("2026-08-31T04:30:00.000Z"),
        lines: [{ shipmentInvoiceId: secondInvoice._id, shipmentDraftId: secondInvoice.shipmentDraftId, invoiceNumber: secondInvoice.invoiceNumber, invoiceRevision: 1, invoiceIssuedAt: secondInvoice.issuedAt, outstandingAmountMinor: 5_000 }],
        totalAmountMinor: 5_000,
        outstandingAmountMinor: 5_000,
        createdBy: adminId
      }
    ]);
    assert.ok(firstStatement);
    assert.ok(secondStatement);

    const partial = await createCreditPayment({
      businessAccountId,
      requestedStatementId: secondStatement._id,
      amountMinor: 12_000,
      method: "BANK_TRANSFER",
      internalReference: "OFFLINE-PAY-ONE",
      idempotencyKey: "OFFLINE-PAY-ONE",
      externalReference: "UTR-ONE",
      submittedBy: adminId
    });
    await applyVerifiedCreditPayment({ paymentId: partial.payment._id, verifiedBy: adminId });

    const firstAfter = await CreditBillingStatement.findById(firstStatement._id).exec();
    const secondAfter = await CreditBillingStatement.findById(secondStatement._id).exec();
    assert.equal(firstAfter?.status, "PAID");
    assert.equal(secondAfter?.status, "PARTIALLY_PAID");
    assert.equal(secondAfter?.outstandingAmountMinor, 3_000);

    const excess = await createCreditPayment({
      businessAccountId,
      requestedStatementId: secondStatement._id,
      amountMinor: 8_000,
      method: "UPI",
      internalReference: "OFFLINE-PAY-TWO",
      idempotencyKey: "OFFLINE-PAY-TWO",
      externalReference: "UPI-TWO",
      submittedBy: adminId
    });
    const applied = await applyVerifiedCreditPayment({ paymentId: excess.payment._id, verifiedBy: adminId });
    assert.equal(applied.payment.advanceAmountMinor, 5_000);

    const accountAfter = await BusinessCreditAccount.findById(account._id).exec();
    assert.equal(accountAfter?.invoicedOutstandingMinor, 0);
    assert.equal(accountAfter?.customerAdvanceBalanceMinor, 6_000);
    assert.equal(await CreditLedgerEntry.countDocuments({ type: "STATEMENT_PAYMENT_APPLIED" }), 2);
    assert.equal(await CreditLedgerEntry.countDocuments({ type: "EXCESS_PAYMENT_TO_ADVANCE" }), 1);
  });
});
