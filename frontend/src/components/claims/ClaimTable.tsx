import Link from "next/link";
import { formatDashboardDateTime } from "@/lib/dateFormat";
import { claimLabel, formatClaimAmount, type Claim } from "@/lib/claims";
import { ClaimStatusBadge } from "./ClaimStatusBadge";

export default function ClaimTable({
  claims,
  loading,
  basePath = "/client/claims"
}: {
  claims: Claim[];
  loading: boolean;
  basePath?: string;
}) {
  if (loading)
    return (
      <div className="border border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">
        Loading claims...
      </div>
    );

  if (!claims.length)
    return (
      <div className="border border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="font-semibold text-slate-900">No claims yet</p>
        <p className="mt-1 text-sm text-slate-500">
          Claims you raise for lost, damaged, or short shipments will appear here.
        </p>
      </div>
    );

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-100 text-xs font-semibold uppercase text-slate-600">
          <tr>
            <th className="px-4 py-3">Claim</th>
            <th className="px-4 py-3">Tracking</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Claimed</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Updated</th>
            <th className="px-4 py-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {claims.map((claim) => (
            <tr key={claim.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-semibold text-slate-900">
                {/* A draft has no number until it is submitted, so it is named
                    by what it is rather than shown as blank. */}
                {claim.claimNumber ?? <span className="text-slate-400">Draft</span>}
              </td>
              <td className="px-4 py-3 text-slate-600">
                {claim.shipmentSnapshot?.trackingNumber || "—"}
              </td>
              <td className="px-4 py-3 text-slate-600">{claimLabel(claim.category)}</td>
              <td className="px-4 py-3 text-slate-900">
                {/* Undefined rather than null when the member cannot see amounts. */}
                {claim.requestedAmountMinor === undefined
                  ? "—"
                  : formatClaimAmount(claim.requestedAmountMinor)}
              </td>
              <td className="px-4 py-3">
                <ClaimStatusBadge status={claim.status} />
              </td>
              <td className="px-4 py-3 text-slate-500">
                {formatDashboardDateTime(claim.updatedAt)}
              </td>
              <td className="px-4 py-3 text-right">
                {/* A draft has nothing to view — its answers are only half
                    entered. It reopens in the wizard instead. */}
                {claim.status === "DRAFT" && basePath === "/client/claims" ? (
                  <Link
                    href={`/client/claims/new?claimId=${claim.id}`}
                    className="font-semibold text-blue-900 hover:underline"
                  >
                    Continue
                  </Link>
                ) : (
                  <Link
                    href={`${basePath}/${claim.id}`}
                    className="font-semibold text-blue-900 hover:underline"
                  >
                    View
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
