import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { approveAdminCreditAccount } from "../controllers/adminCredit.controller.js";
import { acceptClientPaymentTerms, requestClientCredit } from "../controllers/clientCredit.controller.js";
import { requireRole } from "../middleware/auth.middleware.js";
import { BusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { CreditLedgerEntry } from "../models/creditLedgerEntry.model.js";
import { PaymentTermsAcceptance } from "../models/paymentTerms.model.js";
import { maxCreditLimitLabel, maxCreditLimitMinor } from "../models/financialTypes.js";
import {
  canAccessCreditFinancials,
  canCloseClientBillingCycle,
  fallbackPaymentTerms,
  getCreditActivationBlockers,
  getCreditBalances,
  getMemberCreditPermissions,
  serializeCreditAccount
} from "../services/creditAccount.service.js";

function createResponseRecorder() {
  let statusCode = 200;
  let body: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(payload: unknown) {
      body = payload;
      return response;
    }
  } as unknown as Response;
  return { response, statusCode: () => statusCode, body: () => body };
}

function request(input: Partial<Request> & { user?: { _id: mongoose.Types.ObjectId; role?: string } }) {
  return input as unknown as Request;
}

function validApprovalBody() {
  return {
    approvedCreditLimitMinor: 10_000_00,
    paymentTermsDays: 30,
    billingCycle: "MONTHLY",
    validFrom: "2026-07-16",
    validUntil: "2027-07-16",
    gracePeriodDays: 0,
    maxOverdueDays: 30,
    creditWarningThresholdPercent: 70,
    securityDepositRequiredMinor: 0,
    riskCategory: "MEDIUM",
    internalRemarks: "Verified test account",
    reason: "Approved after finance review"
  };
}

describe("credit balance policy", () => {
  test("combines available advance and active approved credit", () => {
    const balances = getCreditBalances({
      status: "ACTIVE",
      approvedCreditLimitMinor: 100_000,
      reservedCreditMinor: 10_000,
      unbilledCreditMinor: 15_000,
      invoicedOutstandingMinor: 20_000,
      customerAdvanceBalanceMinor: 30_000,
      reservedAdvanceMinor: 5_000
    });

    assert.deepEqual(balances, {
      usedCreditMinor: 45_000,
      availableCreditMinor: 55_000,
      availableAdvanceMinor: 25_000,
      availableBookingCapacityMinor: 80_000,
      // Unbilled plus invoiced: the reserved 10_000 is a hold, not a debt.
      totalOwedMinor: 35_000
    });
  });

  test("advance-only customers retain booking capacity without active credit", () => {
    const balances = getCreditBalances({
      status: "NOT_REQUESTED",
      approvedCreditLimitMinor: 100_000,
      reservedCreditMinor: 0,
      unbilledCreditMinor: 0,
      invoicedOutstandingMinor: 0,
      customerAdvanceBalanceMinor: 18_000,
      reservedAdvanceMinor: 3_000
    });

    assert.equal(balances.availableCreditMinor, 0);
    assert.equal(balances.availableAdvanceMinor, 15_000);
    assert.equal(balances.availableBookingCapacityMinor, 15_000);
  });

  test("never exposes negative available balances", () => {
    const balances = getCreditBalances({
      status: "ACTIVE",
      approvedCreditLimitMinor: 10_000,
      reservedCreditMinor: 8_000,
      unbilledCreditMinor: 6_000,
      invoicedOutstandingMinor: 4_000,
      customerAdvanceBalanceMinor: 2_000,
      reservedAdvanceMinor: 3_000
    });

    assert.equal(balances.usedCreditMinor, 18_000);
    assert.equal(balances.availableCreditMinor, 0);
    assert.equal(balances.availableAdvanceMinor, 0);
    assert.equal(balances.availableBookingCapacityMinor, 0);
  });
});

