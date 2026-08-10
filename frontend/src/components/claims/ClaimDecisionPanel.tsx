"use client";

import { useState } from "react";
import { FiAlertTriangle } from "react-icons/fi";
import {
  decideClaim,
  formatClaimAmount,
  toMinorUnits,
  type ClaimDecisionOutcome
} from "@/lib/claims";

/**
 * The decision controls.
 *
 * The approved amount is typed by a reviewer and never calculated. Declared
 * value is shown beside the request so the comparison is explicit, but nothing
 * here adjusts the figure on the client's behalf — no insurance, liability, or
 * salvage formula silently rewrites what they asked for.
 */

/** Structured reasons, so refusals can be reported on rather than free text. */
const reasonCodes = [
  { value: "EVIDENCE_SUPPORTS_CLAIM", label: "Evidence supports the claim" },
  { value: "LIMITED_TO_DECLARED_VALUE", label: "Limited to declared value" },
  { value: "PARTIAL_EVIDENCE", label: "Evidence supports part of the claim" },
  { value: "INSUFFICIENT_EVIDENCE", label: "Insufficient evidence" },
  { value: "NOT_CARRIER_LIABLE", label: "Loss not attributable to carriage" },
  { value: "PACKAGING_INADEQUATE", label: "Inadequate packaging" },
  { value: "FILED_OUT_OF_TIME", label: "Filed outside the permitted window" },
  { value: "DUPLICATE_COMPENSATION", label: "Already compensated elsewhere" },
  { value: "OTHER", label: "Other" }
];

export default function ClaimDecisionPanel({
  claimId,
  requestedAmountMinor,
  declaredValueMinor,
  onDecided
}: {
  claimId: string;
  requestedAmountMinor: number;
  declaredValueMinor: number;
  onDecided: () => void;
}) {
  const [outcome, setOutcome] = useState<ClaimDecisionOutcome>("FULLY_APPROVED");
  const [approved, setApproved] = useState("");
  const [reasonCode, setReasonCode] = useState(reasonCodes[0].value);
  const [customerExplanation, setCustomerExplanation] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // A full approval always equals the request and a rejection always approves
  // zero, so the amount box only appears where a reviewer actually has a choice.
  const approvedMinor =
    outcome === "FULLY_APPROVED"
      ? requestedAmountMinor
      : outcome === "REJECTED"
        ? 0
        : toMinorUnits(approved);

  const difference = requestedAmountMinor - declaredValueMinor;

  async function submit() {
    if (approvedMinor === null) {
      setError("Enter the amount being approved.");
      return;
    }
    if (customerExplanation.trim().length < 10) {
      setError("Write an explanation the customer will see.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await decideClaim(claimId, {
        outcome,
        approvedAmountMinor: approvedMinor,
        reasonCode,
        customerExplanation,
        internalNote: internalNote || undefined
      });
      onDecided();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The decision could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <header className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Decision</h2>
      </header>

      <div className="space-y-4 px-5 py-4">
        {/* Shown side by side and unconditionally: the reviewer should never
            have to go looking for what the shipment was declared at. */}
        <dl className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between py-1">
            <dt className="text-sm text-slate-600">Requested amount</dt>
            <dd className="text-sm font-semibold text-slate-900">
              {formatClaimAmount(requestedAmountMinor)}
            </dd>
          </div>
          <div className="flex items-center justify-between py-1">
            <dt className="text-sm text-slate-600">Shipment declared value</dt>
            <dd className="text-sm font-semibold text-slate-900">
              {formatClaimAmount(declaredValueMinor)}
            </dd>
          </div>
          {difference > 0 ? (
            <div className="mt-2 flex items-start gap-2 border-t border-slate-200 pt-2 text-sm text-amber-800">
              <FiAlertTriangle className="mt-0.5 shrink-0" />
              <span>
                <span className="font-semibold">{formatClaimAmount(difference)}</span> above the
                declared value.
              </span>
            </div>
          ) : null}
        </dl>

        <div className="grid gap-2 sm:grid-cols-3">
          {(
            [
              ["FULLY_APPROVED", "Approve in full", "border-emerald-300 bg-emerald-50 text-emerald-900"],
              ["PARTIALLY_APPROVED", "Approve in part", "border-amber-300 bg-amber-50 text-amber-900"],
              ["REJECTED", "Reject", "border-red-300 bg-red-50 text-red-900"]
            ] as const
          ).map(([value, label, active]) => (
            <button
              key={value}
              type="button"
              onClick={() => setOutcome(value)}
              className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                outcome === value ? active : "border-slate-200 text-slate-600 hover:border-slate-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {outcome === "PARTIALLY_APPROVED" ? (
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">Approved amount (₹)</span>
            <input
              type="text"
              inputMode="decimal"
              value={approved}
              onChange={(event) => setApproved(event.target.value)}
              placeholder="0.00"
              className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
            />
            <span className="mt-1 block text-xs text-slate-500">
              Must be more than zero and less than the requested amount. To approve more than was
              requested, ask the client to revise their claim.
            </span>
          </label>
        ) : (
          <p className="text-sm text-slate-600">
            Approving <span className="font-semibold">{formatClaimAmount(approvedMinor ?? 0)}</span>.
          </p>
        )}

        <label className="block">
          <span className="text-sm font-semibold text-slate-700">Reason</span>
          <select
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
          >
            {reasonCodes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-slate-700">
            Explanation for the customer
          </span>
          <textarea
            rows={4}
            value={customerExplanation}
            onChange={(event) => setCustomerExplanation(event.target.value)}
            placeholder="This is shown to the client, so explain the outcome in plain terms."
            className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-sm font-semibold text-slate-700">
            Internal note <span className="font-normal text-slate-400">(never shown to the client)</span>
          </span>
          <textarea
            rows={2}
            value={internalNote}
            onChange={(event) => setInternalNote(event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
          />
        </label>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="w-full rounded-xl bg-blue-900 px-5 py-3 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-40"
        >
          {busy ? "Recording..." : "Issue decision"}
        </button>
      </div>
    </section>
  );
}
