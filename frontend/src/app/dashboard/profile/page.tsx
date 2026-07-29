"use client";

import DashboardShell, { DashboardLoading } from "@/components/DashboardShell";
import ProfilePage from "@/components/profile/ProfilePage";
import { useAdminUser } from "@/lib/useAdminUser";

export default function AdminProfilePage() {
  const { user, loading } = useAdminUser();
  if (loading || !user) return <DashboardLoading />;

  return (
    <DashboardShell user={user}>
      <ProfilePage />
    </DashboardShell>
  );
}
