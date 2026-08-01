"use client";

import { DashboardLoading } from "@/components/DashboardShell";
import ManifestsListPage from "@/components/shipments/ManifestsListPage";
import { OPERATIONS_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

export default function AdminShipmentManifestsPage() {
  const { user, loading } = useAdminUser(OPERATIONS_AREA);
  if (loading || !user) return <DashboardLoading />;

  return (
    <ManifestsListPage audience="admin" />
  );
}
