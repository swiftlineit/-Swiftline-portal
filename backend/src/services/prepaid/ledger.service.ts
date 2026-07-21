import mongoose, { type ClientSession } from "mongoose";
import {
  PrepaidTransaction,
  type PrepaidTransactionDirection,
  type PrepaidTransactionReferenceType,
  type PrepaidTransactionType
} from "../../models/prepaidTransaction.model.js";
import type { PaymentSource, PrepaidCurrency } from "../../models/financialTypes.js";

export type LedgerBalanceSnapshot = {
  cashBalanceMinor: number;
  reservedBalanceMinor: number;
};

export type LedgerEntryInput = {
  businessAccountId: mongoose.Types.ObjectId;
  branchId?: mongoose.Types.ObjectId | null;
  transactionType: PrepaidTransactionType;
  direction: PrepaidTransactionDirection;
  amountMinor: number;
  currency: PrepaidCurrency;
  referenceType: PrepaidTransactionReferenceType;
  referenceId: mongoose.Types.ObjectId;
  idempotencyKey: string;
  paymentSource: PaymentSource;
  before: LedgerBalanceSnapshot;
  after: LedgerBalanceSnapshot;
  description?: string;
  createdBy?: mongoose.Types.ObjectId | null;
};

export async function findLedgerEntryByIdempotencyKey(idempotencyKey: string, session?: ClientSession) {
  return PrepaidTransaction.findOne({ idempotencyKey }).session(session ?? null).exec();
}

export async function createLedgerEntry(input: LedgerEntryInput, session: ClientSession) {
  const [transaction] = await PrepaidTransaction.create([{
    businessAccountId: input.businessAccountId,
    branchId: input.branchId ?? null,
    transactionType: input.transactionType,
    direction: input.direction,
    amountMinor: input.amountMinor,
    currency: input.currency,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    idempotencyKey: input.idempotencyKey,
    paymentSource: input.paymentSource,
    cashBalanceBeforeMinor: input.before.cashBalanceMinor,
    cashBalanceAfterMinor: input.after.cashBalanceMinor,
    reservedBalanceBeforeMinor: input.before.reservedBalanceMinor,
    reservedBalanceAfterMinor: input.after.reservedBalanceMinor,
    description: input.description ?? "",
    createdBy: input.createdBy ?? null
  }], { session });

  return transaction;
}
