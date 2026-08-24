import { formatDashboardDate } from "@/lib/dateFormat";
import { CreditAccount, formatCreditMoney } from "@/lib/creditAccounts";

/**
 * What a customer needs to be told about an outstanding balance.
 *
 * The restriction alert that existed before this only spoke once an account was
 * already blocked, and never said when the next step would land. Every message
 * here names four things: the amount, the date it was or is due, what is
 * blocked, and when the next escalation happens - so nobody is surprised by a
 * booking that stops working.
 *
 * Shared by the client dashboard and the staff views so both quote the same
 * dates from the same arithmetic.
 */
export type CreditPaymentStatusLevel =
  | "DUE_SOON"
  | "OVERDUE_GRACE"
  | "CREDIT_BLOCKED"
  | "ALL_BLOCKED";

export type CreditPaymentStatus = {
  level: CreditPaymentStatusLevel;
  tone: "warning" | "critical";
  heading: string;
  detail: string;
  /** Whether a booking can still be made right now, by any means. */
  canStillBook: boolean;
};

/** Matches the 3-day window the PAYMENT_DUE_SOON notification already uses. */
export const DUE_SOON_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(from: Date, days: number) {
  return new Date(from.getTime() + days * DAY_MS);
}

function daysBetween(from: Date, to: Date) {
  return Math.ceil((to.getTime() - from.getTime()) / DAY_MS);
}

export function getCreditPaymentStatus(
  account: CreditAccount | null,
  now: Date = new Date()
): CreditPaymentStatus | null {
  if (!account) return null;
  const billing = account.billing;
  if (!billing) return null;

  const money = (valueMinor?: number) => formatCreditMoney(valueMinor, account.currency);
  const restriction = account.restriction;
  const overdueMinor = billing.overdueAmountMinor ?? 0;

  if (restriction && restriction.level !== "NONE" && restriction.oldestDueAt) {
    const dueAt = new Date(restriction.oldestDueAt);
    // A statement blocks credit once it is more days overdue than the grace
    // period allows, so the first blocked day is grace + 1 after the due date.
    const creditBlocksAt = addDays(dueAt, (account.gracePeriodDays ?? 0) + 1);
    const allBlocksAt = addDays(dueAt, (account.maxOverdueDays ?? 0) + 1);
    const advanceMinor = account.availableAdvanceMinor ?? 0;

    if (restriction.level === "ALL_BOOKINGS_BLOCKED") {
      return {
        level: "ALL_BLOCKED",
        tone: "critical",
        canStillBook: false,
        heading: "Bookings and amendments are paused",
        detail: `${money(overdueMinor)} has been overdue since ${formatDashboardDate(dueAt)}. `
          + "Settle the balance or contact your assigned branch to restore the facility."
      };
    }

    if (restriction.level === "CREDIT_BLOCKED") {
      return {
        level: "CREDIT_BLOCKED",
        tone: "critical",
        canStillBook: advanceMinor > 0,
        heading: advanceMinor > 0 ? "Credit bookings are paused" : "Bookings are paused",
        detail: advanceMinor > 0
          ? `${money(overdueMinor)} has been overdue since ${formatDashboardDate(dueAt)}. `
            + `Your Customer Advance of ${money(advanceMinor)} can still be used, and all bookings `
            + `pause on ${formatDashboardDate(allBlocksAt)}.`
          : `${money(overdueMinor)} has been overdue since ${formatDashboardDate(dueAt)}. `
            + "No Customer Advance is available, so new bookings cannot be created until payment is received."
      };
    }

    // Grace period: late, but everything still works for now.
    return {
      level: "OVERDUE_GRACE",
      tone: "warning",
      canStillBook: true,
      heading: "Payment overdue",
      detail: `${money(overdueMinor)} was due on ${formatDashboardDate(dueAt)}. `
        + `Credit bookings will pause on ${formatDashboardDate(creditBlocksAt)} unless payment is received.`
    };
  }

  // Nothing late yet. Warn only once the next bill is close enough to act on.
  if (!billing.nextDueAt) return null;
  const nextDueAt = new Date(billing.nextDueAt);
  const daysUntilDue = daysBetween(now, nextDueAt);
  if (daysUntilDue > DUE_SOON_DAYS || daysUntilDue < 0) return null;

  return {
    level: "DUE_SOON",
    tone: "warning",
    canStillBook: true,
    heading: daysUntilDue <= 0
      ? "Payment due today"
      : `Payment due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}`,
    detail: `${money(billing.nextDueAmountMinor ?? 0)} is due on ${formatDashboardDate(nextDueAt)}. `
      + "Bookings continue as normal until then."
  };
}

/**
 * Accounts heading for a block but not there yet, for the staff task list.
 *
 * Counted separately from those already restricted: one is a customer to chase,
 * the other is a customer already stopped.
 */
export function countCreditAccountsAtRisk(accounts: CreditAccount[], now: Date = new Date()) {
  return accounts.filter((account) => {
    const status = getCreditPaymentStatus(account, now);
    return status?.level === "DUE_SOON" || status?.level === "OVERDUE_GRACE";
  }).length;
}
