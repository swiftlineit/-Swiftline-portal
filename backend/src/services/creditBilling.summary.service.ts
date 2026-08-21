import mongoose from "mongoose";
import { CreditBillingStatement } from "../models/creditBillingStatement.model.js";
import { CreditPayment } from "../models/creditPayment.model.js";

/**
 * Amounts owed and dates due, gathered from statements and payments.
 *
 * Lives here rather than in one controller because both the client page and the
 * admin view show the same figures- and while it was inline in the client
 * controller, the admin view simply had no overdue card at all.
 */
export async function getCreditBillingSummary(businessAccountId: mongoose.Types.ObjectId, now = new Date()) {
  /**
   * A statement is overdue by its date, not only by its status: the status is
   * stamped by a nightly job, so reading status alone would under-report the
   * overdue total until that job next runs. Reading the date catches both.
   */
  const unsettled = { $nin: ["PAID", "VOID"] as const };
  const [overdueStatements, nextStatement, lastPayment] = await Promise.all([
    CreditBillingStatement.find({ businessAccountId, status: unsettled, dueAt: { $lt: now } })
      .select("outstandingAmountMinor totalAmountMinor dueAt").lean().exec(),
    CreditBillingStatement.findOne({ businessAccountId, status: unsettled, dueAt: { $gte: now } })
      .sort({ dueAt: 1 }).select("dueAt outstandingAmountMinor").lean().exec(),
    CreditPayment.findOne({ businessAccountId, status: "VERIFIED" })
      .sort({ verifiedAt: -1, createdAt: -1 }).select("amountMinor verifiedAt createdAt").lean().exec()
  ]);

  return {
    // What is actually still owed on late statements, not their original
    // totals: a statement half paid is half overdue, not fully.
    overdueAmountMinor: overdueStatements.reduce(
      (sum, statement) => sum + (statement.outstandingAmountMinor ?? statement.totalAmountMinor ?? 0),
      0
    ),
    overdueStatementCount: overdueStatements.length,
    nextDueAt: nextStatement?.dueAt ?? null,
    nextDueAmountMinor: nextStatement?.outstandingAmountMinor ?? null,
    lastPayment: lastPayment
      ? { amountMinor: lastPayment.amountMinor, at: lastPayment.verifiedAt ?? lastPayment.createdAt }
      : null
  };
}
