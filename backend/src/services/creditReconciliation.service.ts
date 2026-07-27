import mongoose from "mongoose";
import { BalanceReservation } from "../models/balanceReservation.model.js";
import { BusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { CreditBillingStatement } from "../models/creditBillingStatement.model.js";

export type CreditReconciliationIssue = {
  businessAccountId: string;
  creditAccountId: string;
  issues: string[];
};

// Read-only integrity check for one credit account. It asserts the invariants
// that every money path is meant to preserve, so drift (from a bug or legacy
// data) is surfaced for a human to resolve with the write-off/adjust tools.
export async function reconcileCreditAccount(businessAccountId: mongoose.Types.ObjectId): Promise<CreditReconciliationIssue | null> {
  const account = await BusinessCreditAccount.findOne({ businessAccountId }).lean().exec();
  if (!account) return null;

  const issues: string[] = [];

  // 1. No balance may ever go negative.
  const nonNegativeFields: [string, number][] = [
    ["reservedCreditMinor", account.reservedCreditMinor],
    ["unbilledCreditMinor", account.unbilledCreditMinor],
    ["invoicedOutstandingMinor", account.invoicedOutstandingMinor],
    ["customerAdvanceBalanceMinor", account.customerAdvanceBalanceMinor],
    ["reservedAdvanceMinor", account.reservedAdvanceMinor]
  ];
  for (const [field, value] of nonNegativeFields) {
    if (value < 0) issues.push(`${field} is negative (${value}).`);
  }

  // 2. Invoiced outstanding must equal the sum of outstanding statement balances.
  const statements = await CreditBillingStatement.find({ businessAccountId })
    .select("outstandingAmountMinor")
    .lean()
    .exec();
  const statementOutstandingMinor = statements.reduce((total, statement) => total + statement.outstandingAmountMinor, 0);
  if (statementOutstandingMinor !== account.invoicedOutstandingMinor) {
    issues.push(`invoicedOutstandingMinor (${account.invoicedOutstandingMinor}) != sum of statement outstanding (${statementOutstandingMinor}).`);
  }

  // 3. Reserved balances must equal the sum of open reservations.
  const openReservations = await BalanceReservation.find({
    businessAccountId,
    status: { $in: ["ACTIVE", "CONSUMING", "REVIEW_REQUIRED"] }
  }).select("creditAmountMinor advanceAmountMinor").lean().exec();
  const reservedCreditMinor = openReservations.reduce((total, reservation) => total + reservation.creditAmountMinor, 0);
  const reservedAdvanceMinor = openReservations.reduce((total, reservation) => total + reservation.advanceAmountMinor, 0);
  if (reservedCreditMinor !== account.reservedCreditMinor) {
    issues.push(`reservedCreditMinor (${account.reservedCreditMinor}) != sum of open reservations (${reservedCreditMinor}).`);
  }
  if (reservedAdvanceMinor !== account.reservedAdvanceMinor) {
    issues.push(`reservedAdvanceMinor (${account.reservedAdvanceMinor}) != sum of open reservations (${reservedAdvanceMinor}).`);
  }

  if (!issues.length) return null;
  return { businessAccountId: String(businessAccountId), creditAccountId: String(account._id), issues };
}

// Reconcile every credit account that has ever held a balance and return the ones
// with drift. Read-only — it never corrects anything.
export async function reconcileAllCreditAccounts() {
  const accounts = await BusinessCreditAccount.find({
    status: { $nin: ["NOT_REQUESTED", "REJECTED"] }
  }).select("businessAccountId").lean().exec();

  const drifted: CreditReconciliationIssue[] = [];
  for (const account of accounts) {
    const result = await reconcileCreditAccount(account.businessAccountId);
    if (result) drifted.push(result);
  }

  return { scanned: accounts.length, drifted };
}