describe("member credit permissions", () => {
  test("assigns the agreed defaults for every member role", () => {
    assert.deepEqual(getMemberCreditPermissions("account_owner"), ["requestCredit", "useCreditPayment", "viewCreditBalance", "viewCreditDetails", "makeCreditPayment"]);
    assert.deepEqual(getMemberCreditPermissions("account_admin"), ["requestCredit", "useCreditPayment", "viewCreditBalance", "viewCreditDetails", "makeCreditPayment"]);
    assert.deepEqual(getMemberCreditPermissions("finance"), ["requestCredit", "useCreditPayment", "viewCreditBalance", "viewCreditDetails", "makeCreditPayment"]);
    assert.deepEqual(getMemberCreditPermissions("operations"), ["useCreditPayment"]);
    assert.deepEqual(getMemberCreditPermissions("tracking_only"), []);
  });

  test("deduplicates explicit permissions and protects global defaults from mutation", () => {
    assert.deepEqual(getMemberCreditPermissions("operations", ["viewCreditBalance", "viewCreditBalance"]), ["viewCreditBalance"]);
    const permissions = getMemberCreditPermissions("operations");
    permissions.push("viewCreditBalance");
    assert.deepEqual(getMemberCreditPermissions("operations"), ["useCreditPayment"]);
  });

  test("limits financial pages and client cycle closing to the agreed roles", () => {
    assert.equal(canAccessCreditFinancials("account_owner"), true);
    assert.equal(canAccessCreditFinancials("account_admin"), true);
    assert.equal(canAccessCreditFinancials("finance"), true);
    assert.equal(canAccessCreditFinancials("operations"), false);
    assert.equal(canAccessCreditFinancials("tracking_only"), false);
    assert.equal(canCloseClientBillingCycle("finance"), true);
    assert.equal(canCloseClientBillingCycle("account_owner"), false);
    assert.equal(canCloseClientBillingCycle("account_admin"), false);
  });
});

describe("credit activation policy", () => {
  const eligible = {
    businessStatus: "active",
    kycStatus: "verified",
    agreementStatus: "signed",
    depositStatus: "not_required",
    securityDepositRequiredMinor: 0,
    approvedCreditLimitMinor: 100_000,
    validUntil: new Date("2027-01-01T00:00:00.000Z"),
    now: new Date("2026-07-16T00:00:00.000Z")
  };

  test("allows activation only when every requirement is complete", () => {
    assert.deepEqual(getCreditActivationBlockers(eligible), []);
  });

  test("returns all applicable blockers in a stable order", () => {
    assert.deepEqual(getCreditActivationBlockers({
      ...eligible,
      businessStatus: "pending_review",
      kycStatus: "pending",
      agreementStatus: "generated",
      securityDepositRequiredMinor: 50_000,
      depositStatus: "pending",
      approvedCreditLimitMinor: 0,
      validUntil: new Date("2026-07-15T00:00:00.000Z")
    }), [
      "Business account must be approved or active.",
      "KYC must be verified.",
      "Credit agreement must be signed.",
      "Required security deposit must be received.",
      "Approved credit limit must be greater than zero.",
      "Credit validity has already expired."
    ]);
  });

  test("does not require a deposit when the configured requirement is zero", () => {
    assert.deepEqual(getCreditActivationBlockers({ ...eligible, depositStatus: "pending" }), []);
  });
});

describe("credit model safeguards", () => {
  test("applies safe defaults and serializes calculated balances", async () => {
    const account = new BusinessCreditAccount({
      businessAccountId: new mongoose.Types.ObjectId(),
      status: "ACTIVE",
      approvedCreditLimitMinor: 50_000,
      customerAdvanceBalanceMinor: 10_000
    });
    await account.validate();
    assert.equal(account.currency, "INR");
    assert.equal(account.paymentTermsDays, 30);
    assert.equal(account.billingCycle, "MONTHLY");
    assert.equal(serializeCreditAccount(account).availableBookingCapacityMinor, 60_000);
  });

  test("rejects negative, fractional and unsupported financial values", async () => {
    const account = new BusinessCreditAccount({
      businessAccountId: new mongoose.Types.ObjectId(),
      approvedCreditLimitMinor: -1,
      customerAdvanceBalanceMinor: 100.5,
      paymentTermsDays: 10
    });
    const validation = await account.validate().then(
      () => null,
      (error: unknown) => error as mongoose.Error.ValidationError
    );
    assert.ok(validation?.errors.approvedCreditLimitMinor);
    assert.ok(validation?.errors.customerAdvanceBalanceMinor);
    assert.ok(validation?.errors.paymentTermsDays);
  });

  test("rejects requested and approved limits above the credit ceiling", async () => {
    const account = new BusinessCreditAccount({
      businessAccountId: new mongoose.Types.ObjectId(),
      requestedCreditLimitMinor: maxCreditLimitMinor + 1,
      approvedCreditLimitMinor: maxCreditLimitMinor + 1
    });
    const validation = await account.validate().then(
      () => null,
      (error: unknown) => error as mongoose.Error.ValidationError
    );
    assert.ok(validation?.errors.requestedCreditLimitMinor);
    assert.ok(validation?.errors.approvedCreditLimitMinor);
  });

  test("keeps ledger entries append-only before any database operation", async () => {
    await assert.rejects(CreditLedgerEntry.deleteMany({}).exec(), /Credit ledger entries are append-only/);
    await assert.rejects(CreditLedgerEntry.updateMany({}, { $set: { description: "changed" } }).exec(), /Credit ledger entries are append-only/);
  });

  test("enforces one terms acceptance per account, user, version and payment reference", async () => {
    const indexes = PaymentTermsAcceptance.schema.indexes() as Array<[Record<string, number>, { unique?: boolean }]>;
    const uniqueIndex = indexes.find(([fields, options]) =>
      fields.businessAccountId === 1 && fields.userId === 1 && fields.termsVersion === 1 && fields.paymentReference === 1 && options.unique
    );
    assert.ok(uniqueIndex);

    const acceptance = new PaymentTermsAcceptance({
      businessAccountId: new mongoose.Types.ObjectId(),
      userId: new mongoose.Types.ObjectId(),
      termsVersion: fallbackPaymentTerms.version,
      ipAddress: ""
    });
    const validation = await acceptance.validate().then(
      () => null,
      (error: unknown) => error as mongoose.Error.ValidationError
    );
    assert.ok(validation?.errors.ipAddress);
  });
});

