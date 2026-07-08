"use client";

import BusinessAccountForm from "@/components/business-accounts/BusinessAccountForm";
import BusinessAccountsShell, { BusinessAccountsLoading } from "@/components/business-accounts/BusinessAccountsShell";
import { useAdminUser } from "@/lib/useAdminUser";

export default function CreateBusinessAccountPage() {
  const { user, loading } = useAdminUser();

  if (loading || !user) return <BusinessAccountsLoading />;

  return (
    <BusinessAccountsShell user={user}>
      <BusinessAccountForm />
    </BusinessAccountsShell>
  );
}
