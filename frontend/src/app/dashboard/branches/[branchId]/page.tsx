"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import BranchesShell, { BranchesLoading } from "@/components/branches/BranchesShell";
import { Branch, formatBranchLabel, getBranch } from "@/lib/branches";
import { BusinessAccount, listBusinessAccounts } from "@/lib/businessAccounts";
import { useAdminUser } from "@/lib/useAdminUser";

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value || "Not set"}</p>
    </div>
  );
}

function formatValues(values: string[]) {
  return values.length ? values.map(formatBranchLabel).join(", ") : "Not set";
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ");
}

function formatDeposit(account: BusinessAccount) {
  if (account.status === "deposit_required") return "Required";
  if (account.status === "deposit_received") return "Received";
  return "Not set";
}

function formatKycStatus(account: BusinessAccount) {
  return account.kycReview?.overallStatus ? formatStatus(account.kycReview.overallStatus) : "null";
}

function getKycReason(account: BusinessAccount) {
  return Object.values(account.kycReview?.checks ?? {}).find((check) => check?.note)?.note ?? "";
}

export default function BranchDetailPage() {
  const params = useParams<{ branchId: string }>();
  const { user, loading } = useAdminUser();
  const [branch, setBranch] = useState<Branch | null>(null);
  const [linkedAccounts, setLinkedAccounts] = useState<BusinessAccount[]>([]);
  const [branchLoading, setBranchLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user || !params.branchId) return;

    async function loadBranch() {
      setBranchLoading(true);
      setError("");

      try {
        const [branchData, accountsData] = await Promise.all([
          getBranch(params.branchId),
          listBusinessAccounts("", params.branchId)
        ]);
        setBranch(branchData.branch);
        setLinkedAccounts(accountsData.accounts);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load branch.");
      } finally {
        setBranchLoading(false);
      }
    }

    void loadBranch();
  }, [params.branchId, user]);

  if (loading || !user) return <BranchesLoading />;

  return (
    <BranchesShell user={user}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">{branch?.name ?? "Branch Details"}</h1>
          <p className="mt-1 text-sm text-slate-500">{branch?.code ?? "Review branch profile and operating setup."}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {branch ? (
            <Link href={`/dashboard/branches/${branch._id}/edit`} className="bg-blue-900 px-4 py-2 text-sm font-semibold text-white">
              Edit Branch
            </Link>
          ) : null}
          <Link href="/dashboard/branches" className="border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
            Back to Branches
          </Link>
        </div>
      </div>

      {error ? <div className="mb-4 border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

      {branchLoading ? (
        <div className="border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">Loading branch...</div>
      ) : branch ? (
        <div className="space-y-6">
          <section className="border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-950">Basic Details</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <DetailRow label="Branch Name" value={branch.name} />
              <DetailRow label="Branch Code" value={branch.code} />
              <DetailRow label="Status" value={formatBranchLabel(branch.status)} />
              <DetailRow label="Opening Date" value={branch.openingDate ? new Date(branch.openingDate).toLocaleDateString() : ""} />
              <DetailRow label="Base Currency" value={branch.baseCurrency} />
              <DetailRow label="Created By" value={branch.createdBy?.name || branch.createdBy?.email || ""} />
              <div className="md:col-span-3">
                <DetailRow label="Description" value={branch.description} />
              </div>
            </div>
          </section>

          <section className="border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-950">Address and Contact</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <DetailRow label="Country" value={branch.address.countryName || branch.address.countryCode} />
              <DetailRow label="City" value={branch.address.city} />
              <DetailRow label="Postal Code" value={branch.address.postalCode} />
              <DetailRow label="Email" value={branch.contact.email} />
              <DetailRow label="Phone" value={branch.contact.phone} />
              <div className="md:col-span-3">
                <DetailRow label="Full Address" value={branch.address.address} />
              </div>
            </div>
          </section>

          <section className="border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-950">Operations and Settings</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <DetailRow label="Supported Services" value={formatValues(branch.operations.supportedServices)} />
              <DetailRow label="Shipment Coverage" value={formatValues(branch.operations.shipmentCoverage)} />
              <DetailRow label="Operating Countries" value={branch.operations.operatingCountries.join(", ")} />
              <DetailRow label="Working Days" value={formatValues(branch.operations.workingDays)} />
            </div>
          </section>

          <section className="border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-950">Linked Accounts</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-100 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Company</th>
                    <th className="px-4 py-3">Credit</th>
                    <th className="px-4 py-3">Outstanding</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Deposit</th>
                    <th className="px-4 py-3">KYC</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {linkedAccounts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        No accounts linked to this branch yet.
                      </td>
                    </tr>
                  ) : linkedAccounts.map((account) => (
                    <tr key={account.accountId} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-950">{account.company.companyName}</p>
                        <p className="mt-1 text-xs font-semibold text-blue-900">{account.accountId}</p>
                        <p className="mt-1 text-xs text-slate-500">{account.contact.firstName} {account.contact.lastName}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-500">null</td>
                      <td className="px-4 py-3 text-slate-500">Not available</td>
                      <td className="px-4 py-3 capitalize">{formatStatus(account.status)}</td>
                      <td className="px-4 py-3">{formatDeposit(account)}</td>
                      <td className="px-4 py-3">
                        <p className="capitalize text-slate-700">{formatKycStatus(account)}</p>
                        {account.kycReview?.overallStatus === "additional_information_required" && getKycReason(account) ? (
                          <p className="mt-1 max-w-40 text-xs font-semibold text-orange-700">{getKycReason(account)}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/business-accounts/${account.accountId}`} className="font-semibold text-blue-900 hover:text-blue-700">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </BranchesShell>
  );
}
