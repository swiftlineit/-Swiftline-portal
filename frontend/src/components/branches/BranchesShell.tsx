"use client";

import { ReactNode } from "react";
import BusinessAccountsShell from "@/components/business-accounts/BusinessAccountsShell";
import { AuthenticatedUser } from "@/lib/useAdminUser";

export default function BranchesShell({
  user,
  children
}: {
  user: AuthenticatedUser;
  children: ReactNode;
}) {
  return <BusinessAccountsShell user={user}>{children}</BusinessAccountsShell>;
}

export function BranchesLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <p className="text-sm font-semibold text-slate-500">Loading branches...</p>
    </div>
  );
}