describe("friendly API validation and authorization", () => {
  test("admin routes reject unauthenticated and non-admin requests", () => {
    const missingUser = createResponseRecorder();
    let nextCalled = false;
    requireRole("admin")(request({}), missingUser.response, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(missingUser.statusCode(), 401);
    assert.deepEqual(missingUser.body(), { success: false, message: "Unauthorized" });
    assert.equal(nextCalled, false);

    const clientUser = createResponseRecorder();
    requireRole("admin")(request({ user: { _id: new mongoose.Types.ObjectId(), role: "client" } }), clientUser.response, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(clientUser.statusCode(), 403);
    assert.deepEqual(clientUser.body(), { success: false, message: "Forbidden" });
  });

  test("admin role passes the route guard", () => {
    const recorder = createResponseRecorder();
    let nextCalled = false;
    requireRole("admin")(request({ user: { _id: new mongoose.Types.ObjectId(), role: "admin" } }), recorder.response, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(nextCalled, true);
    assert.equal(recorder.statusCode(), 200);
  });

  test("approval rejects bad amounts and inverted validity dates before database access", async () => {
    const user = { _id: new mongoose.Types.ObjectId(), role: "admin" };
    const businessAccountId = new mongoose.Types.ObjectId().toString();

    const badAmount = createResponseRecorder();
    await approveAdminCreditAccount(request({ user, params: { businessAccountId }, body: { ...validApprovalBody(), approvedCreditLimitMinor: 0 } }), badAmount.response);
    assert.equal(badAmount.statusCode(), 400);
    assert.match(String((badAmount.body() as { message: string }).message), /greater than zero/i);

    const excessiveAmount = createResponseRecorder();
    await approveAdminCreditAccount(request({ user, params: { businessAccountId }, body: { ...validApprovalBody(), approvedCreditLimitMinor: maxCreditLimitMinor + 1 } }), excessiveAmount.response);
    assert.equal(excessiveAmount.statusCode(), 400);
    assert.ok(String((excessiveAmount.body() as { message: string }).message).includes(maxCreditLimitLabel));

    const badDates = createResponseRecorder();
    await approveAdminCreditAccount(request({ user, params: { businessAccountId }, body: { ...validApprovalBody(), validFrom: "2027-07-16", validUntil: "2026-07-16" } }), badDates.response);
    assert.equal(badDates.statusCode(), 400);
    assert.equal((badDates.body() as { message: string }).message, "Credit expiry must be after its start date.");
  });

  test("client requests and terms acceptance return friendly validation errors", async () => {
    const user = { _id: new mongoose.Types.ObjectId(), role: "client" };

    const creditRequest = createResponseRecorder();
    await requestClientCredit(request({ user, body: { businessAccountId: "", requestedCreditLimitMinor: 0, reason: "short" } }), creditRequest.response);
    assert.equal(creditRequest.statusCode(), 400);
    assert.notEqual((creditRequest.body() as { message: string }).message, "Internal server error");

    const excessiveRequest = createResponseRecorder();
    await requestClientCredit(request({ user, body: { businessAccountId: "valid", requestedCreditLimitMinor: maxCreditLimitMinor + 1, reason: "Regular international shipment volume" } }), excessiveRequest.response);
    assert.equal(excessiveRequest.statusCode(), 400);
    assert.ok(String((excessiveRequest.body() as { message: string }).message).includes(maxCreditLimitLabel));

    const terms = createResponseRecorder();
    await acceptClientPaymentTerms(request({ user, body: { businessAccountId: "", termsVersion: "" } }), terms.response);
    assert.equal(terms.statusCode(), 400);
    assert.equal((terms.body() as { message: string }).message, "Payment terms acceptance is incomplete.");
  });
});
