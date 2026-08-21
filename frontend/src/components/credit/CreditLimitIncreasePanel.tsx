"use client";

import { FormEvent, useEffect, useState } from "react";
import { FiClock, FiTrendingUp } from "react-icons/fi";
import { toast } from "react-toastify";
import {
  CreditAccount,
  CreditLimitIncreaseRequest,
  formatCreditMoney,
  getCreditLimitIncrease,
  MAX_CREDIT_LIMIT_LABEL,
  MAX_CREDIT_LIMIT_RUPEES,
  requestCreditLimitIncrease
} from "@/lib/creditAccounts";

/**
 * Asking for a higher credit limit, shown where the customer runs out of it.
 *
 * Placed on the credit summary rather than in settings: a customer only wants a
 * higher limit at the moment their bookings start failing, and a form they have
 * to go looking for is one nobody fills in.
 *
 * The facility is untouched while a request waits. The existing limit keeps
 * working, so asking never costs the customer the credit they already have.
 */
export default function CreditLimitIncreasePanel({
  account,
  canRequest
}: {
  account: CreditAccount;
  canRequest: boolean;
}) {
  const [pending, setPending] = useState<CreditLimitIncreaseRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [amountRupees, setAmountRupees] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const businessAccountId = account.businessAccountId;

  useEffect(() => {
    let active = true;
    getCreditLimitIncrease(businessAccountId)
      .then((result) => { if (active) setPending(result.request); })
      // A failure here should not break the credit page around it.
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [businessAccountId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const requestedLimitMinor = Math.round(Number(amountRupees) * 100);
    if (!Number.isInteger(requestedLimitMinor) || requestedLimitMinor <= 0) {
      toast.error("Enter the credit limit you need.");
      return;
    }
    if (Number(amountRupees) > MAX_CREDIT_LIMIT_RUPEES) {
      toast.error(`Requested credit limit cannot exceed ${MAX_CREDIT_LIMIT_LABEL}.`);
      return;
    }
    if (reason.trim().length < 10) {
      toast.error("Tell us briefly why a higher limit is needed.");
      return;
    }

    setBusy(true);
    try {
      const result = await requestCreditLimitIncrease({ businessAccountId, requestedLimitMinor, reason });
      toast.success(result.message);
      setPending(result.request);
      setOpen(false);
      setAmountRupees("");
      setReason("");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "The request could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  // Only a live facility can be increased, and only a member allowed to ask.
  if (loading || account.status !== "ACTIVE" || !canRequest) return null;

  if (pending) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <FiClock className="shrink-0" aria-hidden="true" />
        <span className="font-semibold">
          Increase to {formatCreditMoney(pending.requestedLimitMinor, account.currency)} under review
        </span>
        <span className="text-blue-700">
          · your current limit keeps working in the meantime
        </span>
      </div>
    );
  }

  // Surfaced once the account is close to its ceiling, or already restricted by it.
  const nearLimit = account.warningActive
    || (account.availableCreditMinor !== undefined && account.availableCreditMinor <= 0);
  if (!nearLimit && !open) return null;

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
      {open ? (
        <form onSubmit={submit} className="space-y-3">
          <p className="font-semibold text-amber-900">Request a higher credit limit</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-amber-800">
                New limit (INR)
              </span>
              <input
                type="number"
                min="1"
                max={MAX_CREDIT_LIMIT_RUPEES}
                step="0.01"
                value={amountRupees}
                onChange={(event) => setAmountRupees(event.target.value)}
                placeholder={String((account.approvedCreditLimitMinor ?? 0) / 100)}
                className="h-10 w-full rounded-lg border border-amber-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-amber-500"
              />
              <span className="mt-1 block text-xs text-amber-700">
                Currently {formatCreditMoney(account.approvedCreditLimitMinor, account.currency)} · maximum {MAX_CREDIT_LIMIT_LABEL}
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-amber-800">
                Why do you need it?
              </span>
              <textarea
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. shipment volume has grown this quarter"
                className="w-full resize-none rounded-lg border border-amber-300 bg-white p-2.5 text-sm text-slate-900 outline-none focus:border-amber-500"
              />
            </label>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="h-9 rounded-lg border border-amber-300 px-4 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="h-9 rounded-lg bg-blue-900 px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Submitting..." : "Submit request"}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <FiTrendingUp className="shrink-0 text-amber-700" aria-hidden="true" />
          <span className="font-semibold text-amber-900">
            {account.availableCreditMinor === 0
              ? "You have used your full credit limit."
              : "You are close to your credit limit."}
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="h-9 rounded-lg bg-blue-900 px-4 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Request a higher limit
          </button>
        </div>
      )}
    </div>
  );
}
