import mongoose from "mongoose";
import { AuditLog } from "../../models/auditLog.model.js";
import { BusinessAccount } from "../../models/businessAccount.model.js";
import { BusinessCreditAccount } from "../../models/businessCreditAccount.model.js";
import { CreditLedgerEntry } from "../../models/creditLedgerEntry.model.js";
import { PaymentTopUp } from "../../models/paymentTopUp.model.js";
import { PrepaidAccount } from "../../models/prepaidAccount.model.js";
import type { PrepaidCurrency } from "../../models/financialTypes.js";
import { appendCreditLedgerEntry, ensureCreditAccount } from "../creditAccount.service.js";
import { notifyActiveAdmins, notifyBusinessFinancialMembers } from "../portalNotification.service.js";
import { formatMinorRupees } from "./dailyTopUpLimit.service.js";
import { createLedgerEntry, findLedgerEntryByIdempotencyKey } from "./ledger.service.js";

type EnsureAccountInput = {
  businessAccountId: mongoose.Types.ObjectId;
  currency?: PrepaidCurrency;
};

type CreditCapturedTopUpInput = {
  paymentTopUpId: mongoose.Types.ObjectId;
  razorpayPaymentId: string;
  razorpaySignature?: string;
  idempotencyKey: string;
  expectedAmountMinor?: number;
  expectedCurrency?: PrepaidCurrency;
  createdBy?: mongoose.Types.ObjectId | null;
};

type CreatePaymentTopUpInput = {
  businessAccountId: mongoose.Types.ObjectId;
  clientUserId: mongoose.Types.ObjectId;
  amountMinor: number;
  currency?: PrepaidCurrency;
  purpose?: "CUSTOMER_ADVANCE" | "SECURITY_DEPOSIT";
  internalReference: string;
  idempotencyKey: string;
  razorpayOrderId: string;
};

type MarkTopUpFailedInput = {
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  failureCode?: string;
  failureDescription?: string;
};

type MarkCheckoutVerifiedInput = {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
};

type AdminAdjustmentInput = {
  businessAccountId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId | null;
  amountMinor: number;
  currency?: PrepaidCurrency;
  reason: string;
  idempotencyKey: string;
  createdBy: mongoose.Types.ObjectId;
};

function assertPositiveMinorAmount(amountMinor: number) {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("Amount must be a positive integer minor-unit value.");
  }
}

export async function ensurePrepaidAccount(input: EnsureAccountInput, session?: mongoose.ClientSession) {
  return PrepaidAccount.findOneAndUpdate(
    { businessAccountId: input.businessAccountId },
    {
      $setOnInsert: {
        businessAccountId: input.businessAccountId,
        currency: input.currency ?? "INR",
        cashBalanceMinor: 0,
        reservedBalanceMinor: 0,
        status: "ACTIVE",
        version: 0,
        minimumBalanceWarningMinor: 0
      }
    },
    { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true, session }
  ).exec();
}

export async function findPaymentTopUpByIdempotencyKey(idempotencyKey: string) {
  return PaymentTopUp.findOne({ idempotencyKey }).exec();
}

export async function findPaymentTopUpByRazorpayOrderId(razorpayOrderId: string) {
  return PaymentTopUp.findOne({ razorpayOrderId }).exec();
}

export async function createPaymentTopUp(input: CreatePaymentTopUpInput) {
  assertPositiveMinorAmount(input.amountMinor);

  const existing = await findPaymentTopUpByIdempotencyKey(input.idempotencyKey);
  if (existing) return { created: false as const, topUp: existing };

  const [topUp] = await PaymentTopUp.create([{
    businessAccountId: input.businessAccountId,
    clientUserId: input.clientUserId,
    amountMinor: input.amountMinor,
    currency: input.currency ?? "INR",
    purpose: input.purpose ?? "CUSTOMER_ADVANCE",
    internalReference: input.internalReference,
    idempotencyKey: input.idempotencyKey,
    razorpayOrderId: input.razorpayOrderId,
    status: "CREATED"
  }]);

  if (!topUp) throw new Error("Payment top-up could not be created.");

  return { created: true as const, topUp };
}

