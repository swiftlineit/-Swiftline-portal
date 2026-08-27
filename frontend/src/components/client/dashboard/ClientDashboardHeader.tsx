"use client";

import { ReactNode } from "react";
import Link from "next/link";
import {
  FiCalendar,
  FiCreditCard,
  FiPlus,
  FiSearch,
} from "react-icons/fi";
import type { ClientShellUser } from "@/components/client/ClientDashboardShell";
import { panelSurface } from "@/components/dashboard/DashboardWidgets";
import DashboardBanner from "@/components/dashboard/DashboardBanner";
import type { ClientDashboardAccount } from "@/lib/clientDashboard";
import { formatDashboardDate } from "@/lib/dateFormat";
import {
  canCreateShipment,
  canMakePayment,
  getBranchLabel,
} from "@/components/client/dashboard/clientDashboardPermissions";

function getDisplayName(user: ClientShellUser) {
  const name = user.name?.trim();

  if (name) return name.split(/\s+/)[0];

  return user.email.split("@")[0] || "Customer";
}

function greeting() {
  const hour = new Date().getHours();

  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";

  return "Good evening";
}

export default function ClientDashboardHeader({
  user,
  accounts,
  selectedAccount,
  selectedBranchId,
  selectedBranch,
  onAccountChange,
  onBranchChange,
}: {
  user: ClientShellUser;
  accounts: ClientDashboardAccount[];
  selectedAccount: ClientDashboardAccount | null;
  selectedBranchId: string;
  selectedBranch:
    | ClientDashboardAccount["assignedBranches"][number]
    | null;
  onAccountChange: (accountId: string) => void;
  onBranchChange: (branchId: string) => void;
}) {
  const hasMultipleAccounts = accounts.length > 1;
  const branches = selectedAccount?.assignedBranches ?? [];
  const hasMultipleBranches = branches.length > 1;

  const canCreate = selectedAccount
    ? canCreateShipment(selectedAccount)
    : false;

  const canPay = selectedAccount
    ? canMakePayment(selectedAccount)
    : false;

  return (
    <section
      id="business-accounts"
      className={`relative overflow-hidden p-4 sm:p-5 lg:p-5 xl:p-6 ${panelSurface} !bg-[linear-gradient(135deg,#ffffff_0%,#f9faff_46%,#f3f5fc_100%)]`}
    >
      {/* Subtle Swiftline-themed background depth */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-28 -top-36 h-72 w-72 rounded-full bg-[#0D1282]/[0.025] blur-3xl" />

        <div className="absolute left-[36%] top-1/2 h-44 w-72 -translate-y-1/2 rounded-full bg-[#0D1282]/[0.018] blur-3xl" />

        <div className="absolute -bottom-28 right-[22%] h-56 w-56 rounded-full bg-[#0D1282]/[0.025] blur-3xl" />
      </div>

      {/* Main header */}
      <div className="relative grid gap-4 lg:grid-cols-[minmax(0,0.88fr)_minmax(430px,1.12fr)] lg:items-stretch lg:gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(500px,1.1fr)] xl:gap-6">
        {/* Left content */}
        <div className="flex min-w-0 flex-col justify-center px-1 py-1 sm:px-2 lg:min-h-[180px] lg:py-2">
          {/* Client + date */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="inline-flex items-center rounded-full bg-[#0D1282]/[0.08] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#0D1282]">
              Client
            </span>

            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <FiCalendar
                aria-hidden="true"
                className="h-3.5 w-3.5 shrink-0 text-slate-400"
              />

              {formatDashboardDate(new Date().toISOString())}
            </span>
          </div>

          {/* Greeting */}
          <h1 className="mt-3 text-[26px] font-semibold leading-[1.15] tracking-[-0.025em] text-slate-700 sm:text-[29px] xl:text-[31px]">
            {greeting()},
            <span className="capitalize text-slate-950">
              {" "}
              {getDisplayName(user)}
            </span>
          </h1>

          {/* Account context */}
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium text-slate-500">
            <span className="max-w-[320px] truncate font-semibold text-slate-700">
              {selectedAccount?.account.company.companyName ||
                "Customer Dashboard"}
            </span>

            <span
              aria-hidden="true"
              className="hidden h-1 w-1 rounded-full bg-slate-300 sm:block"
            />

            <span className="whitespace-nowrap">
              Code{" "}
              <strong className="font-semibold text-slate-700">
                {selectedAccount?.account.accountId || "Not available"}
              </strong>
            </span>

            <span
              aria-hidden="true"
              className="hidden h-1 w-1 rounded-full bg-slate-300 sm:block"
            />

            <span className="whitespace-nowrap">
              Branch{" "}
              <strong className="font-semibold text-slate-700">
                {getBranchLabel(selectedBranch)}
              </strong>
            </span>
          </div>

          {/* Primary quick actions */}
          <div className="mt-5 flex flex-wrap items-center gap-2 sm:gap-2.5">
            {canCreate ? (
              <Link
                href="/client/dpd-labels"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[#F0DE36] px-4 py-2.5 text-sm font-semibold text-[#0D1282] shadow-sm transition-colors duration-200 hover:bg-[#e5d331] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D1282]/30 focus-visible:ring-offset-2 sm:min-h-11"
              >
                <FiPlus
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0"
                />
                Create Shipment
              </Link>
            ) : null}

            <Link
              href="/client/tracking"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors duration-200 hover:border-[#0D1282]/25 hover:bg-[#0D1282]/[0.025] hover:text-[#0D1282] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D1282]/30 focus-visible:ring-offset-2 sm:min-h-11"
            >
              <FiSearch
                aria-hidden="true"
                className="h-4 w-4 shrink-0"
              />
              Track Shipment
            </Link>

            {canPay ? (
              <Link
                href="/client/payments"
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors duration-200 hover:border-[#0D1282]/25 hover:bg-[#0D1282]/[0.025] hover:text-[#0D1282] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D1282]/30 focus-visible:ring-offset-2 sm:min-h-11"
              >
                <FiCreditCard
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0"
                />
                Make Payment
              </Link>
            ) : null}
          </div>
        </div>

        {/* Shared dashboard banner */}
        <div className="min-w-0">
          <DashboardBanner />
        </div>
      </div>

      {/* Account / branch switchers */}
      {hasMultipleAccounts || hasMultipleBranches ? (
        <div className="relative mt-5 rounded-xl bg-[#0D1282]/[0.025] p-3.5 sm:p-4">
          <div
            className={`grid gap-3 ${
              hasMultipleAccounts && hasMultipleBranches
                ? "md:grid-cols-2"
                : "md:grid-cols-1"
            }`}
          >
            {hasMultipleAccounts ? (
              <Field label="Business Account">
                <select
                  value={selectedAccount?.account.id ?? ""}
                  onChange={(event) =>
                    onAccountChange(event.target.value)
                  }
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3.5 pr-9 text-sm font-semibold text-slate-900 outline-none transition-colors focus:border-[#0D1282]/60 focus:ring-2 focus:ring-[#0D1282]/10"
                >
                  {accounts.map((item) => (
                    <option
                      key={item.account.id}
                      value={item.account.id}
                    >
                      {item.account.company.companyName ||
                        item.account.accountId}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            {hasMultipleBranches ? (
              <Field label="Branch">
                <select
                  value={selectedBranchId}
                  onChange={(event) =>
                    onBranchChange(event.target.value)
                  }
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3.5 pr-9 text-sm font-semibold text-slate-900 outline-none transition-colors focus:border-[#0D1282]/60 focus:ring-2 focus:ring-[#0D1282]/10"
                >
                  {branches.map((branch) => (
                    <option
                      key={branch._id}
                      value={branch._id}
                    >
                      {getBranchLabel(branch)}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-2 block text-xs font-semibold text-slate-600">
        {label}
      </span>

      {children}
    </label>
  );
}