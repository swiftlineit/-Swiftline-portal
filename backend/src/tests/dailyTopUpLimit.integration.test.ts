import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { PaymentTopUp, type PaymentTopUpStatus } from "../models/paymentTopUp.model.js";
import { getDailyTopUpUsage, indiaDayRange } from "../services/prepaid/dailyTopUpLimit.service.js";

const databaseName = `swiftline_daily_topup_${Date.now()}`;

before(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: databaseName, family: 4, retryWrites: false });
  assert.equal(mongoose.connection.name, databaseName);
  await PaymentTopUp.init();
}, { timeout: 120_000 });

after(async () => {
  if (mongoose.connection.readyState !== 0) {
    assert.ok(mongoose.connection.name.startsWith("swiftline_daily_topup_"));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

let sequence = 0;

async function topUp(input: {
  businessAccountId: mongoose.Types.ObjectId;
  amountMinor: number;
  status: PaymentTopUpStatus;
  createdAt: Date;
  purpose?: "CUSTOMER_ADVANCE" | "SECURITY_DEPOSIT";
}) {
  sequence += 1;
  const unique = `${Date.now()}-${sequence}`;
  // createdAt is a timestamps-managed field, so it is written after insert.
  const created = await PaymentTopUp.create({
    businessAccountId: input.businessAccountId,
    clientUserId: new mongoose.Types.ObjectId(),
    amountMinor: input.amountMinor,
    currency: "INR",
    purpose: input.purpose ?? "CUSTOMER_ADVANCE",
    internalReference: `TOPUP-${unique}`,
    idempotencyKey: `key-${unique}`,
    razorpayOrderId: `order_${unique}`,
    status: input.status
  });
  await PaymentTopUp.collection.updateOne(
    { _id: created._id },
    { $set: { createdAt: input.createdAt } }
  );
  return created;
}

describe("daily top-up limit", () => {
  test("counts settled and fresh pending money, ignores failed, stale and deposits", { timeout: 120_000 }, async () => {
    const businessAccountId = new mongoose.Types.ObjectId();
    const now = new Date();
    const { start } = indiaDayRange(now);
    const fresh = new Date(now.getTime() - 60 * 1000);
    const stale = new Date(now.getTime() - (env.RAZORPAY_TOPUP_PENDING_TTL_MINUTES + 10) * 60 * 1000);
    const yesterday = new Date(start.getTime() - 60 * 60 * 1000);

    await Promise.all([
      topUp({ businessAccountId, amountMinor: 300_000_00, status: "CAPTURED", createdAt: fresh }),
      topUp({ businessAccountId, amountMinor: 50_000_00, status: "PROCESSING", createdAt: fresh }),
      // Unpaid but recent: still holds its share of the allowance.
      topUp({ businessAccountId, amountMinor: 20_000_00, status: "CREATED", createdAt: fresh }),
      // Unpaid and abandoned: must not lock the customer out.
      topUp({ businessAccountId, amountMinor: 90_000_00, status: "CREATED", createdAt: stale }),
      topUp({ businessAccountId, amountMinor: 25_000_00, status: "FAILED", createdAt: fresh }),
      topUp({ businessAccountId, amountMinor: 15_000_00, status: "CANCELLED", createdAt: fresh }),
      // Deposits are exempt, and yesterday's money belongs to yesterday.
      topUp({ businessAccountId, amountMinor: 400_000_00, status: "CAPTURED", createdAt: fresh, purpose: "SECURITY_DEPOSIT" }),
      topUp({ businessAccountId, amountMinor: 200_000_00, status: "CAPTURED", createdAt: yesterday })
    ]);

    const usage = await getDailyTopUpUsage({ businessAccountId, now });
    assert.equal(usage.usedMinor, 370_000_00, "captured + processing + fresh pending only");
    assert.equal(usage.limitMinor, env.RAZORPAY_MAX_DAILY_TOPUP_MINOR);
    assert.equal(usage.remainingMinor, env.RAZORPAY_MAX_DAILY_TOPUP_MINOR - 370_000_00);
  });

  test("a refunded top-up still counts, so refunding cannot reset the day", { timeout: 120_000 }, async () => {
    const businessAccountId = new mongoose.Types.ObjectId();
    const now = new Date();
    await topUp({ businessAccountId, amountMinor: 100_000_00, status: "REFUNDED", createdAt: new Date(now.getTime() - 60 * 1000) });

    assert.equal((await getDailyTopUpUsage({ businessAccountId, now })).usedMinor, 100_000_00);
  });

  test("`upTo` settles a race by letting only the earlier row through", { timeout: 120_000 }, async () => {
    const businessAccountId = new mongoose.Types.ObjectId();
    const now = new Date();
    const limit = env.RAZORPAY_MAX_DAILY_TOPUP_MINOR;
    // Two requests each for the full allowance, created in the same millisecond.
    const sameInstant = new Date(now.getTime() - 60 * 1000);
    const first = await topUp({ businessAccountId, amountMinor: limit, status: "CREATED", createdAt: sameInstant });
    const second = await topUp({ businessAccountId, amountMinor: limit, status: "CREATED", createdAt: sameInstant });

    const firstUsage = await getDailyTopUpUsage({
      businessAccountId, now,
      upTo: { createdAt: sameInstant, id: first._id as mongoose.Types.ObjectId }
    });
    const secondUsage = await getDailyTopUpUsage({
      businessAccountId, now,
      upTo: { createdAt: sameInstant, id: second._id as mongoose.Types.ObjectId }
    });

    assert.equal(firstUsage.usedMinor, limit, "the earlier row sees only itself and is accepted");
    assert.equal(firstUsage.usedMinor > limit, false);
    assert.equal(secondUsage.usedMinor, limit * 2, "the later row sees both and is refused");
    assert.equal(secondUsage.usedMinor > limit, true);
  });

  test("the day boundary follows IST, not UTC", () => {
    // 18:45 UTC on 28 July is already 00:15 IST on 29 July.
    const lateUtc = new Date("2026-07-28T18:45:00.000Z");
    assert.equal(indiaDayRange(lateUtc).dateKey, "2026-07-29");
    assert.equal(indiaDayRange(lateUtc).start.toISOString(), "2026-07-28T18:30:00.000Z");
    // 18:15 UTC is still 23:45 IST on the 28th.
    assert.equal(indiaDayRange(new Date("2026-07-28T18:15:00.000Z")).dateKey, "2026-07-28");
  });
});
