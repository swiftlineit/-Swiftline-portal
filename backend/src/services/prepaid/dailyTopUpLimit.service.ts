import mongoose from "mongoose";
import { env } from "../../config/env.js";
import { PaymentTopUp, type PaymentTopUpStatus } from "../../models/paymentTopUp.model.js";

/**
 * Statuses whose money has reached, or is committed to reaching, Razorpay. A
 * refunded top-up still counts for the day: the funds did move, and discounting
 * them would let a top-up/refund loop reset the allowance.
 */
const settledStatuses: PaymentTopUpStatus[] = [
  "AUTHORIZED",
  "PROCESSING",
  "CAPTURED",
  "REFUND_PENDING",
  "REFUNDED"
];

/**
 * Statuses where the customer has an order but has not paid yet. They count only
 * while fresh, so a concurrent burst of checkouts cannot slip past the cap while
 * an abandoned tab does not hold the allowance hostage.
 */
const pendingStatuses: PaymentTopUpStatus[] = ["CREATED", "CHECKOUT_OPENED"];

/** Start and end of the IST calendar day containing `now`, as UTC instants. */
export function indiaDayRange(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const dateKey = `${part("year")}-${part("month")}-${part("day")}`;
  // IST is a fixed UTC+05:30 offset, so the day boundary needs no DST handling.
  const start = new Date(`${dateKey}T00:00:00.000+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { dateKey, start, end };
}

type UsageOptions = {
  businessAccountId: mongoose.Types.ObjectId;
  now?: Date;
  /**
   * When set, only top-ups created at or before this record are counted, so two
   * racing requests resolve deterministically: the earlier row wins.
   */
  upTo?: { createdAt: Date; id: mongoose.Types.ObjectId };
};

/**
 * What a business account has already committed to Razorpay today. Security
 * deposits are excluded: they are a one-off, admin-required payment pinned to an
 * exact amount, and are already exempt from the per-transaction bounds.
 */
export async function getDailyTopUpUsage(options: UsageOptions) {
  const now = options.now ?? new Date();
  const { start, end } = indiaDayRange(now);
  const freshAfter = new Date(now.getTime() - env.RAZORPAY_TOPUP_PENDING_TTL_MINUTES * 60 * 1000);

  const createdAt: Record<string, Date> = { $gte: start, $lt: end };
  if (options.upTo) createdAt.$lte = options.upTo.createdAt;

  const [totals] = await PaymentTopUp.aggregate<{ usedMinor: number }>([
    {
      $match: {
        businessAccountId: options.businessAccountId,
        purpose: "CUSTOMER_ADVANCE",
        createdAt,
        $or: [
          { status: { $in: settledStatuses } },
          { status: { $in: pendingStatuses }, createdAt: { $gte: freshAfter } }
        ]
      }
    },
    // Rows sharing the exact millisecond are separated by _id, so "created at or
    // before mine" is a total order and exactly one racing request wins.
    ...(options.upTo
      ? [{
        $match: {
          $or: [
            { createdAt: { $lt: options.upTo.createdAt } },
            { createdAt: options.upTo.createdAt, _id: { $lte: options.upTo.id } }
          ]
        }
      }]
      : []),
    { $group: { _id: null, usedMinor: { $sum: "$amountMinor" } } }
  ]).exec();

  const usedMinor = totals?.usedMinor ?? 0;
  const limitMinor = env.RAZORPAY_MAX_DAILY_TOPUP_MINOR;
  return {
    usedMinor,
    limitMinor,
    remainingMinor: Math.max(0, limitMinor - usedMinor),
    resetsAt: end
  };
}

export function formatMinorRupees(amountMinor: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(amountMinor / 100);
}

export function dailyLimitMessage(remainingMinor: number) {
  return remainingMinor > 0
    ? `This would exceed the ${formatMinorRupees(env.RAZORPAY_MAX_DAILY_TOPUP_MINOR)} daily top-up limit. `
      + `${formatMinorRupees(remainingMinor)} is still available today.`
    : `The ${formatMinorRupees(env.RAZORPAY_MAX_DAILY_TOPUP_MINOR)} daily top-up limit has been reached for this account. `
      + "Please try again after midnight IST.";
}
