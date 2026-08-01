"use client";

import AddStaffForm from "@/components/users/AddStaffForm";
import { DashboardLoading } from "@/components/DashboardShell";
import { STAFF_DIRECTORY_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

export default function AddStaffPage() {
  const { user, loading } = useAdminUser(STAFF_DIRECTORY_AREA);
  if (loading || !user) return <DashboardLoading />;

  // HR can add staff, but only an admin may create another admin.
  return <AddStaffForm canGrantAdmin={user.role === "admin"} />;
}
