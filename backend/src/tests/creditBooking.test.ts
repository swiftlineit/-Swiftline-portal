import assert from "node:assert/strict";
import { describe, test } from "node:test";
import mongoose from "mongoose";
import { BalanceReservation } from "../models/balanceReservation.model.js";
import { allocateBookingAmount } from "../services/creditBooking.service.js";

describe("shipment booking allocation policy", () => {
  test("uses Customer Advance before approved credit", () => {
    assert.deepEqual(allocateBookingAmount(70_000, 30_000, 50_000), {
      advanceAmountMinor: 30_000,
      creditAmountMinor: 40_000
    });
  });

  test("supports advance-only bookings", () => {
    assert.deepEqual(allocateBookingAmount(25_000, 40_000, 0), {
      advanceAmountMinor: 25_000,
      creditAmountMinor: 0
    });
  });

  test("rejects invalid amounts and insufficient combined capacity", () => {
    assert.throws(() => allocateBookingAmount(0, 10_000, 10_000), /BOOKING_AMOUNT_INVALID/);
    assert.throws(() => allocateBookingAmount(25_000, 10_000, 14_999), /INSUFFICIENT_BOOKING_CAPACITY/);
  });

  test("requires the reservation split to equal the GST-inclusive amount", async () => {
    const reservation = new BalanceReservation({
      businessAccountId: new mongoose.Types.ObjectId(),
      branchId: new mongoose.Types.ObjectId(),
      shipmentDraftId: new mongoose.Types.ObjectId(),
      amountMinor: 50_000,
      advanceAmountMinor: 20_000,
      creditAmountMinor: 20_000,
      idempotencyKey: "TEST-INVALID-SPLIT",
      expiresAt: new Date(Date.now() + 60_000)
    });

    await assert.rejects(reservation.validate(), /Advance and credit allocation must equal the reserved amount/);
  });
});