/**
 * Cancels an unpaid order. Used when a top-up is created but immediately refused
 * (for example by the daily limit), so it never counts against the allowance.
 */
export async function cancelPaymentTopUp(paymentTopUpId: mongoose.Types.ObjectId, reason = "") {
  return PaymentTopUp.findOneAndUpdate(
    { _id: paymentTopUpId, status: { $in: ["CREATED", "CHECKOUT_OPENED"] } },
    { $set: { status: "CANCELLED", failureDescription: reason } },
    { returnDocument: "after", runValidators: true }
  ).exec();
}

export async function markPaymentTopUpFailed(input: MarkTopUpFailedInput) {
  const filters: Record<string, string> = input.razorpayOrderId
    ? { razorpayOrderId: input.razorpayOrderId }
    : {};

  if (!input.razorpayOrderId && input.razorpayPaymentId) {
    filters.razorpayPaymentId = input.razorpayPaymentId;
  }

  if (!Object.keys(filters).length) return null;

  return PaymentTopUp.findOneAndUpdate(
    { ...filters, status: { $nin: ["CAPTURED", "REFUNDED"] } },
    {
      $set: {
        status: "FAILED",
        razorpayPaymentId: input.razorpayPaymentId ?? "",
        failureCode: input.failureCode ?? "",
        failureDescription: input.failureDescription ?? ""
      }
    },
    { returnDocument: "after", runValidators: true }
  ).exec();
}

export async function markPaymentTopUpCheckoutVerified(input: MarkCheckoutVerifiedInput) {
  return PaymentTopUp.findOneAndUpdate(
    { razorpayOrderId: input.razorpayOrderId, status: { $nin: ["CAPTURED", "FAILED", "CANCELLED", "REFUNDED"] } },
    {
      $set: {
        status: "PROCESSING",
        razorpayPaymentId: input.razorpayPaymentId,
        razorpaySignature: input.razorpaySignature
      }
    },
    { returnDocument: "after", runValidators: true }
  ).exec();
}

