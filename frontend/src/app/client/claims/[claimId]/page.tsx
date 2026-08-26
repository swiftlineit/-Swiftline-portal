"use client";

import { useParams } from "next/navigation";
import { ClientDashboardLoading } from "@/components/client/ClientDashboardShell";
import ClaimDetail from "@/components/claims/ClaimDetail";
import { useClientUser } from "@/lib/useClientUser";

export default function ClientClaimDetailPage() {
  const { user, loading } = useClientUser();
  const params = useParams<{ claimId: string }>();

  if (loading || !user) return <ClientDashboardLoading />;

  return (
    <div className="mx-auto max-w-5xl">
      <ClaimDetail audience="client" claimId={params.claimId} />
    </div>
  );
}
