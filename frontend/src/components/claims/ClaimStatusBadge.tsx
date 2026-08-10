import { claimLabel, type ClaimDecisionOutcome, type ClaimStatus } from "@/lib/claims";

/**
 * Colour carries meaning here, so the tones are grouped by what the client
 * should do rather than by where the claim sits in the pipeline:
 * blue is with us, amber is waiting on you, green is resolved in your favour.
 */
const statusTones: Record<ClaimStatus, string> = {
  DRAFT: "border-slate-300 bg-slate-100 text-slate-700",
  SUBMITTED: "border-blue-200 bg-blue-50 text-blue-800",
  DOCUMENTS_REQUIRED: "border-amber-200 bg-amber-50 text-amber-800",
  UNDER_REVIEW: "border-blue-200 bg-blue-50 text-blue-800",
  NEEDS_INFORMATION: "border-amber-200 bg-amber-50 text-amber-800",
  AWAITING_THIRD_PARTY: "border-violet-200 bg-violet-50 text-violet-800",
  PENDING_APPROVAL: "border-blue-200 bg-blue-50 text-blue-800",
  DECIDED: "border-indigo-200 bg-indigo-50 text-indigo-800",
  SETTLEMENT_PENDING: "border-teal-200 bg-teal-50 text-teal-800",
  SETTLED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  CLOSED: "border-slate-300 bg-slate-100 text-slate-700",
  WITHDRAWN: "border-slate-300 bg-slate-100 text-slate-600"
};

const outcomeText: Record<ClaimDecisionOutcome, string> = {
  FULLY_APPROVED: "text-emerald-700",
  PARTIALLY_APPROVED: "text-amber-700",
  REJECTED: "text-red-700"
};

export function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  return (
    <span
      className={`inline-flex rounded-4xl border px-2.5 py-1 text-xs font-semibold uppercase ${statusTones[status]}`}
    >
      {claimLabel(status)}
    </span>
  );
}

/**
 * The decision outcome, as supporting text rather than a second pill.
 *
 * Status and outcome answer different questions — where the claim is now, and
 * what was decided. But two equal-weight badges side by side read as two
 * competing statuses: "Settlement pending" next to "Fully approved" looks like a
 * contradiction when it is really a sequence — approved, now awaiting payment.
 *
 * One pill for where it is, one line of text for what was decided.
 */
export function ClaimOutcomeNote({ outcome }: { outcome: ClaimDecisionOutcome }) {
  return (
    <span className={`text-sm font-semibold ${outcomeText[outcome]}`}>{claimLabel(outcome)}</span>
  );
}
