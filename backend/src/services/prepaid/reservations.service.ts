import mongoose from "mongoose";
import { BalanceReservation, type BalanceReservationStatus } from "../../models/balanceReservation.model.js";
import type { PrepaidCurrency } from "../../models/financialTypes.js";
import { PrepaidAccount } from "../../models/prepaidAccount.model.js";
import { createLedgerEntry, findLedgerEntryByIdempotencyKey } from "./ledger.service.js";

type ReserveFundsInput = {
  businessAccountId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  shipmentDraftId: mongoose.Types.ObjectId;
  amountMinor: number;
  currency?: PrepaidCurrency;
  idempotencyKey: string;
  expiresAt: Date;
  createdBy?: mongoose.Types.ObjectId | null;
};

type ReservationTransitionInput = {
  reservationId: mongoose.Types.ObjectId;
  idempotencyKey: string;
  createdBy?: mongoose.Types.ObjectId | null;
};

function assertPositiveMinorAmount(amountMinor: number) {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error("Amount must be a positive integer minor-unit value.");
  }
}

function isTransientTransactionError(error: unknown) {
  const labels = (error as { errorLabels?: unknown })?.errorLabels;
  return Array.isArray(labels) && labels.includes("TransientTransactionError");
}

async function runTransactionWithRetry<T>(operation: (session: mongoose.ClientSession) => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const session = await mongoose.startSession();
    try {
      let result: T | undefined;
      await session.withTransaction(async () => {
        result = await operation(session);
      });
      return result as T;
    } catch (error) {
      lastError = error;
      if (!isTransientTransactionError(error) || attempt === attempts - 1) throw error;
    } finally {
      await session.endSession();
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Transaction failed.");
}

async function findReservationByIdempotencyKey(idempotencyKey: string, session?: mongoose.ClientSession) {
  return BalanceReservation.findOne({ idempotencyKey }).session(session ?? null).exec();
}

async function transitionReservationStatus(
  input: ReservationTransitionInput & {
    from: BalanceReservationStatus[];
    to: BalanceReservationStatus;
    timestampField: "consumingAt" | "convertedAt" | "releasedAt" | "expiredAt" | "reviewRequiredAt";
  },
  session: mongoose.ClientSession
) {
  return BalanceReservation.findOneAndUpdate(
    { _id: input.reservationId, status: { $in: input.from } },
    { $set: { status: input.to, [input.timestampField]: new Date() } },
    { returnDocument: "after", runValidators: true, session }
  ).exec();
}

export async function reserveFunds(input: ReserveFundsInput) {
  assertPositiveMinorAmount(input.amountMinor);

  const existingReservation = await findReservationByIdempotencyKey(input.idempotencyKey);
  if (existingReservation) return { reserved: false as const, reservation: existingReservation };

  const existingLedger = await findLedgerEntryByIdempotencyKey(`LEDGER:${input.idempotencyKey}`);
  if (existingLedger) return { reserved: false as const, reservation: null };

  return runTransactionWithRetry(async (session) => {
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
      { $inc: { reservedBalanceMinor: input.amountMinor, version: 1 } },
      { returnDocument: "after", runValidators: true, session }
    ).exec();

    if (!updatedAccount) throw new Error("INSUFFICIENT_BALANCE");

    const [reservation] = await BalanceReservation.create([{
      businessAccountId: input.businessAccountId,
      branchId: input.branchId,
      shipmentDraftId: input.shipmentDraftId,
      amountMinor: input.amountMinor,
      advanceAmountMinor: input.amountMinor,
      creditAmountMinor: 0,
      currency: input.currency ?? "INR",
      status: "ACTIVE",
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt
    }], { session });

    if (!reservation) throw new Error("Reservation could not be created.");

    await createLedgerEntry({
      businessAccountId: input.businessAccountId,
      branchId: input.branchId,
      transactionType: "LABEL_CHARGE_RESERVED",
      direction: "DEBIT",
      amountMinor: input.amountMinor,
      currency: input.currency ?? "INR",
      referenceType: "BALANCE_RESERVATION",
      referenceId: reservation._id as mongoose.Types.ObjectId,
      idempotencyKey: `LEDGER:${input.idempotencyKey}`,
      paymentSource: "CLIENT_PREPAID",
      before: {
        cashBalanceMinor: updatedAccount.cashBalanceMinor,
        reservedBalanceMinor: updatedAccount.reservedBalanceMinor - input.amountMinor
      },
      after: {
        cashBalanceMinor: updatedAccount.cashBalanceMinor,
        reservedBalanceMinor: updatedAccount.reservedBalanceMinor
      },
      description: "Label charge reserved",
      createdBy: input.createdBy ?? null
    }, session);

    return { reserved: true as const, reservation };
  });
}

export async function markReservationConsuming(input: ReservationTransitionInput) {
  return runTransactionWithRetry(async (session) => {
    const reservation = await transitionReservationStatus({
      ...input,
      from: ["ACTIVE"],
      to: "CONSUMING",
      timestampField: "consumingAt"
    }, session);

    if (!reservation) throw new Error("Illegal reservation transition.");
    return reservation;
  });
}

