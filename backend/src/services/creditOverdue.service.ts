import mongoose from "mongoose";
import { CreditBillingStatement } from "../models/creditBillingStatement.model.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export type CreditRestrictionLevel = "NONE" | "GRACE_WARNING" | "CREDIT_BLOCKED" | "ALL_BOOKINGS_BLOCKED";

export type CreditRestrictionState = {
  level: CreditRestrictionLevel;
  oldestDueAt: Date | null;
  overdueDays: number;
  message: string;
};

export function calculateCreditRestriction(input: {
  oldestDueAt?: Date | null;
  gracePeriodDays: number;
  maxOverdueDays: number;
  now?: Date;
}): CreditRestrictionState {
  const now = input.now ?? new Date();
  if (!input.oldestDueAt || input.oldestDueAt >= now) {
    return { level: "NONE", oldestDueAt: input.oldestDueAt ?? null, overdueDays: 0, message: "" };
  }

  const overdueDays = Math.max(Math.floor((now.getTime() - input.oldestDueAt.getTime()) / DAY_MS), 0);
  if (overdueDays <= input.gracePeriodDays) {
    return {
      level: "GRACE_WARNING",
      oldestDueAt: input.oldestDueAt,
      overdueDays,
      message: "A credit statement is overdue. Please pay it during the grace period to avoid credit restrictions."
    };
  }
  if (overdueDays <= input.maxOverdueDays) {
    return {
      level: "CREDIT_BLOCKED",
      oldestDueAt: input.oldestDueAt,
      overdueDays,
      message: "Credit usage is blocked because a billing statement is overdue. Customer Advance remains available."
    };
  }
  return {
    level: "ALL_BOOKINGS_BLOCKED",
    oldestDueAt: input.oldestDueAt,
    overdueDays,
    message: "Bookings and amendments are blocked because the maximum overdue period has been exceeded. Contact your assigned branch."
  };
}

// Eagerly flag every statement whose due date has passed as OVERDUE. Runs from a
// scheduled job so an account becomes restricted on time instead of only when a
// page happens to load and lazily triggers the same update.
export async function markOverdueCreditStatements(now = new Date()) {
  const result = await CreditBillingStatement.updateMany(
    {
      outstandingAmountMinor: { $gt: 0 },
      dueAt: { $lt: now },
      status: { $in: ["ISSUED", "PARTIALLY_PAID"] }
    },
    { $set: { status: "OVERDUE" } }
  ).exec();

  return { markedOverdue: result.modifiedCount };
}

export async function getCreditRestrictionState(input: {
  businessAccountId: mongoose.Types.ObjectId;
  gracePeriodDays: number;
  maxOverdueDays: number;
  now?: Date;
  session?: mongoose.ClientSession;
}) {
  const now = input.now ?? new Date();

  // Read-only. The oldest past-due unpaid statement determines the restriction
  // straight from its due date, so this is correct in real time even before the
  // scheduled job has persisted the OVERDUE status. Keeping it side-effect free
  // removes writes and write-amplification from the booking hot path.
  const oldest = await CreditBillingStatement.findOne({
    businessAccountId: input.businessAccountId,
    outstandingAmountMinor: { $gt: 0 },
    dueAt: { $lt: now },
    status: { $in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] }
  }).sort({ dueAt: 1 }).select("dueAt").session(input.session ?? null).lean().exec();

  return calculateCreditRestriction({
    oldestDueAt: oldest?.dueAt ?? null,
    gracePeriodDays: input.gracePeriodDays,
    maxOverdueDays: input.maxOverdueDays,
    now
  });
}
