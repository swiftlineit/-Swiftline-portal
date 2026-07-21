import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";

process.env.RAZORPAY_WEBHOOK_SECRET ||= "phase3-test-webhook-secret";

const runId = `phase3-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const businessAccountIds: mongoose.Types.ObjectId[] = [];
let env: typeof import("../config/env.js").env;
let BusinessCreditAccount: typeof import("../models/businessCreditAccount.model.js").BusinessCreditAccount;
let CreditLedgerEntry: typeof import("../models/creditLedgerEntry.model.js").CreditLedgerEntry;
let PaymentTopUp: typeof import("../models/paymentTopUp.model.js").PaymentTopUp;
let WebhookEvent: typeof import("../models/webhookEvent.model.js").WebhookEvent;
let handleRazorpayWebhook: typeof import("../controllers/razorpayWebhook.controller.js").handleRazorpayWebhook;

function objectId() {
  return new mongoose.Types.ObjectId();
}

function signPayload(rawBody: Buffer) {
  const secret = env.RAZORPAY_WEBHOOK_SECRET || "phase3-test-webhook-secret";
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

async function connectTestDatabase() {
  const separator = env.MONGODB_URI.includes("?") ? "&" : "?";
  const uri = env.MONGODB_URI.includes("retryWrites=")
    ? env.MONGODB_URI
    : `${env.MONGODB_URI}${separator}retryWrites=false`;

  await mongoose.connect(uri, { family: 4, retryWrites: false });
  console.log("MongoDB connected successfully");
}

async function initializeIndexes() {
  await Promise.all([
    BusinessCreditAccount.init(),
    CreditLedgerEntry.init(),
    PaymentTopUp.init(),
    WebhookEvent.init()
  ]);
}

async function cleanup() {
  await Promise.all([
    // Test teardown bypasses append-only middleware only for records created by this run.
    CreditLedgerEntry.collection.deleteMany({ businessAccountId: { $in: businessAccountIds } }),
    BusinessCreditAccount.deleteMany({ businessAccountId: { $in: businessAccountIds } }),
    PaymentTopUp.deleteMany({ internalReference: { $regex: `^${runId}` } }),
    WebhookEvent.deleteMany({ providerEventId: { $regex: `^${runId}` } })
  ]);
}

function createMockResponse() {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    }
  };

  return response;
}

async function sendWebhook(providerEventId: string, payload: Record<string, unknown>) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const request = {
    body: rawBody,
    headers: {
      "x-razorpay-signature": signPayload(rawBody),
      "x-razorpay-event-id": providerEventId
    }
  };
  const response = createMockResponse();

  await handleRazorpayWebhook(request as never, response as never);
  return response;
}

async function testCapturedWebhookIdempotency() {
  const businessAccountId = objectId();
  const userId = objectId();
  businessAccountIds.push(businessAccountId);

  const orderId = `${runId}:order:captured`;
  const paymentId = `${runId}:payment:captured`;
  await PaymentTopUp.create({
    businessAccountId,
    clientUserId: userId,
    amountMinor: 2500,
    currency: "INR",
    internalReference: `${runId}:topup:captured`,
    idempotencyKey: `${runId}:topup-idem:captured`,
    razorpayOrderId: orderId,
    status: "CREATED"
  });

  const capturedPayload = {
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: orderId,
          amount: 2500,
          currency: "INR",
          status: "captured"
        }
      }
    }
  };

  const first = await sendWebhook(`${runId}:evt:captured:1`, capturedPayload);
  const replay = await sendWebhook(`${runId}:evt:captured:1`, capturedPayload);
  const orderPaid = await sendWebhook(`${runId}:evt:orderpaid:1`, {
    event: "order.paid",
    payload: {
      payment: capturedPayload.payload.payment,
      order: {
        entity: {
          id: orderId,
          amount: 2500,
          currency: "INR",
          status: "paid"
        }
      }
    }
  });

  assert.equal(first.statusCode, 200);
  assert.equal(replay.statusCode, 200);
  assert.equal(orderPaid.statusCode, 200);

  const account = await BusinessCreditAccount.findOne({ businessAccountId }).lean().exec();
  assert.ok(account);
  assert.equal(account.customerAdvanceBalanceMinor, 2500);
  assert.equal(account.reservedAdvanceMinor, 0);

  const ledgerCount = await CreditLedgerEntry.countDocuments({
    businessAccountId,
    type: "CUSTOMER_ADVANCE_RECEIVED"
  });
  assert.equal(ledgerCount, 1, "payment.captured replay and order.paid for the same payment must not double-credit.");

  const processedEvents = await WebhookEvent.countDocuments({
    providerEventId: { $in: [`${runId}:evt:captured:1`, `${runId}:evt:orderpaid:1`] }
  });
  assert.equal(processedEvents, 2);
}

async function testPaymentFailedWebhook() {
  const businessAccountId = objectId();
  const userId = objectId();
  businessAccountIds.push(businessAccountId);

  const orderId = `${runId}:order:failed`;
  await PaymentTopUp.create({
    businessAccountId,
    clientUserId: userId,
    amountMinor: 900,
    currency: "INR",
    internalReference: `${runId}:topup:failed`,
    idempotencyKey: `${runId}:topup-idem:failed`,
    razorpayOrderId: orderId,
    status: "CREATED"
  });

  const response = await sendWebhook(`${runId}:evt:failed:1`, {
    event: "payment.failed",
    payload: {
      payment: {
        entity: {
          id: `${runId}:payment:failed`,
          order_id: orderId,
          amount: 900,
          currency: "INR",
          status: "failed",
          error_code: "BAD_REQUEST_ERROR",
          error_description: "Payment failed in test"
        }
      }
    }
  });

  assert.equal(response.statusCode, 200);

  const topUp = await PaymentTopUp.findOne({ razorpayOrderId: orderId }).lean().exec();
  assert.ok(topUp);
  assert.equal(topUp.status, "FAILED");
  assert.equal(await CreditLedgerEntry.countDocuments({ businessAccountId }), 0);
}

async function main() {
  ({ env } = await import("../config/env.js"));
  ({ BusinessCreditAccount } = await import("../models/businessCreditAccount.model.js"));
  ({ CreditLedgerEntry } = await import("../models/creditLedgerEntry.model.js"));
  ({ PaymentTopUp } = await import("../models/paymentTopUp.model.js"));
  ({ WebhookEvent } = await import("../models/webhookEvent.model.js"));
  ({ handleRazorpayWebhook } = await import("../controllers/razorpayWebhook.controller.js"));

  await connectTestDatabase();
  await initializeIndexes();

  try {
    await testCapturedWebhookIdempotency();
    await testPaymentFailedWebhook();
    console.log("Prepaid Phase 3 Razorpay tests passed.");
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
