"use client";

import { DashboardLoading } from "@/components/DashboardShell";
import ProfilePage from "@/components/profile/ProfilePage";
import { ALL_STAFF_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

export default function AdminProfilePage() {
  const { user, loading } = useAdminUser(ALL_STAFF_AREA);
  if (loading || !user) return <DashboardLoading />;

  return <ProfilePage />;
}
