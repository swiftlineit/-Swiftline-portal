"use client";

import { ReactNode } from "react";
import Link from "next/link";
import {
  FiCalendar,
  FiClipboard,
  FiCreditCard,
  FiHelpCircle,
  FiPlus,
  FiSearch,
  FiShield,
  FiTruck,
} from "react-icons/fi";
import type { ClientShellUser } from "@/components/client/ClientDashboardShell";
import { panelSurface } from "@/components/dashboard/DashboardWidgets";
import type { ClientDashboardAccount } from "@/lib/clientDashboard";
import { formatDashboardDate } from "@/lib/dateFormat";
import {
  canCreateShipment,
  canMakePayment,
  canRaiseClaim,
  canRequestPickup,
  canRequestQuote,
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
  onBranchChange
}: {
  user: ClientShellUser;
  accounts: ClientDashboardAccount[];
  selectedAccount: ClientDashboardAccount | null;
  selectedBranchId: string;
  selectedBranch: ClientDashboardAccount["assignedBranches"][number] | null;
  onAccountChange: (accountId: string) => void;
  onBranchChange: (branchId: string) => void;
}) {
  const hasMultipleAccounts = accounts.length > 1;
  const branches = selectedAccount?.assignedBranches ?? [];
  const hasMultipleBranches = branches.length > 1;
  const canCreate = selectedAccount ? canCreateShipment(selectedAccount) : false;
  const canQuote = selectedAccount ? canRequestQuote(selectedAccount) : false;
  const canPay = selectedAccount ? canMakePayment(selectedAccount) : false;
  const canPickup = selectedAccount ? canRequestPickup(selectedAccount) : false;
  const canClaim = selectedAccount ? canRaiseClaim(selectedAccount) : false;

  return (
    <section id="business-accounts" className={`p-6 ${panelSurface}`}>
      <div className="flex flex-wrap flex-col items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center rounded-full bg-[#0D1282]/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#0D1282]">
              Client
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
              <FiCalendar aria-hidden="true" className="h-3.5 w-3.5" />
              {formatDashboardDate(new Date().toISOString())}
            </span>
          </div>

          <h1 className="mt-3 text-2xl font-semibold tracking-wide text-slate-700 sm:text-[28px]">
            {greeting()},<span className="tracking-wide text-black capitalize"> {getDisplayName(user)}</span>
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
            {selectedAccount?.account.company.companyName || "Customer Dashboard"}
            {" - "}Swiftline Customer Code <strong className="font-semibold ">{selectedAccount?.account.accountId || "Not available"}</strong>
            {" - "}Branch <strong className="font-semibold ">{getBranchLabel(selectedBranch)}</strong>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canCreate ? (
            <Link href="/client/dpd-labels" className="inline-flex items-center gap-2 rounded-4xl bg-[#F0DE36] px-4 py-2.5 text-sm font-semibold text-[#0D1282] shadow-sm shadow-black/10 transition hover:bg-[#e0cf2e] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D1282]/40 focus-visible:ring-offset-2">
              <FiPlus aria-hidden="true" className="h-4 w-4" />Create Shipment
            </Link>
          ) : null}
          {canQuote ? (
            <Link href="/client/get-quote" className="inline-flex items-center gap-2 rounded-4xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D1282]/40 focus-visible:ring-offset-2">
              <FiClipboard aria-hidden="true" className="h-4 w-4" />Get Live Quote
            </Link>
          ) : null}
          {canPay ? (
            <Link href="/client/payments" className="inline-flex items-center gap-2 rounded-4xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D1282]/40 focus-visible:ring-offset-2">
              <FiCreditCard aria-hidden="true" className="h-4 w-4" />Make Payment
            </Link>
          ) : null}
          {canPickup ? (
            <Link href="/client/pickups" className="inline-flex items-center gap-2 rounded-4xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D1282]/40 focus-visible:ring-offset-2">
              <FiTruck aria-hidden="true" className="h-4 w-4" />Request Pickup
            </Link>
          ) : null}
          <Link href="/client/tracking" className="inline-flex items-center gap-2 rounded-4xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D1282]/40 focus-visible:ring-offset-2">
            <FiSearch aria-hidden="true" className="h-4 w-4" />Track Shipment
          </Link>
          {canClaim ? (
            <Link href="/client/claims/new" className="inline-flex items-center gap-2 rounded-4xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D1282]/40 focus-visible:ring-offset-2">
              <FiShield aria-hidden="true" className="h-4 w-4" />Raise Claim
            </Link>
          ) : null}
          <Link href="/client/tickets/new" className="inline-flex items-center gap-2 rounded-4xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#0D1282] hover:text-[#0D1282] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D1282]/40 focus-visible:ring-offset-2">
            <FiHelpCircle aria-hidden="true" className="h-4 w-4" />Raise Support Ticket
          </Link>
        </div>
      </div>

      {hasMultipleAccounts || hasMultipleBranches ? (
        <div className="mt-5 grid gap-4 border-t border-slate-200 pt-5 md:grid-cols-2">
          {hasMultipleAccounts ? (
            <Field label="Business Account">
              <select
                value={selectedAccount?.account.id ?? ""}
                onChange={(event) => onAccountChange(event.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 focus:border-[#0D1282] focus:outline-none"
              >
                {accounts.map((item) => (
                  <option key={item.account.id} value={item.account.id}>{item.account.company.companyName || item.account.accountId}</option>
                ))}
              </select>
            </Field>
          ) : null}

          {hasMultipleBranches ? (
            <Field label="Branch">
              <select
                value={selectedBranchId}
                onChange={(event) => onBranchChange(event.target.value)}
                className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 focus:border-[#0D1282] focus:outline-none"
              >
                {branches.map((branch) => (
                  <option key={branch._id} value={branch._id}>{getBranchLabel(branch)}</option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}
