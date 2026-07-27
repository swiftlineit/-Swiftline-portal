import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import {
  approveAdminCreditAccount,
  closeAdminCreditAccount,
  reactivateAdminCreditAccount,
  suspendAdminCreditAccount
} from "../controllers/adminCredit.controller.js";
import { AuditLog } from "../models/auditLog.model.js";
import { BalanceReservation } from "../models/balanceReservation.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { BusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { CreditBillingStatement } from "../models/creditBillingStatement.model.js";
import { CreditLedgerEntry } from "../models/creditLedgerEntry.model.js";
import { CreditLimitHistory } from "../models/creditLimitHistory.model.js";
import { expireLapsedCreditAccounts } from "../services/creditAccount.service.js";
import { expireStaleReservations } from "../services/creditBooking.service.js";
import { writeOffCreditStatement } from "../services/creditBillingCycle.service.js";
import { reconcileCreditAccount } from "../services/creditReconciliation.service.js";

const databaseName = `swiftline_credit_lc_test_${Date.now()}`.slice(0, 38);

function createResponseRecorder() {
  let statusCode = 200;
  let body: unknown;
  const response = {
    status(code: number) { statusCode = code; return response; },
    json(payload: unknown) { body = payload; return response; }
  } as unknown as Response;
  return { response, statusCode: () => statusCode, body: <T>() => body as T };
}

function controllerRequest(input: { userId: mongoose.Types.ObjectId; businessAccountId: mongoose.Types.ObjectId; body?: unknown }) {
  return {
    user: { _id: input.userId, role: "admin" },
    params: { businessAccountId: String(input.businessAccountId) },
    body: input.body ?? {},
    query: {}
  } as unknown as Request;
}

async function seedActiveCreditAccount(overrides: Record<string, unknown> = {}) {
  const businessAccountId = new mongoose.Types.ObjectId();
  const account = await BusinessCreditAccount.create({
    businessAccountId,
    status: "ACTIVE",
    approvedCreditLimitMinor: 100000,
    activatedAt: new Date(),
    ...overrides
  });
  return { businessAccountId, account };
}

before(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: databaseName, family: 4, retryWrites: false });
  assert.equal(mongoose.connection.name, databaseName, "Integration tests must use the isolated credit lifecycle test database.");
  await Promise.all([
    BusinessAccount.init(), BusinessCreditAccount.init(), CreditBillingStatement.init(),
    CreditLedgerEntry.init(), CreditLimitHistory.init(), BalanceReservation.init(), AuditLog.init()
  ]);
});

