"use client";

import { DashboardLoading } from "@/components/DashboardShell";
import ManifestsListPage from "@/components/shipments/ManifestsListPage";
import { useAdminUser } from "@/lib/useAdminUser";

export default function AdminShipmentManifestsPage() {
  const { user, loading } = useAdminUser();
  if (loading || !user) return <DashboardLoading />;

  return (
    <ManifestsListPage audience="admin" />
  );
}
