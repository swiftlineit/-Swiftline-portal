"use client";

import DashboardShell, { DashboardLoading } from "@/components/DashboardShell";
import ManifestsListPage from "@/components/shipments/ManifestsListPage";
import { useAdminUser } from "@/lib/useAdminUser";

export default function AdminShipmentManifestsPage() {
  const { user, loading } = useAdminUser();
  if (loading || !user) return <DashboardLoading />;

  return (
    <DashboardShell user={user}>
      <ManifestsListPage audience="admin" />
    </DashboardShell>
  );
}
