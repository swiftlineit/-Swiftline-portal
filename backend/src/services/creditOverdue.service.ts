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

export async function getCreditRestrictionState(input: {
  businessAccountId: mongoose.Types.ObjectId;
  gracePeriodDays: number;
  maxOverdueDays: number;
  now?: Date;
  session?: mongoose.ClientSession;
}) {
  const now = input.now ?? new Date();
  await CreditBillingStatement.updateMany(
    {
      businessAccountId: input.businessAccountId,
      outstandingAmountMinor: { $gt: 0 },
      dueAt: { $lt: now },
      status: { $in: ["ISSUED", "PARTIALLY_PAID"] }
    },
    { $set: { status: "OVERDUE" } },
    { session: input.session }
  ).exec();

  const oldest = await CreditBillingStatement.findOne({
    businessAccountId: input.businessAccountId,
    outstandingAmountMinor: { $gt: 0 },
    dueAt: { $lt: now },
    status: "OVERDUE"
  }).sort({ dueAt: 1 }).select("dueAt").session(input.session ?? null).lean().exec();

  return calculateCreditRestriction({
    oldestDueAt: oldest?.dueAt ?? null,
    gracePeriodDays: input.gracePeriodDays,
    maxOverdueDays: input.maxOverdueDays,
    now
  });
}
