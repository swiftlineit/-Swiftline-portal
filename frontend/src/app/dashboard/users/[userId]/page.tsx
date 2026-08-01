"use client";

import { useParams } from "next/navigation";
import StaffDetail from "@/components/users/StaffDetail";
import { DashboardLoading } from "@/components/DashboardShell";
import { STAFF_DIRECTORY_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

export default function StaffDetailPage() {
  const { user, loading } = useAdminUser(STAFF_DIRECTORY_AREA);
  const params = useParams<{ userId: string }>();

  if (loading || !user) return <DashboardLoading />;

  // HR reads the directory; only an admin may change a record.
  return <StaffDetail userId={params.userId} canEdit={user.role === "admin"} viewerEmail={user.email} />;
}
