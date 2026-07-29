"use client";

import { ClientDashboardLoading, ClientDashboardShell } from "@/components/client/ClientDashboardShell";
import ProfilePage from "@/components/profile/ProfilePage";
import { useClientUser } from "@/lib/useClientUser";

export default function ClientProfilePage() {
  const { user, loading } = useClientUser();
  if (loading || !user) return <ClientDashboardLoading />;

  return (
    <ClientDashboardShell user={user}>
      <ProfilePage />
    </ClientDashboardShell>
  );
}
