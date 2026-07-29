"use client";

import { ClientDashboardLoading, ClientDashboardShell } from "@/components/client/ClientDashboardShell";
import ManifestsListPage from "@/components/shipments/ManifestsListPage";
import { useClientUser } from "@/lib/useClientUser";

export default function ClientManifestsPage() {
  const { user, loading } = useClientUser();
  if (loading || !user) return <ClientDashboardLoading />;

  return (
    <ClientDashboardShell user={user}>
      <ManifestsListPage audience="client" />
    </ClientDashboardShell>
  );
}
