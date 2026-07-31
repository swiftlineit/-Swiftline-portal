"use client";

import { DashboardLoading } from "@/components/DashboardShell";
import ShipmentTrackingPage from "@/components/shipments/ShipmentTrackingPage";
import { useAdminUser } from "@/lib/useAdminUser";

export default function AdminTrackingPage() {
  const { user, loading } = useAdminUser();
  if (loading || !user) return <DashboardLoading />;
  return (
    <ShipmentTrackingPage
      mode="admin"
      title="Shipment Tracking"
      description="Search every Swiftline shipment using its Swiftline, carrier, or parcel tracking number."
    />
  );
}
