import mongoose from "mongoose";
import { env } from "../config/env.js";
import { BalanceReservation } from "../models/balanceReservation.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { PrepaidAccount } from "../models/prepaidAccount.model.js";
import { PrepaidTransaction } from "../models/prepaidTransaction.model.js";

type AccountIssue = {
  accountId: string;
  businessAccountId: string;
  issues: string[];
};

async function run() {
  await mongoose.connect(env.MONGODB_URI, { family: 4 });

  const prepaidAccounts = await PrepaidAccount.find().sort({ businessAccountId: 1 }).lean();
  const issues: AccountIssue[] = [];
  let totalAdvanceMinor = 0;
  let totalReservedMinor = 0;
  let accountsWithLiveReservations = 0;

  for (const prepaidAccount of prepaidAccounts) {
    const [businessAccount, transactions, reservations] = await Promise.all([
      BusinessAccount.findById(prepaidAccount.businessAccountId).select({ accountId: 1 }).lean(),
      PrepaidTransaction.find({ businessAccountId: prepaidAccount.businessAccountId }).sort({ createdAt: 1, _id: 1 }).lean(),
      BalanceReservation.find({
        businessAccountId: prepaidAccount.businessAccountId,
        status: { $in: ["ACTIVE", "CONSUMING", "REVIEW_REQUIRED"] }
      }).lean()
    ]);

    const accountIssues: string[] = [];
    const liveReservedMinor = reservations.reduce((sum, reservation) => sum + reservation.amountMinor, 0);
    totalAdvanceMinor += prepaidAccount.cashBalanceMinor;
    totalReservedMinor += prepaidAccount.reservedBalanceMinor;
    if (reservations.length) accountsWithLiveReservations += 1;

    if (!businessAccount) accountIssues.push("Business account record is missing.");
    if (liveReservedMinor !== prepaidAccount.reservedBalanceMinor) {
      accountIssues.push(`Live reservations total ${liveReservedMinor}, stored reserved balance is ${prepaidAccount.reservedBalanceMinor}.`);
    }

    transactions.forEach((transaction, index) => {
      const previous = transactions[index - 1];
      if (previous && (
        previous.cashBalanceAfterMinor !== transaction.cashBalanceBeforeMinor
        || previous.reservedBalanceAfterMinor !== transaction.reservedBalanceBeforeMinor
      )) {
        accountIssues.push(`Ledger continuity breaks before transaction ${transaction._id.toString()}.`);
      }
    });

    const lastTransaction = transactions.at(-1);
    if (lastTransaction && (
      lastTransaction.cashBalanceAfterMinor !== prepaidAccount.cashBalanceMinor
      || lastTransaction.reservedBalanceAfterMinor !== prepaidAccount.reservedBalanceMinor
    )) {
      accountIssues.push("The latest ledger balances do not match the prepaid account balances.");
    }
    if (!lastTransaction && (prepaidAccount.cashBalanceMinor !== 0 || prepaidAccount.reservedBalanceMinor !== 0)) {
      accountIssues.push("A non-zero prepaid account has no ledger transactions.");
    }

    if (accountIssues.length) {
      issues.push({
        accountId: businessAccount?.accountId ?? "UNKNOWN",
        businessAccountId: prepaidAccount.businessAccountId.toString(),
        issues: accountIssues
      });
    }
  }

  console.log(JSON.stringify({
    mode: "DRY_RUN_READ_ONLY",
    generatedAt: new Date().toISOString(),
    summary: {
      prepaidAccounts: prepaidAccounts.length,
      proposedCustomerAdvanceMinor: totalAdvanceMinor,
      legacyReservedBalanceMinor: totalReservedMinor,
      accountsWithLiveReservations,
      accountsRequiringReview: issues.length
    },
    migrationRule: "cashBalanceMinor becomes customerAdvanceBalanceMinor; active reservations require reconciliation before cutover.",
    issues
  }, null, 2));
}

run()
  .catch((error: unknown) => {
    console.error("Credit migration dry-run failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
