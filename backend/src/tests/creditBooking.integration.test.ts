import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { BalanceReservation } from "../models/balanceReservation.model.js";
import { BusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { CreditLedgerEntry } from "../models/creditLedgerEntry.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { ShipmentCharge } from "../models/shipmentCharge.model.js";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import {
  applyApprovedAmendmentBilling,
  applyFinalChargeVerificationBilling,
  previewAmendmentFunding
} from "../services/amendmentBilling.service.js";
import { convertBookingReservation, releaseBookingReservation, reserveBookingCapacity } from "../services/creditBooking.service.js";

const databaseName = `sl_credit_booking_${Date.now()}`;

before(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: databaseName, family: 4, retryWrites: false });
  assert.equal(mongoose.connection.name, databaseName);
  await Promise.all([
    BalanceReservation.init(), BusinessCreditAccount.init(), CreditLedgerEntry.init(), DpdShipment.init(),
    ShipmentCharge.init(), ShipmentInvoice.init()
  ]);
});

after(async () => {
  if (mongoose.connection.readyState !== 0) {
    assert.ok(mongoose.connection.name.startsWith("sl_credit_booking_"));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

function bookingInput(businessAccountId: mongoose.Types.ObjectId, amountMinor: number, suffix: string) {
  return {
    businessAccountId,
    branchId: new mongoose.Types.ObjectId(),
    shipmentDraftId: new mongoose.Types.ObjectId(),
    amountMinor,
    idempotencyKey: `BOOKING-${suffix}`,
    expiresAt: new Date(Date.now() + 60_000),
    createdBy: new mongoose.Types.ObjectId(),
    parcelCount: 1,
    pricingSnapshot: { totalAmount: amountMinor / 100, gstRate: 0.18, parcels: [] }
  };
}

function pricing(totalAmountMinor: number) {
  return {
    parcels: [],
    // CSB-IV, so freight is the whole taxable base and no clearance charge applies.
    freightAmount: totalAmountMinor / 118,
    csbType: "CSB_IV" as const,
    csbClearanceAmount: 0,
    baseAmount: totalAmountMinor / 118,
    gstAmount: totalAmountMinor / 100 - totalAmountMinor / 118,
    totalAmount: totalAmountMinor / 100,
    missingRate: false,
    exceedsMaxBoxKg: false,
    gstRate: 0.18
  };
}

async function createBilledShipment(input: {
  businessAccountId: mongoose.Types.ObjectId;
  totalAmountMinor: number;
  advanceAppliedMinor: number;
  creditOutstandingMinor: number;
}) {
  const shipmentDraftId = new mongoose.Types.ObjectId();
  const branchId = new mongoose.Types.ObjectId();
  const dpdShipmentId = new mongoose.Types.ObjectId();
  const createdBy = new mongoose.Types.ObjectId();
  const pricingSnapshot = pricing(input.totalAmountMinor);

  await ShipmentCharge.create({
    businessAccountId: input.businessAccountId,
    branchId,
    shipmentDraftId,
    dpdShipmentId,
    parcelCount: 1,
    paymentSource: "BUSINESS_ACCOUNT",
    customerChargeMinor: input.totalAmountMinor,
    customerCurrency: "INR",
    customerChargeStatus: "COMPLETED",
    pricingSnapshot
  });
  await ShipmentInvoice.create({
    invoiceNumber: `AM${new mongoose.Types.ObjectId().toString().slice(-10)}`,
    financialYear: "26-27",
    shipmentDraftId,
    dpdShipmentId,
    businessAccountId: input.businessAccountId,
    branchId,
    currency: "INR",
    supplier: {},
    customer: {},
    shipment: {},
    description: "Amendment billing integration test",
    taxableValueMinor: input.totalAmountMinor,
    gstRatePercent: 18,
    taxType: "IGST",
    totalTaxAmountMinor: 0,
    totalAmountMinor: input.totalAmountMinor,
    advanceAppliedMinor: input.advanceAppliedMinor,
    creditOutstandingMinor: input.creditOutstandingMinor,
    paymentStatus: input.creditOutstandingMinor === 0 ? "PAID" : input.advanceAppliedMinor ? "PARTIALLY_PAID" : "UNPAID",
    pricingSnapshot,
    status: "ISSUED",
    createdBy
  });

  return { shipmentDraftId, createdBy };
}

describe("atomic shipment booking balance lifecycle", () => {
  test("reserves advance first and converts credit to an unbilled charge", async () => {
    const account = await BusinessCreditAccount.create({
      businessAccountId: new mongoose.Types.ObjectId(), status: "ACTIVE",
      approvedCreditLimitMinor: 100_000, customerAdvanceBalanceMinor: 30_000
    });
    const input = bookingInput(account.businessAccountId, 70_000, "CONVERT");
    const reserved = await reserveBookingCapacity(input);
    assert.equal(reserved.reservation.advanceAmountMinor, 30_000);
    assert.equal(reserved.reservation.creditAmountMinor, 40_000);

    await convertBookingReservation({
      reservationId: reserved.reservation._id as mongoose.Types.ObjectId,
      idempotencyKey: "LEDGER-BOOKING-CONVERT",
      createdBy: input.createdBy,
      dpdShipmentId: new mongoose.Types.ObjectId()
    });

    const updated = await BusinessCreditAccount.findById(account._id).lean().exec();
    assert.equal(updated?.customerAdvanceBalanceMinor, 0);
    assert.equal(updated?.reservedAdvanceMinor, 0);
    assert.equal(updated?.reservedCreditMinor, 0);
    assert.equal(updated?.unbilledCreditMinor, 40_000);
    assert.equal((await ShipmentCharge.findOne({ shipmentDraftId: input.shipmentDraftId }).lean().exec())?.customerChargeStatus, "COMPLETED");
  });

  test("allows advance-only booking and restores a released hold", async () => {
    const account = await BusinessCreditAccount.create({
      businessAccountId: new mongoose.Types.ObjectId(), status: "NOT_REQUESTED", customerAdvanceBalanceMinor: 25_000
    });
    const input = bookingInput(account.businessAccountId, 20_000, "RELEASE");
    const reserved = await reserveBookingCapacity(input);
    assert.equal(reserved.reservation.creditAmountMinor, 0);

    await releaseBookingReservation({
      reservationId: reserved.reservation._id as mongoose.Types.ObjectId,
      idempotencyKey: "LEDGER-BOOKING-RELEASE",
      createdBy: input.createdBy
    });

    const updated = await BusinessCreditAccount.findById(account._id).lean().exec();
    assert.equal(updated?.customerAdvanceBalanceMinor, 25_000);
    assert.equal(updated?.reservedAdvanceMinor, 0);
    assert.equal((await ShipmentCharge.findOne({ shipmentDraftId: input.shipmentDraftId }).lean().exec())?.customerChargeStatus, "REVERSED");
  });

  test("rejects insufficient capacity without leaving financial records", async () => {
    const account = await BusinessCreditAccount.create({
      businessAccountId: new mongoose.Types.ObjectId(), status: "ACTIVE",
      approvedCreditLimitMinor: 5_000, customerAdvanceBalanceMinor: 5_000
    });
    const input = bookingInput(account.businessAccountId, 10_001, "INSUFFICIENT");
    await assert.rejects(reserveBookingCapacity(input), /INSUFFICIENT_BOOKING_CAPACITY/);
    assert.equal(await BalanceReservation.countDocuments({ shipmentDraftId: input.shipmentDraftId }), 0);
    assert.equal(await ShipmentCharge.countDocuments({ shipmentDraftId: input.shipmentDraftId }), 0);
  });
});

describe("atomic amendment billing lifecycle", () => {
  test("previews a test shipment without requiring a business-account charge record", async () => {
    const businessAccountId = new mongoose.Types.ObjectId();
    const shipmentDraftId = new mongoose.Types.ObjectId();
    const branchId = new mongoose.Types.ObjectId();
    const createdBy = new mongoose.Types.ObjectId();
    const dpdShipment = await DpdShipment.create({
      shipmentDraftId,
      idempotencyKey: `TEST-AMENDMENT-${shipmentDraftId.toString()}`,
      serviceCode: "TEST",
      paymentSource: "TEST",
      shippingEnvironment: "MOCK",
      status: "LABEL_RECEIVED"
    });
    await ShipmentInvoice.create({
      invoiceNumber: `TEST${shipmentDraftId.toString().slice(-8)}`,
      financialYear: "26-27",
      shipmentDraftId,
      dpdShipmentId: dpdShipment._id,
      businessAccountId,
      branchId,
      currency: "INR",
      supplier: {},
      customer: {},
      shipment: {},
      description: "Test shipment amendment",
      taxableValueMinor: 10_000,
      gstRatePercent: 18,
      taxType: "IGST",
      totalTaxAmountMinor: 0,
      totalAmountMinor: 10_000,
      advanceAppliedMinor: 0,
      creditOutstandingMinor: 10_000,
      paymentStatus: "UNPAID",
      pricingSnapshot: pricing(10_000),
      status: "ISSUED",
      createdBy
    });

    const preview = await previewAmendmentFunding({
      shipmentDraftId,
      businessAccountId,
      pricing: pricing(12_000)
    });

    assert.equal(preview.billingMode, "TEST");
    assert.equal(preview.canFund, true);
    assert.equal(preview.deltaAmountMinor, 2_000);
    assert.equal(preview.adjustment?.creditUsedMinor, 2_000);
  });

  test("previews the advance and credit split without changing balances", async () => {
    const account = await BusinessCreditAccount.create({
      businessAccountId: new mongoose.Types.ObjectId(), status: "ACTIVE",
      approvedCreditLimitMinor: 100_000, customerAdvanceBalanceMinor: 10_000,
      unbilledCreditMinor: 30_000
    });
    const shipment = await createBilledShipment({
      businessAccountId: account.businessAccountId,
      totalAmountMinor: 30_000,
      advanceAppliedMinor: 0,
      creditOutstandingMinor: 30_000
    });

    const preview = await previewAmendmentFunding({
      shipmentDraftId: shipment.shipmentDraftId,
      businessAccountId: account.businessAccountId,
      pricing: pricing(55_000)
    });

    assert.equal(preview.billingMode, "BUSINESS_ACCOUNT");
    assert.equal(preview.canFund, true);
    assert.equal(preview.adjustment?.advanceUsedMinor, 10_000);
    assert.equal(preview.adjustment?.creditUsedMinor, 15_000);
    const unchanged = await BusinessCreditAccount.findById(account._id).lean().exec();
    assert.equal(unchanged?.customerAdvanceBalanceMinor, 10_000);
    assert.equal(unchanged?.unbilledCreditMinor, 30_000);
  });

  test("reports insufficient capacity without creating a billing adjustment", async () => {
    const account = await BusinessCreditAccount.create({
      businessAccountId: new mongoose.Types.ObjectId(), status: "ACTIVE",
      approvedCreditLimitMinor: 10_000, unbilledCreditMinor: 10_000
    });
    const shipment = await createBilledShipment({
      businessAccountId: account.businessAccountId,
      totalAmountMinor: 10_000,
      advanceAppliedMinor: 0,
      creditOutstandingMinor: 10_000
    });

    const preview = await previewAmendmentFunding({
      shipmentDraftId: shipment.shipmentDraftId,
      businessAccountId: account.businessAccountId,
      pricing: pricing(11_000)
    });

    assert.equal(preview.canFund, false);
    assert.equal(preview.availableBookingCapacityMinor, 0);
    assert.equal(preview.adjustment, null);
  });

  test("applies an increase using advance before additional credit", async () => {
    const account = await BusinessCreditAccount.create({
      businessAccountId: new mongoose.Types.ObjectId(), status: "ACTIVE",
      approvedCreditLimitMinor: 100_000, customerAdvanceBalanceMinor: 10_000,
      unbilledCreditMinor: 30_000
    });
    const shipment = await createBilledShipment({
      businessAccountId: account.businessAccountId,
      totalAmountMinor: 30_000,
      advanceAppliedMinor: 0,
      creditOutstandingMinor: 30_000
    });

    const session = await mongoose.startSession();
    let adjustment: Awaited<ReturnType<typeof applyApprovedAmendmentBilling>> | undefined;
    await session.withTransaction(async () => {
      adjustment = await applyApprovedAmendmentBilling({
        amendmentId: new mongoose.Types.ObjectId(),
        shipmentDraftId: shipment.shipmentDraftId,
        businessAccountId: account.businessAccountId,
        pricing: pricing(55_000),
        createdBy: shipment.createdBy,
        session
      });
    });
    await session.endSession();

    assert.equal(adjustment?.advanceUsedMinor, 10_000);
    assert.equal(adjustment?.creditUsedMinor, 15_000);
    const updated = await BusinessCreditAccount.findById(account._id).lean().exec();
    assert.equal(updated?.customerAdvanceBalanceMinor, 0);
    assert.equal(updated?.unbilledCreditMinor, 45_000);
  });

  test("reduces credit first and refunds the remaining reduction to advance", async () => {
    const account = await BusinessCreditAccount.create({
      businessAccountId: new mongoose.Types.ObjectId(), status: "ACTIVE",
      approvedCreditLimitMinor: 100_000, unbilledCreditMinor: 40_000
    });
    const shipment = await createBilledShipment({
      businessAccountId: account.businessAccountId,
      totalAmountMinor: 50_000,
      advanceAppliedMinor: 10_000,
      creditOutstandingMinor: 40_000
    });

    const session = await mongoose.startSession();
    let adjustment: Awaited<ReturnType<typeof applyApprovedAmendmentBilling>> | undefined;
    await session.withTransaction(async () => {
      adjustment = await applyApprovedAmendmentBilling({
        amendmentId: new mongoose.Types.ObjectId(),
        shipmentDraftId: shipment.shipmentDraftId,
        businessAccountId: account.businessAccountId,
        pricing: pricing(5_000),
        createdBy: shipment.createdBy,
        session
      });
    });
    await session.endSession();

    assert.equal(adjustment?.creditReducedMinor, 40_000);
    assert.equal(adjustment?.advanceRefundedMinor, 5_000);
    const updated = await BusinessCreditAccount.findById(account._id).lean().exec();
    assert.equal(updated?.customerAdvanceBalanceMinor, 5_000);
    assert.equal(updated?.unbilledCreditMinor, 0);
  });

  test("rejects an unfunded increase without changing balances or shipment charge", async () => {
    const account = await BusinessCreditAccount.create({
      businessAccountId: new mongoose.Types.ObjectId(), status: "ACTIVE",
      approvedCreditLimitMinor: 10_000, unbilledCreditMinor: 10_000
    });
    const shipment = await createBilledShipment({
      businessAccountId: account.businessAccountId,
      totalAmountMinor: 10_000,
      advanceAppliedMinor: 0,
      creditOutstandingMinor: 10_000
    });
    const session = await mongoose.startSession();

    await assert.rejects(
      session.withTransaction(() => applyApprovedAmendmentBilling({
        amendmentId: new mongoose.Types.ObjectId(),
        shipmentDraftId: shipment.shipmentDraftId,
        businessAccountId: account.businessAccountId,
        pricing: pricing(11_000),
        createdBy: shipment.createdBy,
        session
      })),
      /not sufficient for this amendment/
    );
    await session.endSession();

    const updated = await BusinessCreditAccount.findById(account._id).lean().exec();
    const charge = await ShipmentCharge.findOne({ shipmentDraftId: shipment.shipmentDraftId }).lean().exec();
    assert.equal(updated?.unbilledCreditMinor, 10_000);
    assert.equal(charge?.customerChargeMinor, 10_000);
  });
});

describe("atomic final charge verification billing lifecycle", () => {
  test("uses advance before credit and writes a distinct final-charge ledger entry", async () => {
    const account = await BusinessCreditAccount.create({
      businessAccountId: new mongoose.Types.ObjectId(), status: "ACTIVE",
      approvedCreditLimitMinor: 100_000, customerAdvanceBalanceMinor: 5_000,
      unbilledCreditMinor: 10_000
    });
    const shipment = await createBilledShipment({
      businessAccountId: account.businessAccountId,
      totalAmountMinor: 10_000,
      advanceAppliedMinor: 0,
      creditOutstandingMinor: 10_000
    });
    const verificationId = new mongoose.Types.ObjectId();
    const session = await mongoose.startSession();

    let adjustment: Awaited<ReturnType<typeof applyFinalChargeVerificationBilling>> | undefined;
    await session.withTransaction(async () => {
      adjustment = await applyFinalChargeVerificationBilling({
        verificationId,
        shipmentDraftId: shipment.shipmentDraftId,
        businessAccountId: account.businessAccountId,
        pricing: pricing(18_000),
        createdBy: shipment.createdBy,
        session
      });
    });
    await session.endSession();

    assert.equal(adjustment?.advanceUsedMinor, 5_000);
    assert.equal(adjustment?.creditUsedMinor, 3_000);
    const updated = await BusinessCreditAccount.findById(account._id).lean().exec();
    const ledgerEntry = await CreditLedgerEntry.findOne({
      idempotencyKey: `FINAL_CHARGE:${verificationId.toString()}`
    }).lean().exec();
    assert.equal(updated?.customerAdvanceBalanceMinor, 0);
    assert.equal(updated?.unbilledCreditMinor, 13_000);
    assert.equal(ledgerEntry?.type, "FINAL_CHARGE_INCREASE_APPLIED");
    assert.equal(ledgerEntry?.amountMinor, 8_000);
  });

  test("returns the final-verification contact message when capacity is insufficient", async () => {
    const account = await BusinessCreditAccount.create({
      businessAccountId: new mongoose.Types.ObjectId(), status: "ACTIVE",
      approvedCreditLimitMinor: 10_000, unbilledCreditMinor: 10_000
    });
    const shipment = await createBilledShipment({
      businessAccountId: account.businessAccountId,
      totalAmountMinor: 10_000,
      advanceAppliedMinor: 0,
      creditOutstandingMinor: 10_000
    });

    const preview = await previewAmendmentFunding({
      shipmentDraftId: shipment.shipmentDraftId,
      businessAccountId: account.businessAccountId,
      pricing: pricing(11_000),
      purpose: "FINAL_VERIFICATION"
    });

    assert.equal(preview.canFund, false);
    assert.match(preview.message, /final verified charge/);
  });

  test("reduces credit before refunding advance and records the final reduction", async () => {
    const account = await BusinessCreditAccount.create({
      businessAccountId: new mongoose.Types.ObjectId(), status: "ACTIVE",
      approvedCreditLimitMinor: 100_000, unbilledCreditMinor: 40_000
    });
    const shipment = await createBilledShipment({
      businessAccountId: account.businessAccountId,
      totalAmountMinor: 50_000,
      advanceAppliedMinor: 10_000,
      creditOutstandingMinor: 40_000
    });
    const verificationId = new mongoose.Types.ObjectId();
    const session = await mongoose.startSession();

    await session.withTransaction(() => applyFinalChargeVerificationBilling({
      verificationId,
      shipmentDraftId: shipment.shipmentDraftId,
      businessAccountId: account.businessAccountId,
      pricing: pricing(5_000),
      createdBy: shipment.createdBy,
      session
    }));
    await session.endSession();

    const updated = await BusinessCreditAccount.findById(account._id).lean().exec();
    const ledgerEntry = await CreditLedgerEntry.findOne({
      idempotencyKey: `FINAL_CHARGE:${verificationId.toString()}`
    }).lean().exec();
    assert.equal(updated?.customerAdvanceBalanceMinor, 5_000);
    assert.equal(updated?.unbilledCreditMinor, 0);
    assert.equal(ledgerEntry?.type, "FINAL_CHARGE_REDUCTION_APPLIED");
    assert.equal(ledgerEntry?.amountMinor, 45_000);
  });
});