after(async () => {
  if (mongoose.connection.readyState !== 0) {
    assert.ok(mongoose.connection.name.startsWith("swiftline_credit_lc_test_"), "Refusing to clean a non-test database.");
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

describe("credit lifecycle", () => {
  test("suspend, reactivate, and close follow the transition rules", async () => {
    const adminId = new mongoose.Types.ObjectId();
    const { businessAccountId } = await seedActiveCreditAccount();

    const suspend = createResponseRecorder();
    await suspendAdminCreditAccount(controllerRequest({ userId: adminId, businessAccountId, body: { reason: "Overdue investigation" } }), suspend.response);
    assert.equal(suspend.statusCode(), 200);
    assert.equal((await BusinessCreditAccount.findOne({ businessAccountId }).lean().exec())?.status, "SUSPENDED");

    // Suspending an already-suspended account is not a valid transition.
    const suspendAgain = createResponseRecorder();
    await suspendAdminCreditAccount(controllerRequest({ userId: adminId, businessAccountId, body: { reason: "Duplicate action" } }), suspendAgain.response);
    assert.equal(suspendAgain.statusCode(), 409);

    const reactivate = createResponseRecorder();
    await reactivateAdminCreditAccount(controllerRequest({ userId: adminId, businessAccountId, body: { reason: "Cleared" } }), reactivate.response);
    assert.equal(reactivate.statusCode(), 200);
    const reactivated = await BusinessCreditAccount.findOne({ businessAccountId }).lean().exec();
    assert.equal(reactivated?.status, "ACTIVE");
    assert.equal(reactivated?.holdReason, "");

    const close = createResponseRecorder();
    await closeAdminCreditAccount(controllerRequest({ userId: adminId, businessAccountId, body: { reason: "Customer offboarded" } }), close.response);
    assert.equal(close.statusCode(), 200);
    assert.equal((await BusinessCreditAccount.findOne({ businessAccountId }).lean().exec())?.status, "CLOSED");

    // CLOSED is terminal.
    const reopen = createResponseRecorder();
    await reactivateAdminCreditAccount(controllerRequest({ userId: adminId, businessAccountId, body: { reason: "Retry" } }), reopen.response);
    assert.equal(reopen.statusCode(), 409);
  });

  test("close is blocked while funds are reserved", async () => {
    const adminId = new mongoose.Types.ObjectId();
    const { businessAccountId } = await seedActiveCreditAccount({ reservedCreditMinor: 5000 });

    const close = createResponseRecorder();
    await closeAdminCreditAccount(controllerRequest({ userId: adminId, businessAccountId, body: { reason: "Offboard" } }), close.response);
    assert.equal(close.statusCode(), 409);
    assert.match(close.body<{ message: string }>().message, /in-flight/);
  });

  test("reactivation is blocked once validity has expired", async () => {
    const adminId = new mongoose.Types.ObjectId();
    const { businessAccountId } = await seedActiveCreditAccount({
      status: "SUSPENDED",
      validUntil: new Date(Date.now() - 24 * 60 * 60 * 1000)
    });

    const reactivate = createResponseRecorder();
    await reactivateAdminCreditAccount(controllerRequest({ userId: adminId, businessAccountId, body: { reason: "Cleared" } }), reactivate.response);
    assert.equal(reactivate.statusCode(), 409);
    assert.match(reactivate.body<{ message: string }>().message, /validity/i);
  });

  test("editing a live account keeps it ACTIVE and blocks a limit below used credit", async () => {
    const adminId = new mongoose.Types.ObjectId();
    const businessAccountId = new mongoose.Types.ObjectId();
    await BusinessAccount.create({
      _id: businessAccountId,
      accountId: "BA-2026-900001",
      status: "active",
      contact: { title: "mr.", firstName: "John", lastName: "Doe", email: "lc@acme.com", mobileType: "mobile", countryCode: "+91", mobileNumber: "9876543210", jobTitle: "Director", department: "Management", shipmentTypes: ["international_cargo"] },
      company: { registrationCountry: "India", registrationId: "ABCDE1234F", companyType: "pvt_ltd", companyName: "Acme", registeredAddress: "1 St", city: "Delhi", stateOrProvince: "Delhi", postalCode: "110001", operatingCountries: ["India"], industry: "Retail", monthlyShipmentVolume: "1-50 shipments", requestedCreditLimit: { currency: "INR", amount: null } },
      createdBy: adminId
    });
    await BusinessCreditAccount.create({ businessAccountId, status: "ACTIVE", approvedCreditLimitMinor: 100000, unbilledCreditMinor: 40000, activatedAt: new Date() });

    const approveBody = {
      approvedCreditLimitMinor: 30000, paymentTermsDays: 30, billingCycle: "MONTHLY",
      gracePeriodDays: 0, maxOverdueDays: 30, creditWarningThresholdPercent: 70,
      securityDepositRequiredMinor: 0, riskCategory: "LOW", internalRemarks: "", reason: "Reduce exposure"
    };

    // 30000 is below the 40000 already used → rejected.
    const belowUsed = createResponseRecorder();
    await approveAdminCreditAccount(controllerRequest({ userId: adminId, businessAccountId, body: approveBody }), belowUsed.response);
    assert.equal(belowUsed.statusCode(), 409);

    // A valid edit keeps the account ACTIVE (does not bounce it to APPROVED).
    const raise = createResponseRecorder();
    await approveAdminCreditAccount(controllerRequest({ userId: adminId, businessAccountId, body: { ...approveBody, approvedCreditLimitMinor: 80000 } }), raise.response);
    assert.equal(raise.statusCode(), 200);
    assert.equal((await BusinessCreditAccount.findOne({ businessAccountId }).lean().exec())?.status, "ACTIVE");
  });

  test("expireLapsedCreditAccounts moves lapsed active facilities to EXPIRED", async () => {
    const past = await seedActiveCreditAccount({ validUntil: new Date(Date.now() - 60 * 60 * 1000) });
    const open = await seedActiveCreditAccount({ validUntil: new Date(Date.now() + 60 * 60 * 1000) });

    const result = await expireLapsedCreditAccounts();
    assert.ok(result.expired >= 1);
    assert.equal((await BusinessCreditAccount.findOne({ businessAccountId: past.businessAccountId }).lean().exec())?.status, "EXPIRED");
    assert.equal((await BusinessCreditAccount.findOne({ businessAccountId: open.businessAccountId }).lean().exec())?.status, "ACTIVE");
  });

  test("writing off a stuck statement clears it and releases the invoiced balance", async () => {
    const adminId = new mongoose.Types.ObjectId();
    const { businessAccountId, account } = await seedActiveCreditAccount({ invoicedOutstandingMinor: 50000 });

    const statement = await CreditBillingStatement.create({
      statementNumber: "CBS/26-27/09001",
      businessAccountId,
      creditAccountId: account._id,
      billingCycle: "MONTHLY",
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      issuedAt: new Date("2026-07-01T00:00:00.000Z"),
      dueAt: new Date("2026-07-31T00:00:00.000Z"),
      currency: "INR",
      // A line whose underlying invoice has since been settled (the drift that
      // leaves a statement with a phantom outstanding balance it can never clear).
      lines: [{
        sourceType: "SHIPMENT_INVOICE",
        shipmentInvoiceId: new mongoose.Types.ObjectId(),
        cancellationFeeInvoiceId: null,
        shipmentDraftId: new mongoose.Types.ObjectId(),
        invoiceNumber: "INV/26-27/09001",
        invoiceRevision: 1,
        invoiceIssuedAt: new Date("2026-06-15T00:00:00.000Z"),
        outstandingAmountMinor: 50000
      }],
      adjustments: [],
      totalAmountMinor: 50000,
      paidAmountMinor: 0,
      creditAdjustmentMinor: 0,
      outstandingAmountMinor: 50000,
      status: "OVERDUE",
      createdBy: adminId
    });

    const written = await writeOffCreditStatement({
      businessAccountId,
      statementId: statement._id as mongoose.Types.ObjectId,
      amountMinor: 50000,
      reason: "Uncollectable legacy balance",
      createdBy: adminId
    });
    assert.equal(written.outstandingAmountMinor, 0);
    assert.equal(written.status, "PAID");
    assert.equal((await BusinessCreditAccount.findOne({ businessAccountId }).lean().exec())?.invoicedOutstandingMinor, 0);
  });

  test("expireStaleReservations releases reserved funds past their TTL", async () => {
    const { businessAccountId } = await seedActiveCreditAccount({ reservedCreditMinor: 8000, reservedAdvanceMinor: 2000, customerAdvanceBalanceMinor: 2000 });
    await BalanceReservation.create({
      businessAccountId,
      branchId: new mongoose.Types.ObjectId(),
      shipmentDraftId: new mongoose.Types.ObjectId(),
      amountMinor: 10000,
      advanceAmountMinor: 2000,
      creditAmountMinor: 8000,
      currency: "INR",
      status: "ACTIVE",
      idempotencyKey: `SEED:${new mongoose.Types.ObjectId().toString()}`,
      expiresAt: new Date(Date.now() - 60 * 1000)
    });

    const result = await expireStaleReservations();
    assert.ok(result.released >= 1);
    const account = await BusinessCreditAccount.findOne({ businessAccountId }).lean().exec();
    assert.equal(account?.reservedCreditMinor, 0);
    assert.equal(account?.reservedAdvanceMinor, 0);
  });

  test("reconciliation reports a clean account and flags drift", async () => {
    const clean = await seedActiveCreditAccount();
    assert.equal(await reconcileCreditAccount(clean.businessAccountId), null);

    // invoicedOutstanding with no backing statements is drift.
    const driftInvoiced = await seedActiveCreditAccount({ invoicedOutstandingMinor: 25000 });
    const invoicedIssue = await reconcileCreditAccount(driftInvoiced.businessAccountId);
    assert.ok(invoicedIssue?.issues.some((issue) => issue.includes("invoicedOutstandingMinor")));

    // reservedCredit with no open reservation is drift.
    const driftReserved = await seedActiveCreditAccount({ reservedCreditMinor: 4000 });
    const reservedIssue = await reconcileCreditAccount(driftReserved.businessAccountId);
    assert.ok(reservedIssue?.issues.some((issue) => issue.includes("reservedCreditMinor")));
  });
});
