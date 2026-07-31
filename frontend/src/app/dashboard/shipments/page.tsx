"use client";

import { DashboardLoading } from "@/components/DashboardShell";
import ShipmentsListPage from "@/components/shipments/ShipmentsListPage";
import { useAdminUser } from "@/lib/useAdminUser";

export default function AdminShipmentsPage() {
  const { user, loading } = useAdminUser();
  if (loading || !user) return <DashboardLoading />;

  return (
    <ShipmentsListPage audience="admin" />
  );
}
