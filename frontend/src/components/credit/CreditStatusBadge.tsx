import type { CreditAccountStatus } from "@/lib/creditAccounts";

const tones: Record<CreditAccountStatus, string> = {
  NOT_REQUESTED: "border-slate-200 bg-slate-50 text-slate-600",
  PENDING_REVIEW: "border-amber-200 bg-amber-50 text-amber-700",
  APPROVED: "border-blue-200 bg-blue-50 text-blue-700",
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  ON_HOLD: "border-orange-200 bg-orange-50 text-orange-700",
  SUSPENDED: "border-red-200 bg-red-50 text-red-700",
  EXPIRED: "border-slate-300 bg-slate-100 text-slate-700",
  REJECTED: "border-red-200 bg-red-50 text-red-700",
  CLOSED: "border-slate-300 bg-slate-100 text-slate-700"
};

export default function CreditStatusBadge({ status }: { status: CreditAccountStatus }) {
  return <span className={`inline-flex border px-2.5 py-1 text-xs font-semibold ${tones[status]}`}>{status.replaceAll("_", " ")}</span>;
}
