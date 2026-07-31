"use client";

import BusinessAccountForm from "@/components/business-accounts/BusinessAccountForm";
import { DashboardLoading } from "@/components/DashboardShell";
import { useAdminUser } from "@/lib/useAdminUser";

export default function CreateBusinessAccountPage() {
  const { user, loading } = useAdminUser();

  if (loading || !user) return <DashboardLoading />;

  return <BusinessAccountForm />;
}
