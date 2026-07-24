"use client";

import BusinessAccountForm from "@/components/business-accounts/BusinessAccountForm";
import DashboardShell, { DashboardLoading } from "@/components/DashboardShell";
import { useAdminUser } from "@/lib/useAdminUser";

export default function CreateBusinessAccountPage() {
  const { user, loading } = useAdminUser();

  if (loading || !user) return <DashboardLoading />;

  return (
    <DashboardShell user={user}>
      <BusinessAccountForm />
    </DashboardShell>
  );
}
