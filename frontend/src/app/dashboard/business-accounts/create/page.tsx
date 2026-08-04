"use client";

import BusinessAccountForm from "@/components/business-accounts/BusinessAccountForm";
import { DashboardLoading } from "@/components/DashboardShell";
import { BUSINESS_ACCOUNT_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

export default function CreateBusinessAccountPage() {
  const { user, loading } = useAdminUser(BUSINESS_ACCOUNT_AREA);

  if (loading || !user) return <DashboardLoading />;

  return <BusinessAccountForm />;
}
