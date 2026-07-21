"use client";

import { ClientDashboardLoading, ClientDashboardShell } from "@/components/client/ClientDashboardShell";
import ShipmentTrackingPage from "@/components/shipments/ShipmentTrackingPage";
import { useClientUser } from "@/lib/useClientUser";

export default function ClientTrackingPage() {
  const { user, loading } = useClientUser();
  if (loading || !user) return <ClientDashboardLoading />;
  return (
    <ClientDashboardShell user={user}>
      <ShipmentTrackingPage
        mode="client"
        title="Track Shipment"
        description="Search shipments available to your business account using a Swiftline, carrier, or parcel tracking number."
      />
    </ClientDashboardShell>
  );
}
