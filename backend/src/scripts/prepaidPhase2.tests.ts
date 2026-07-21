import assert from "node:assert/strict";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { BalanceReservation } from "../models/balanceReservation.model.js";
import { BusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { CreditLedgerEntry } from "../models/creditLedgerEntry.model.js";
import { PaymentTopUp } from "../models/paymentTopUp.model.js";
import { PrepaidAccount } from "../models/prepaidAccount.model.js";
import { PrepaidTransaction } from "../models/prepaidTransaction.model.js";
import {
  convertReservation,
  expireReservation,
  markReservationConsuming,
  markReservationReviewRequired,
  releaseReservation,
  reserveFunds
} from "../services/prepaid/reservations.service.js";
import {
  applyAdminCredit,
  applyAdminDebit,
  creditCapturedTopUp
} from "../services/prepaid/topups.service.js";

const runId = `phase2-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const businessAccountIds: mongoose.Types.ObjectId[] = [];

function objectId() {
  return new mongoose.Types.ObjectId();
}

function futureDate(minutes = 15) {
  return new Date(Date.now() + minutes * 60_000);
}

async function expectReject(operation: Promise<unknown>, messageIncludes: string) {
  try {
    await operation;
    assert.fail(`Expected operation to reject with ${messageIncludes}`);
  } catch (error) {
    assert.match(error instanceof Error ? error.message : String(error), new RegExp(messageIncludes));
  }
}

async function cleanup() {
  await Promise.all([
    PrepaidTransaction.deleteMany({ businessAccountId: { $in: businessAccountIds } }),
    // Test teardown bypasses model middleware only for IDs created by this run.
    CreditLedgerEntry.collection.deleteMany({
      $or: [
        { businessAccountId: { $in: businessAccountIds } },
        { idempotencyKey: { $regex: "^phase2-" } }
      ]
    }),
    BalanceReservation.deleteMany({ businessAccountId: { $in: businessAccountIds } }),
    PrepaidAccount.deleteMany({ businessAccountId: { $in: businessAccountIds } }),
    BusinessCreditAccount.deleteMany({ businessAccountId: { $in: businessAccountIds } }),
    PaymentTopUp.deleteMany({ internalReference: { $regex: `^${runId}` } })
  ]);
}

async function initializeFinancialIndexes() {
  await Promise.all([
    PrepaidAccount.init(),
    BusinessCreditAccount.init(),
    CreditLedgerEntry.init(),
    PaymentTopUp.init(),
    BalanceReservation.init(),
    PrepaidTransaction.init()
  ]);
}

async function connectTestDatabase() {
  const separator = env.MONGODB_URI.includes("?") ? "&" : "?";
  const uri = env.MONGODB_URI.includes("retryWrites=")
    ? env.MONGODB_URI
    : `${env.MONGODB_URI}${separator}retryWrites=false`;

  await mongoose.connect(uri, { family: 4, retryWrites: false });
  console.log("MongoDB connected successfully");
}

async function testConcurrentReservations() {
  const businessAccountId = objectId();
  const branchId = objectId();
  businessAccountIds.push(businessAccountId);

  await PrepaidAccount.create({
    businessAccountId,
    currency: "INR",
    cashBalanceMinor: 1000,
    reservedBalanceMinor: 0,
    status: "ACTIVE"
  });

  const attempts = await Promise.allSettled(
    Array.from({ length: 10 }, (_, index) => reserveFunds({
      businessAccountId,
      branchId,
      shipmentDraftId: objectId(),
      amountMinor: 300,
      idempotencyKey: `${runId}:reserve:concurrent:${index}`,
      expiresAt: futureDate()
    }))
  );

  const successes = attempts.filter((attempt) => attempt.status === "fulfilled" && attempt.value.reserved);
  const failures = attempts.filter((attempt) => attempt.status === "rejected");
  const failureMessages = failures.map((attempt) => attempt.reason instanceof Error ? attempt.reason.message : String(attempt.reason));
  assert.equal(
    successes.length,
    3,
    `Only three reservations should fit into a 1000 paise balance at 300 paise each. Failures: ${failureMessages.join(" | ")}`
  );
  assert.equal(failures.length, 7, "The remaining concurrent reservations should fail.");

  const account = await PrepaidAccount.findOne({ businessAccountId }).lean().exec();
  assert.ok(account);
  assert.equal(account.cashBalanceMinor, 1000);
  assert.equal(account.reservedBalanceMinor, 900);
  assert.ok(account.cashBalanceMinor - account.reservedBalanceMinor >= 0, "Available balance must never go negative.");

  const ledgerCount = await PrepaidTransaction.countDocuments({
    businessAccountId,
    transactionType: "LABEL_CHARGE_RESERVED"
  });
  assert.equal(ledgerCount, 3, "Each successful reservation should have exactly one reservation ledger row.");
}

async function testTopUpIdempotency() {
  const businessAccountId = objectId();
  const userId = objectId();
  businessAccountIds.push(businessAccountId);

  const topUp = await PaymentTopUp.create({
    businessAccountId,
    clientUserId: userId,
    amountMinor: 1234,
    currency: "INR",
    internalReference: `${runId}:topup:1`,
    idempotencyKey: `${runId}:topup-create:1`,
    razorpayOrderId: `${runId}:order:1`,
    status: "CREATED"
  });

  const idempotencyKey = `${runId}:RAZORPAY_TOPUP:pay_1`;
  const first = await creditCapturedTopUp({
    paymentTopUpId: topUp._id as mongoose.Types.ObjectId,
    razorpayPaymentId: `${runId}:pay_1`,
    idempotencyKey,
    createdBy: userId
  });
  const replay = await creditCapturedTopUp({
    paymentTopUpId: topUp._id as mongoose.Types.ObjectId,
    razorpayPaymentId: `${runId}:pay_1`,
    idempotencyKey,
    createdBy: userId
  });
  const siblingEvent = await creditCapturedTopUp({
    paymentTopUpId: topUp._id as mongoose.Types.ObjectId,
    razorpayPaymentId: `${runId}:pay_1`,
    idempotencyKey: `${runId}:RAZORPAY_TOPUP:order_paid_same_payment`,
    createdBy: userId
  });

  assert.equal(first?.credited, true);
  assert.equal(replay?.credited, false);
  assert.equal(siblingEvent?.credited, false);

  const account = await BusinessCreditAccount.findOne({ businessAccountId }).lean().exec();
  assert.ok(account);
  assert.equal(account.customerAdvanceBalanceMinor, 1234);
  assert.equal(account.reservedAdvanceMinor, 0);

  const ledgerCount = await CreditLedgerEntry.countDocuments({
    businessAccountId,
    type: "CUSTOMER_ADVANCE_RECEIVED"
  });
  assert.equal(ledgerCount, 1, "Captured payment and replay/sibling events must credit only once.");
}

async function testAdminAdjustments() {
  const businessAccountId = objectId();
  const branchId = objectId();
  const adminId = objectId();
  businessAccountIds.push(businessAccountId);

  const creditKey = `${runId}:admin-credit:1`;
  const debitKey = `${runId}:admin-debit:1`;

  await applyAdminCredit({
    businessAccountId,
    branchId,
    amountMinor: 1000,
    reason: "Phase 2 test credit",
    idempotencyKey: creditKey,
    createdBy: adminId
  });
  await applyAdminCredit({
    businessAccountId,
    branchId,
    amountMinor: 1000,
    reason: "Phase 2 duplicate credit",
    idempotencyKey: creditKey,
    createdBy: adminId
  });
  await applyAdminDebit({
    businessAccountId,
    branchId,
    amountMinor: 400,
    reason: "Phase 2 test debit",
    idempotencyKey: debitKey,
    createdBy: adminId
  });
  await applyAdminDebit({
    businessAccountId,
    branchId,
    amountMinor: 400,
    reason: "Phase 2 duplicate debit",
    idempotencyKey: debitKey,
    createdBy: adminId
  });
  await expectReject(applyAdminDebit({
    businessAccountId,
    branchId,
    amountMinor: 9999,
    reason: "Phase 2 insufficient debit",
    idempotencyKey: `${runId}:admin-debit:too-large`,
    createdBy: adminId
  }), "INSUFFICIENT_BALANCE");

  const account = await PrepaidAccount.findOne({ businessAccountId }).lean().exec();
  assert.ok(account);
  assert.equal(account.cashBalanceMinor, 600);
  assert.equal(account.reservedBalanceMinor, 0);

  assert.equal(await PrepaidTransaction.countDocuments({ businessAccountId, transactionType: "ADMIN_CREDIT" }), 1);
  assert.equal(await PrepaidTransaction.countDocuments({ businessAccountId, transactionType: "ADMIN_DEBIT" }), 1);
}

async function testReservationLifecycleTransitions() {
  const businessAccountId = objectId();
  const branchId = objectId();
  businessAccountIds.push(businessAccountId);

  await PrepaidAccount.create({
    businessAccountId,
    currency: "INR",
    cashBalanceMinor: 5000,
    reservedBalanceMinor: 0,
    status: "ACTIVE"
  });

  const convertedReservation = await reserveFunds({
    businessAccountId,
    branchId,
    shipmentDraftId: objectId(),
    amountMinor: 1000,
    idempotencyKey: `${runId}:reserve:convert`,
    expiresAt: futureDate()
  });
  assert.ok(convertedReservation.reservation);
  await markReservationConsuming({
    reservationId: convertedReservation.reservation._id as mongoose.Types.ObjectId,
    idempotencyKey: `${runId}:consume:convert`
  });
  await convertReservation({
    reservationId: convertedReservation.reservation._id as mongoose.Types.ObjectId,
    idempotencyKey: `${runId}:ledger:convert`
  });
  await expectReject(convertReservation({
    reservationId: convertedReservation.reservation._id as mongoose.Types.ObjectId,
    idempotencyKey: `${runId}:ledger:convert-again`
  }), "Illegal reservation transition");
  await expectReject(releaseReservation({
    reservationId: convertedReservation.reservation._id as mongoose.Types.ObjectId,
    idempotencyKey: `${runId}:ledger:release-converted`
  }), "Illegal reservation transition");
  await expectReject(expireReservation({
    reservationId: convertedReservation.reservation._id as mongoose.Types.ObjectId,
    idempotencyKey: `${runId}:ledger:expire-converted`
  }), "Illegal reservation transition");

  const expiringReservation = await reserveFunds({
    businessAccountId,
    branchId,
    shipmentDraftId: objectId(),
    amountMinor: 500,
    idempotencyKey: `${runId}:reserve:expire`,
    expiresAt: new Date(Date.now() - 1000)
  });
  assert.ok(expiringReservation.reservation);
  await expectReject(convertReservation({
    reservationId: expiringReservation.reservation._id as mongoose.Types.ObjectId,
    idempotencyKey: `${runId}:ledger:convert-active`
  }), "Illegal reservation transition");
  await expireReservation({
    reservationId: expiringReservation.reservation._id as mongoose.Types.ObjectId,
    idempotencyKey: `${runId}:ledger:expire`
  });
  await expectReject(releaseReservation({
    reservationId: expiringReservation.reservation._id as mongoose.Types.ObjectId,
    idempotencyKey: `${runId}:ledger:release-expired`
  }), "Illegal reservation transition");

  const releasedReservation = await reserveFunds({
    businessAccountId,
    branchId,
    shipmentDraftId: objectId(),
    amountMinor: 600,
    idempotencyKey: `${runId}:reserve:release`,
    expiresAt: futureDate()
  });
  assert.ok(releasedReservation.reservation);
  await releaseReservation({
    reservationId: releasedReservation.reservation._id as mongoose.Types.ObjectId,
    idempotencyKey: `${runId}:ledger:release`
  });
  await expectReject(markReservationReviewRequired({
    reservationId: releasedReservation.reservation._id as mongoose.Types.ObjectId,
    idempotencyKey: `${runId}:review-released`
  }), "Illegal reservation transition");

  const account = await PrepaidAccount.findOne({ businessAccountId }).lean().exec();
  assert.ok(account);
  assert.equal(account.cashBalanceMinor, 4000);
  assert.equal(account.reservedBalanceMinor, 0);
  assert.ok(account.cashBalanceMinor - account.reservedBalanceMinor >= 0);

  assert.equal(await PrepaidTransaction.countDocuments({ businessAccountId, transactionType: "LABEL_CHARGE_RESERVED" }), 3);
  assert.equal(await PrepaidTransaction.countDocuments({ businessAccountId, transactionType: "LABEL_CHARGE_COMPLETED" }), 1);
  assert.equal(await PrepaidTransaction.countDocuments({ businessAccountId, transactionType: "LABEL_RESERVATION_EXPIRED" }), 1);
  assert.equal(await PrepaidTransaction.countDocuments({ businessAccountId, transactionType: "LABEL_RESERVATION_RELEASED" }), 1);
}

async function main() {
  await connectTestDatabase();
  await initializeFinancialIndexes();

  try {
    await testConcurrentReservations();
    await testTopUpIdempotency();
    await testAdminAdjustments();
    await testReservationLifecycleTransitions();
    console.log("Prepaid Phase 2 financial tests passed.");
  } finally {
    await cleanup();
    await mongoose.disconnect();
  }
}

void main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => undefined);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
