"use client";

import { DashboardLoading } from "@/components/DashboardShell";
import ShipmentsListPage from "@/components/shipments/ShipmentsListPage";
import { SHIPMENT_VIEW_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

export default function AdminShipmentsPage() {
  const { user, loading } = useAdminUser(SHIPMENT_VIEW_AREA);
  if (loading || !user) return <DashboardLoading />;

  return (
    <ShipmentsListPage audience="admin" />
  );
}
