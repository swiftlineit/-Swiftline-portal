"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FiArrowLeft } from "react-icons/fi";
import { DashboardLoading } from "@/components/DashboardShell";
import ClaimReviewWorkspace from "@/components/claims/ClaimReviewWorkspace";
import { CLAIMS_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

export default function StaffClaimReviewPage() {
  const { user, loading } = useAdminUser(CLAIMS_AREA);
  const params = useParams<{ claimId: string }>();

  if (loading || !user) return <DashboardLoading />;

  return (
    <div className="mx-auto max-w-[1600px]">
      <Link
        href="/dashboard/claims"
        className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-900"
      >
        <FiArrowLeft />
        Claims
      </Link>
      {/* The role drives which controls render; the server enforces the same
          matrix regardless of what the UI chooses to show. */}
      <ClaimReviewWorkspace claimId={params.claimId} role={user.role} />
    </div>
  );
}