export async function convertReservation(input: ReservationTransitionInput) {
  const existingLedger = await findLedgerEntryByIdempotencyKey(input.idempotencyKey);
  if (existingLedger) return { converted: false as const, ledgerEntry: existingLedger };

  return runTransactionWithRetry(async (session) => {
    const reservation = await transitionReservationStatus({
      ...input,
      from: ["CONSUMING"],
      to: "CONVERTED",
      timestampField: "convertedAt"
    }, session);

    if (!reservation) throw new Error("Illegal reservation transition.");

    const updatedAccount = await PrepaidAccount.findOneAndUpdate(
      {
        businessAccountId: reservation.businessAccountId,
        currency: reservation.currency,
        status: "ACTIVE",
        reservedBalanceMinor: { $gte: reservation.amountMinor },
        cashBalanceMinor: { $gte: reservation.amountMinor }
      },
      {
        $inc: {
          reservedBalanceMinor: -reservation.amountMinor,
          cashBalanceMinor: -reservation.amountMinor,
          version: 1
        }
      },
      { returnDocument: "after", runValidators: true, session }
    ).exec();

    if (!updatedAccount) throw new Error("Reservation could not be converted.");

    const ledgerEntry = await createLedgerEntry({
      businessAccountId: reservation.businessAccountId,
      branchId: reservation.branchId,
      transactionType: "LABEL_CHARGE_COMPLETED",
      direction: "DEBIT",
      amountMinor: reservation.amountMinor,
      currency: reservation.currency,
      referenceType: "BALANCE_RESERVATION",
      referenceId: reservation._id as mongoose.Types.ObjectId,
      idempotencyKey: input.idempotencyKey,
      paymentSource: "CLIENT_PREPAID",
      before: {
        cashBalanceMinor: updatedAccount.cashBalanceMinor + reservation.amountMinor,
        reservedBalanceMinor: updatedAccount.reservedBalanceMinor + reservation.amountMinor
      },
      after: {
        cashBalanceMinor: updatedAccount.cashBalanceMinor,
        reservedBalanceMinor: updatedAccount.reservedBalanceMinor
      },
      description: "Label charge completed",
      createdBy: input.createdBy ?? null
    }, session);

    return { converted: true as const, ledgerEntry };
  });
}

async function releaseLike(
  input: ReservationTransitionInput & {
    from: BalanceReservationStatus[];
    to: "RELEASED" | "EXPIRED";
    timestampField: "releasedAt" | "expiredAt";
    transactionType: "LABEL_RESERVATION_RELEASED" | "LABEL_RESERVATION_EXPIRED";
    description: string;
  }
) {
  const existingLedger = await findLedgerEntryByIdempotencyKey(input.idempotencyKey);
  if (existingLedger) return { released: false as const, ledgerEntry: existingLedger };

  return runTransactionWithRetry(async (session) => {
    const reservation = await transitionReservationStatus(input, session);
    if (!reservation) throw new Error("Illegal reservation transition.");

    const updatedAccount = await PrepaidAccount.findOneAndUpdate(
      {
        businessAccountId: reservation.businessAccountId,
        currency: reservation.currency,
        status: "ACTIVE",
        reservedBalanceMinor: { $gte: reservation.amountMinor }
      },
      { $inc: { reservedBalanceMinor: -reservation.amountMinor, version: 1 } },
      { returnDocument: "after", runValidators: true, session }
    ).exec();

    if (!updatedAccount) throw new Error("Reservation could not be released.");

    const ledgerEntry = await createLedgerEntry({
      businessAccountId: reservation.businessAccountId,
      branchId: reservation.branchId,
      transactionType: input.transactionType,
      direction: "CREDIT",
      amountMinor: reservation.amountMinor,
      currency: reservation.currency,
      referenceType: "BALANCE_RESERVATION",
      referenceId: reservation._id as mongoose.Types.ObjectId,
      idempotencyKey: input.idempotencyKey,
      paymentSource: "CLIENT_PREPAID",
      before: {
        cashBalanceMinor: updatedAccount.cashBalanceMinor,
        reservedBalanceMinor: updatedAccount.reservedBalanceMinor + reservation.amountMinor
      },
      after: {
        cashBalanceMinor: updatedAccount.cashBalanceMinor,
        reservedBalanceMinor: updatedAccount.reservedBalanceMinor
      },
      description: input.description,
      createdBy: input.createdBy ?? null
    }, session);

    return { released: true as const, ledgerEntry };
  });
}

export async function releaseReservation(input: ReservationTransitionInput) {
  return releaseLike({
    ...input,
    from: ["ACTIVE", "CONSUMING"],
    to: "RELEASED",
    timestampField: "releasedAt",
    transactionType: "LABEL_RESERVATION_RELEASED",
    description: "Label reservation released"
  });
}

export async function expireReservation(input: ReservationTransitionInput) {
  return releaseLike({
    ...input,
    from: ["ACTIVE"],
    to: "EXPIRED",
    timestampField: "expiredAt",
    transactionType: "LABEL_RESERVATION_EXPIRED",
    description: "Label reservation expired"
  });
}

export async function markReservationReviewRequired(input: ReservationTransitionInput) {
  return runTransactionWithRetry(async (session) => {
    const reservation = await transitionReservationStatus({
      ...input,
      from: ["CONSUMING"],
      to: "REVIEW_REQUIRED",
      timestampField: "reviewRequiredAt"
    }, session);

    if (!reservation) throw new Error("Illegal reservation transition.");
    return reservation;
  });
}
