"use client";

import { ClientDashboardLoading, ClientDashboardShell } from "@/components/client/ClientDashboardShell";
import ShipmentsListPage from "@/components/shipments/ShipmentsListPage";
import { useClientUser } from "@/lib/useClientUser";

export default function ClientShipmentsPage() {
  const { user, loading } = useClientUser();
  if (loading || !user) return <ClientDashboardLoading />;

  return (
    <ClientDashboardShell user={user}>
      <ShipmentsListPage audience="client" />
    </ClientDashboardShell>
  );
}
