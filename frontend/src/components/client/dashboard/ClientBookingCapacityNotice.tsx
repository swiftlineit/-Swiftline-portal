"use client";

import Link from "next/link";
import { FiArrowRight, FiCreditCard, FiInfo } from "react-icons/fi";
import type { ClientPrepaidAccount } from "@/lib/clientDashboard";
import type { CreditAccount, CreditPermission } from "@/lib/creditAccounts";

// A newly created business account has neither an approved credit facility nor a
// Customer Advance balance, so it cannot fund a booking yet. These are the credit
// statuses where no capacity exists and the customer can still act on it.
const NO_CAPACITY_STATUSES = new Set(["NOT_REQUESTED", "REJECTED"]);
const AWAITING_REVIEW_STATUSES = new Set(["PENDING_REVIEW", "APPROVED"]);

export default function ClientBookingCapacityNotice({
  credit,
  permissions,
  wallet
}: {
  credit: CreditAccount | null;
  permissions: CreditPermission[];
  wallet?: ClientPrepaidAccount;
}) {
  // Credit is still loading, or the section failed to load- say nothing rather
  // than warn about capacity we could not actually confirm.
  if (!credit) return null;

  const advanceBalanceMinor = wallet?.availableBalanceMinor ?? credit.availableAdvanceMinor ?? 0;
  const hasAdvance = advanceBalanceMinor > 0;
  const awaitingReview = AWAITING_REVIEW_STATUSES.has(credit.status);
  const noCredit = NO_CAPACITY_STATUSES.has(credit.status) || awaitingReview;
  const canRequestCredit = permissions.includes("requestCredit");

  /**
   * A live facility running out of room.
   *
   * The notice below only ever covered accounts with no capacity at all, so a
   * customer whose limit was nearly spent saw nothing here- they found out when
   * a booking failed. This is the same warning the credit page shows, surfaced
   * where they actually start their day.
   */
  if (credit.status === "ACTIVE") {
    const availableCreditMinor = credit.availableCreditMinor ?? 0;
    if (!credit.warningActive && availableCreditMinor > 0) return null;

    return (
      <section role="status" className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-200 text-amber-900">
              <FiInfo aria-hidden="true" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-900">
                {availableCreditMinor <= 0
                  ? "You have used your full credit limit"
                  : "Your credit limit is running low"}
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-700">
                {availableCreditMinor <= 0
                  ? "New bookings need available credit or a Customer Advance balance. Ask for a higher limit, or add an advance to keep shipping."
                  : "You are close to your approved credit limit. Request a higher limit now so your bookings are not interrupted."}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
            {canRequestCredit ? (
              <Link
                href="/client/credit#credit-summary"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-4xl bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800"
              >
                Request More Credit
                <FiArrowRight aria-hidden="true" />
              </Link>
            ) : null}
            <Link
              href="/client/payments"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-4xl border border-slate-300 bg-white px-4 text-sm font-semibold text-blue-900 hover:border-blue-300"
            >
              <FiCreditCard aria-hidden="true" />
              Add Customer Advance
            </Link>
          </div>
        </div>
      </section>
    );
  }

  // Either an active facility or a funded advance means bookings can proceed.
  if (!noCredit || hasAdvance) return null;

  return (
    <section
      role="status"
      className="rounded-2xl border border-amber-300 bg-amber-50 p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-200 text-amber-900">
            <FiInfo aria-hidden="true" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">
              {awaitingReview
                ? "Your credit request is under review"
                : "Set up billing to start booking shipments"}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-700">
              {awaitingReview
                ? "Our finance team is reviewing your credit request. Until it is approved, you can start booking straight away by adding a Customer Advance to your account."
                : "Your business account does not have an approved credit limit or a Customer Advance balance yet. Shipment bookings need one of the two, so please request a credit limit or add an advance to continue."}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
          {canRequestCredit && !awaitingReview ? (
            <Link
              href="/client/credit"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-4xl bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800"
            >
              Request Credit
              <FiArrowRight aria-hidden="true" />
            </Link>
          ) : null}
          <Link
            href="/client/payments"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-4xl border border-slate-300 bg-white px-4 text-sm font-semibold text-blue-900 hover:border-blue-300"
          >
            <FiCreditCard aria-hidden="true" />
            Add Customer Advance
          </Link>
        </div>
      </div>
    </section>
  );
}
