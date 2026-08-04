"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import BusinessAccountForm from "@/components/business-accounts/BusinessAccountForm";
import { DashboardLoading } from "@/components/DashboardShell";
import { BusinessAccount, getBusinessAccount } from "@/lib/businessAccounts";
import { BUSINESS_ACCOUNT_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

export default function EditBusinessAccountPage() {
  const params = useParams<{ accountId: string }>();
  const { user, loading } = useAdminUser(BUSINESS_ACCOUNT_AREA);
  const [account, setAccount] = useState<BusinessAccount | null>(null);
  const [error, setError] = useState("");
  const [accountLoading, setAccountLoading] = useState(true);

  useEffect(() => {
    if (!user || !params.accountId) return;

    async function loadAccount() {
      setAccountLoading(true);
      setError("");

      try {
        const data = await getBusinessAccount(params.accountId);
        setAccount(data.account);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load business account.");
      } finally {
        setAccountLoading(false);
      }
    }

    void loadAccount();
  }, [params.accountId, user]);

  if (loading || !user || accountLoading) return <DashboardLoading />;

  return error || !account ? (
    <div className="border border-red-200 bg-red-50 p-5">
      <p className="text-sm font-semibold text-red-700">{error || "Business account not found."}</p>
      <Link href="/dashboard/business-accounts" className="mt-4 inline-block text-sm font-semibold text-blue-900">
        Back to Business Accounts
      </Link>
    </div>
  ) : (
    <BusinessAccountForm account={account} />
  );
}
