import { CreditAccount, formatCreditMoney } from "@/lib/creditAccounts";

const metrics: Array<{ label: string; key: keyof CreditAccount; detail: string }> = [
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

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {metrics.map((metric, index) => (
        <div key={metric.key} className={`border p-4 rounded-xl  border-amber-300 bg-blue-500 text-white`}>
          <p className={`text-xs font-semibold uppercase `}>{metric.label}</p>
          <p className="mt-3 text-xl font-semibold">{formatCreditMoney(account[metric.key] as number | undefined, account.currency)}</p>
          <p className={`mt-1 text-xs`}>
            {metric.key === "availableBookingCapacityMinor" ? bookingCapacityDetail : metric.detail}
          </p>
        </div>
      ))}
    </section>
  );
}
