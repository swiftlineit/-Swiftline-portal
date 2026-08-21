import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { AuditLog } from "../models/auditLog.model.js";
import { BusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { CreditBillingStatement } from "../models/creditBillingStatement.model.js";
import { CreditBillingStatementCounter } from "../models/creditBillingStatementCounter.model.js";
import { CreditLedgerEntry } from "../models/creditLedgerEntry.model.js";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import { closeCreditBillingCycle } from "../services/creditBillingCycle.service.js";
import { getCreditBalances } from "../services/creditAccount.service.js";

const databaseName = `sl_credit_billing_${Date.now()}`;

before(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: databaseName, family: 4, retryWrites: false });
  assert.equal(mongoose.connection.name, databaseName);
  await Promise.all([
    AuditLog.init(),
    BusinessCreditAccount.init(),
    CreditBillingStatement.init(),
    CreditBillingStatementCounter.init(),
    CreditLedgerEntry.init(),
    ShipmentInvoice.init()
  ]);
});

after(async () => {
  if (mongoose.connection.readyState !== 0) {
    assert.ok(mongoose.connection.name.startsWith("sl_credit_billing_"));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

async function createInvoice(input: {
  businessAccountId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  amountMinor: number;
  suffix: string;
  createdBy: mongoose.Types.ObjectId;
  // What makes an invoice billable. Left unset, the shipment's charge has not
  // settled yet and the cycle must pass it over.
  chargeFinalizedAt?: Date;
}) {
  const shipmentDraftId = new mongoose.Types.ObjectId();
  const dpdShipmentId = new mongoose.Types.ObjectId();
  const invoice = await ShipmentInvoice.create({
    invoiceNumber: `SL/26/${input.suffix}`,
    financialYear: "26-27",
    shipmentDraftId,
    dpdShipmentId,
    businessAccountId: input.businessAccountId,
    branchId: input.branchId,
    currency: "INR",
    supplier: {},
    customer: {},
    shipment: {},
    description: "Credit billing cycle integration test",
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
    issuedAt: new Date("2026-06-10T10:00:00.000Z"),
    chargeFinalizedAt: input.chargeFinalizedAt ?? null,
    createdBy: input.createdBy
  });
  return { invoice, shipmentDraftId, dpdShipmentId };
}

describe("credit billing cycle database lifecycle", () => {
  test("bills finalized invoices once without changing total used credit", async () => {
    const businessAccountId = new mongoose.Types.ObjectId();
    const branchId = new mongoose.Types.ObjectId();
    const createdBy = new mongoose.Types.ObjectId();
    const account = await BusinessCreditAccount.create({
      businessAccountId,
      status: "ACTIVE",
      approvedCreditLimitMinor: 100_000,
      unbilledCreditMinor: 15_000,
      paymentTermsDays: 30,
      billingCycle: "MONTHLY"
    });
    const finalized = await createInvoice({
      businessAccountId,
      branchId,
      amountMinor: 10_000,
      suffix: "00001",
      createdBy,
      chargeFinalizedAt: new Date("2026-06-15T12:00:00.000Z")
    });
    // Never reached the hub, so its charge is still provisional. It stays off
    // the statement whether or not anyone re-weighed it.
    const unsettled = await createInvoice({ businessAccountId, branchId, amountMinor: 5_000, suffix: "00002", createdBy });

    const usedBefore = getCreditBalances(account).usedCreditMinor;
    const first = await closeCreditBillingCycle({
      businessAccountId,
      closingDate: new Date("2026-07-16T09:00:00.000Z"),
      createdBy
    });

    assert.equal(first.created, true);
    assert.equal(first.statement?.totalAmountMinor, 10_000);
    assert.equal(first.statement?.lines.length, 1);
    assert.equal(first.statement?.dueAt.toISOString(), "2026-08-15T09:00:00.000Z");

    const updatedAccount = await BusinessCreditAccount.findById(account._id).exec();
    const billedInvoice = await ShipmentInvoice.findById(finalized.invoice._id).lean().exec();
    const untouchedInvoice = await ShipmentInvoice.findById(unsettled.invoice._id).lean().exec();
    assert.equal(updatedAccount?.unbilledCreditMinor, 5_000);
    assert.equal(updatedAccount?.invoicedOutstandingMinor, 10_000);
    assert.equal(updatedAccount ? getCreditBalances(updatedAccount).usedCreditMinor : -1, usedBefore);
    assert.equal(String(billedInvoice?.billingStatementId), first.statement?.id);
    assert.equal(untouchedInvoice?.billingStatementId ?? null, null);

    const repeated = await closeCreditBillingCycle({
      businessAccountId,
      closingDate: new Date("2026-07-16T09:00:00.000Z"),
      createdBy
    });
    assert.equal(repeated.created, false);
    assert.equal(repeated.statement?.id, first.statement?.id);
    assert.equal(await CreditBillingStatement.countDocuments({ businessAccountId }), 1);
    assert.equal(await CreditLedgerEntry.countDocuments({ businessAccountId, type: "BILLING_STATEMENT_ISSUED" }), 1);
  });
});
