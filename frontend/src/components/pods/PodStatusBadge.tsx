const colors: Record<string, string> = {
  ASSIGNED: "bg-blue-50 text-blue-700 ring-blue-200", ACCEPTED: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  OUT_FOR_DELIVERY: "bg-amber-50 text-amber-800 ring-amber-200", PARTIALLY_DELIVERED: "bg-orange-50 text-orange-800 ring-orange-200",
  DELIVERED: "bg-emerald-50 text-emerald-700 ring-emerald-200", DELIVERY_FAILED: "bg-red-50 text-red-700 ring-red-200",
  RETURN_IN_PROGRESS: "bg-purple-50 text-purple-700 ring-purple-200", RETURNED: "bg-slate-100 text-slate-700 ring-slate-300", CANCELLED: "bg-slate-100 text-slate-600 ring-slate-300",
  DRAFT: "bg-slate-100 text-slate-700 ring-slate-300", SUBMITTED: "bg-blue-50 text-blue-700 ring-blue-200", UNDER_REVIEW: "bg-amber-50 text-amber-800 ring-amber-200",
  ACTION_REQUIRED: "bg-red-50 text-red-700 ring-red-200", VERIFIED: "bg-emerald-50 text-emerald-700 ring-emerald-200", REJECTED: "bg-red-50 text-red-700 ring-red-200", SUPERSEDED: "bg-slate-100 text-slate-500 ring-slate-300"
};
export default function PodStatusBadge({ status }: { status: string }) { return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${colors[status] ?? colors.DRAFT}`}>{status.replace(/_/g, " ")}</span>; }
