"use client";

import { FiAlertTriangle, FiCheckCircle, FiClipboard, FiCreditCard, FiDollarSign, FiPackage } from "react-icons/fi";
import { KpiCard } from "@/components/dashboard/DashboardWidgets";
import type { ClientPrepaidAccount, ClientShipmentSummary } from "@/lib/clientDashboard";
import type { ClientExtras } from "@/lib/clientDashboardOverview";
import { formatCompactMoney, formatCount } from "@/lib/dashboardOverview";

export default function ClientKpiGrid({
  summary,
  wallet,
  extras
}: {
  summary: ClientShipmentSummary;
  wallet?: ClientPrepaidAccount;
  extras: ClientExtras;
}) {
  const canViewCredit = extras.creditPermissions.includes("viewCreditBalance");
  const hasCreditFacility = Boolean(extras.credit && extras.credit.status !== "NOT_REQUESTED");
  const needsAttention = summary.needsReview + summary.validationFailed;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        icon={FiPackage}
        label="Total shipments"
        value={formatCount(summary.totalShipments)}
        description="Drafts created for the selected context"
        href="/client/dpd-labels"
      />
      <KpiCard
        icon={FiCheckCircle}
        label="Ready for label"
        value={formatCount(summary.readyForLabel)}
        description="Validated and awaiting label creation"
        href="/client/dpd-labels"
      />
      <KpiCard
        icon={FiAlertTriangle}
        label="Needs attention"
        value={formatCount(needsAttention)}
        description={`${summary.needsReview} need review, ${summary.validationFailed} failed validation`}
        href="/client/dpd-labels"
        emphasis={needsAttention > 0}
      />
      {canViewCredit && extras.credit && hasCreditFacility ? (
        <KpiCard
          icon={FiDollarSign}
          label="Booking capacity"
          value={formatCompactMoney(extras.credit.availableBookingCapacityMinor ?? 0, extras.credit.currency)}
          description="Customer advance plus available credit"
          href="/client/credit"
        />
      ) : wallet ? (
        <KpiCard
          icon={FiCreditCard}
          label="Available balance"
          value={formatCompactMoney(wallet.availableBalanceMinor, wallet.currency)}
          description="Customer advance available for booking"
          href="/client/payments"
        />
      ) : (
        <KpiCard
          icon={FiClipboard}
          label="Quotes ready to book"
          value={formatCount(extras.quotesToConvert)}
          description="Priced quotes waiting to convert"
          href="/client/quotes"
        />
      )}
    </div>
  );
}
