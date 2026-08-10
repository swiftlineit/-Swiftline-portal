"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FiArrowLeft } from "react-icons/fi";
import { ClientDashboardLoading } from "@/components/client/ClientDashboardShell";
import ClaimDetail from "@/components/claims/ClaimDetail";
import { useClientUser } from "@/lib/useClientUser";

export default function ClientClaimDetailPage() {
  const { user, loading } = useClientUser();
  const params = useParams<{ claimId: string }>();

  if (loading || !user) return <ClientDashboardLoading />;

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/client/claims"
        className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-900"
      >
        <FiArrowLeft />
        Claims
      </Link>
      <ClaimDetail audience="client" claimId={params.claimId} />
    </div>
  );
}
