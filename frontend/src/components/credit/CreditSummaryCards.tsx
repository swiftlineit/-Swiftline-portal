import { CreditAccount, formatCreditMoney } from "@/lib/creditAccounts";
import { formatDashboardDate } from "@/lib/dateFormat";

/**
 * The billing figures a customer opens this page to read.
 *
 * Split into two rows on purpose. The first is the facility — what was
 * granted, what is spent, what is left — and reads the same every day. The
 * second is what is actually owed and when, which is the half that changes and
 * the half somebody is usually chasing.
 */
const facilityMetrics: Array<{ label: string; key: keyof CreditAccount; detail: string }> = [
  { label: "Approved Limit", key: "approvedCreditLimitMinor", detail: "Finance-approved credit" },
  { label: "Used Credit", key: "usedCreditMinor", detail: "Reserved, unbilled and outstanding" },
  { label: "Available Credit", key: "availableCreditMinor", detail: "Available approved facility" },
  { label: "Customer Advance", key: "availableAdvanceMinor", detail: "Available customer-owned funds" },
  { label: "Booking Capacity", key: "availableBookingCapacityMinor", detail: "Advance plus available credit" }
];

export default function CreditSummaryCards({ account }: { account: CreditAccount }) {
  const bookingCapacityDetail = account.restriction?.level === "ALL_BOOKINGS_BLOCKED"
    ? "Bookings currently blocked"
    : account.restriction?.level === "CREDIT_BLOCKED"
      ? "Customer Advance only while credit is blocked"
      : "Advance plus available credit";

  const billing = account.billing ?? null;
  const overdueMinor = billing?.overdueAmountMinor ?? 0;

  /**
   * Amounts owed and dates due.
   *
   * Rendered in plain cards rather than the blue facility tiles: overdue money
   * needs to look different from an approved limit, and a red figure among
   * five identical blue ones is easy to miss.
   */
  const owedMetrics: Array<{ label: string; value: string; detail: string; tone: string }> = [
    {
      label: "Outstanding Balance",
      value: formatCreditMoney(account.invoicedOutstandingMinor, account.currency),
      detail: "Invoiced and not yet paid",
      tone: "text-slate-950"
    },
    {
      label: "Overdue Amount",
      value: formatCreditMoney(overdueMinor, account.currency),
      detail: billing?.overdueStatementCount
        ? `${billing.overdueStatementCount} statement${billing.overdueStatementCount === 1 ? "" : "s"} past due`
        : "Nothing past its due date",
      // Only coloured when there is something to be alarmed about.
      tone: overdueMinor > 0 ? "text-red-700" : "text-slate-950"
    },
    {
      label: "Unbilled Shipments",
      value: formatCreditMoney(account.unbilledCreditMinor, account.currency),
      detail: "Shipped, not yet on a statement",
      tone: "text-slate-950"
    },
    {
      label: "Last Payment",
      value: billing?.lastPayment
        ? formatCreditMoney(billing.lastPayment.amountMinor, account.currency)
        : "None yet",
      detail: billing?.lastPayment ? formatDashboardDate(billing.lastPayment.at) : "No payment recorded",
      tone: "text-slate-950"
    },
    {
      label: "Next Due Date",
      value: billing?.nextDueAt ? formatDashboardDate(billing.nextDueAt) : "Nothing due",
      detail: billing?.nextDueAmountMinor
        ? formatCreditMoney(billing.nextDueAmountMinor, account.currency)
        : `Payment terms: ${account.paymentTermsDays} days`,
      tone: "text-slate-950"
    }
  ];

  return (
    <div className="space-y-3">
      <section id="credit-summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {facilityMetrics.map((metric) => (
          <div key={metric.key} className="rounded-xl border border-slate-300 bg-linear-to-r from-blue-500 via-blue-400 to-blue-400 p-4 text-white">
            <p className="text-xs font-semibold uppercase">{metric.label}</p>
            <p className="mt-3 text-xl font-semibold">
              {formatCreditMoney(account[metric.key] as number | undefined, account.currency)}
            </p>
            <p className="mt-1 text-xs">
              {metric.key === "availableBookingCapacityMinor" ? bookingCapacityDetail : metric.detail}
            </p>
          </div>
        ))}
      </section>

      {/* Absent entirely for a member without balance visibility, rather than
          shown as five zeroes that read as "you owe nothing". */}
      {billing ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {owedMetrics.map((metric) => (
            <div key={metric.label} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase text-slate-500">{metric.label}</p>
              <p className={`mt-3 text-xl font-semibold ${metric.tone}`}>{metric.value}</p>
              <p className="mt-1 text-xs text-slate-500">{metric.detail}</p>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