export async function creditCapturedTopUp(input: CreditCapturedTopUpInput) {
  const existingLedger = await CreditLedgerEntry.findOne({ idempotencyKey: input.idempotencyKey }).exec()
    ?? await findLedgerEntryByIdempotencyKey(input.idempotencyKey);
  if (existingLedger) return { credited: false as const, ledgerEntry: existingLedger };

  const session = await mongoose.startSession();

  try {
    let result;
    await session.withTransaction(async () => {
      const topUp = await PaymentTopUp.findOneAndUpdate(
        { _id: input.paymentTopUpId, status: { $ne: "CAPTURED" } },
        {
          $set: {
            status: "CAPTURED",
            razorpayPaymentId: input.razorpayPaymentId,
            razorpaySignature: input.razorpaySignature ?? ""
          }
        },
        { returnDocument: "after", runValidators: true, session }
      ).exec();

      if (!topUp) {
        result = {
          credited: false as const,
          ledgerEntry: await CreditLedgerEntry.findOne({ idempotencyKey: input.idempotencyKey }).session(session).exec()
            ?? await findLedgerEntryByIdempotencyKey(input.idempotencyKey, session)
        };
        return;
      }

      assertPositiveMinorAmount(topUp.amountMinor);

      if (input.expectedAmountMinor !== undefined && topUp.amountMinor !== input.expectedAmountMinor) {
        throw new Error("Razorpay payment amount does not match the top-up amount.");
      }

      if (input.expectedCurrency && topUp.currency !== input.expectedCurrency) {
        throw new Error("Razorpay payment currency does not match the top-up currency.");
      }

      if (topUp.purpose === "SECURITY_DEPOSIT") {
        const business = await BusinessAccount.findById(topUp.businessAccountId).session(session).exec();
        const creditAccount = await BusinessCreditAccount.findOne({ businessAccountId: topUp.businessAccountId }).session(session).exec();
        if (!business || !creditAccount) throw new Error("Security deposit target could not be found.");
        if (creditAccount.securityDepositRequiredMinor <= 0) throw new Error("Security deposit is not required for this account.");
        if (business.depositStatus === "received") throw new Error("Security deposit has already been received.");
        if (creditAccount.securityDepositRequiredMinor !== topUp.amountMinor) {
          throw new Error("Security deposit amount does not match the approved requirement.");
        }

        const updatedBusiness = await BusinessAccount.findOneAndUpdate(
          { _id: business._id, depositStatus: { $ne: "received" } },
          {
            $set: { depositStatus: "received", updatedBy: input.createdBy ?? topUp.clientUserId }
          },
          { returnDocument: "after", runValidators: true, session }
        ).exec();

        if (!updatedBusiness) throw new Error("Security deposit could not be recorded.");

        await AuditLog.create([{
          action: "SECURITY_DEPOSIT_RECEIVED",
          entityType: "BUSINESS_ACCOUNT",
          entityId: business._id,
          performedBy: input.createdBy ?? topUp.clientUserId,
          performedAt: new Date(),
          metadata: {
            businessAccountId: business._id,
            amountMinor: topUp.amountMinor,
            currency: topUp.currency,
            paymentTopUpId: topUp._id,
            internalReference: topUp.internalReference
          }
        }], { session });

        await notifyActiveAdmins({
          type: "SECURITY_DEPOSIT_RECEIVED",
          title: "Security deposit received",
          message: `${business.company.companyName || business.accountId} paid its `
            + `${formatMinorRupees(topUp.amountMinor)} security deposit. The credit facility can now be activated.`,
          href: `/dashboard/credit-accounts#credit-account-${String(business._id)}`,
          idempotencyKey: `SECURITY_DEPOSIT_RECEIVED:${String(topUp._id)}`,
          businessAccountId: business._id as mongoose.Types.ObjectId,
          metadata: { paymentTopUpId: topUp._id, amountMinor: topUp.amountMinor }
        }, session);

        result = { credited: true as const, ledgerEntry: null };
        return;
      }

      const account = await ensureCreditAccount(topUp.businessAccountId, session);
      const updatedAccount = await BusinessCreditAccount.findOneAndUpdate(
        { _id: account._id },
        { $inc: { customerAdvanceBalanceMinor: topUp.amountMinor, version: 1 } },
        { returnDocument: "after", runValidators: true, session }
      ).exec();
      if (!updatedAccount) throw new Error("Customer Advance could not be credited.");

      const ledgerEntry = await appendCreditLedgerEntry({
        account: updatedAccount,
        type: "CUSTOMER_ADVANCE_RECEIVED",
        reference: topUp.internalReference,
        description: `Customer Advance received: ${topUp.internalReference}`,
        amountMinor: topUp.amountMinor,
        idempotencyKey: input.idempotencyKey,
        createdBy: input.createdBy ?? topUp.clientUserId,
        metadata: { paymentTopUpId: topUp._id },
        session
      });

      await notifyBusinessFinancialMembers(topUp.businessAccountId, {
        type: "CUSTOMER_ADVANCE_CREDITED",
        title: "Customer Advance credited",
        message: `${formatMinorRupees(topUp.amountMinor)} was received and added to your Customer Advance balance.`,
        href: "/client/payments#payment-history",
        idempotencyKey: `CUSTOMER_ADVANCE_CREDITED:${String(topUp._id)}`,
        metadata: { paymentTopUpId: topUp._id, amountMinor: topUp.amountMinor }
      }, session);

      result = { credited: true as const, ledgerEntry };
    });

    return result;
  } finally {
    await session.endSession();
  }
}

export async function applyAdminCredit(input: AdminAdjustmentInput) {
  assertPositiveMinorAmount(input.amountMinor);

  const existingLedger = await findLedgerEntryByIdempotencyKey(input.idempotencyKey);
  if (existingLedger) return { applied: false as const, ledgerEntry: existingLedger };

  const session = await mongoose.startSession();

  try {
    let result;
    await session.withTransaction(async () => {
      const account = await ensurePrepaidAccount({
        businessAccountId: input.businessAccountId,
        currency: input.currency ?? "INR"
      }, session);

      if (account.status !== "ACTIVE") throw new Error("Prepaid account is not active.");

      const updatedAccount = await PrepaidAccount.findOneAndUpdate(
        { _id: account._id, status: "ACTIVE" },
        { $inc: { cashBalanceMinor: input.amountMinor, version: 1 } },
        { returnDocument: "after", runValidators: true, session }
      ).exec();

      if (!updatedAccount) throw new Error("Admin credit could not be applied.");

      const ledgerEntry = await createLedgerEntry({
        businessAccountId: input.businessAccountId,
        branchId: input.branchId ?? null,
        transactionType: "ADMIN_CREDIT",
        direction: "CREDIT",
        amountMinor: input.amountMinor,
        currency: input.currency ?? "INR",
        referenceType: "ADMIN_ADJUSTMENT",
        referenceId: input.createdBy,
        idempotencyKey: input.idempotencyKey,
        paymentSource: "CLIENT_PREPAID",
        before: {
          cashBalanceMinor: updatedAccount.cashBalanceMinor - input.amountMinor,
          reservedBalanceMinor: updatedAccount.reservedBalanceMinor
        },
        after: {
          cashBalanceMinor: updatedAccount.cashBalanceMinor,
          reservedBalanceMinor: updatedAccount.reservedBalanceMinor
        },
        description: input.reason,
        createdBy: input.createdBy
      }, session);

      result = { applied: true as const, ledgerEntry };
    });

    return result;
  } finally {
    await session.endSession();
  }
}

export async function applyAdminDebit(input: AdminAdjustmentInput) {
  assertPositiveMinorAmount(input.amountMinor);

  const existingLedger = await findLedgerEntryByIdempotencyKey(input.idempotencyKey);
  if (existingLedger) return { applied: false as const, ledgerEntry: existingLedger };

  const session = await mongoose.startSession();

  try {
    let result;
    await session.withTransaction(async () => {
      const updatedAccount = await PrepaidAccount.findOneAndUpdate(
        {
          businessAccountId: input.businessAccountId,
          currency: input.currency ?? "INR",
          status: "ACTIVE",
          $expr: {
            $gte: [
              { $subtract: ["$cashBalanceMinor", "$reservedBalanceMinor"] },
              input.amountMinor
            ]
          }
        },
        { $inc: { cashBalanceMinor: -input.amountMinor, version: 1 } },
        { returnDocument: "after", runValidators: true, session }
      ).exec();

      if (!updatedAccount) throw new Error("INSUFFICIENT_BALANCE");

      const ledgerEntry = await createLedgerEntry({
        businessAccountId: input.businessAccountId,
        branchId: input.branchId ?? null,
        transactionType: "ADMIN_DEBIT",
        direction: "DEBIT",
        amountMinor: input.amountMinor,
        currency: input.currency ?? "INR",
        referenceType: "ADMIN_ADJUSTMENT",
        referenceId: input.createdBy,
        idempotencyKey: input.idempotencyKey,
        paymentSource: "CLIENT_PREPAID",
        before: {
          cashBalanceMinor: updatedAccount.cashBalanceMinor + input.amountMinor,
          reservedBalanceMinor: updatedAccount.reservedBalanceMinor
        },
        after: {
          cashBalanceMinor: updatedAccount.cashBalanceMinor,
          reservedBalanceMinor: updatedAccount.reservedBalanceMinor
        },
        description: input.reason,
        createdBy: input.createdBy
      }, session);

      result = { applied: true as const, ledgerEntry };
    });

    return result;
  } finally {
    await session.endSession();
  }
}
