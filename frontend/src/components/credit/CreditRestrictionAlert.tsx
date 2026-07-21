import type { CreditAccount } from "@/lib/creditAccounts";

type Restriction = NonNullable<CreditAccount["restriction"]>;

export default function CreditRestrictionAlert({
  restriction,
  gracePeriodDays
}: {
  restriction?: Restriction;
  gracePeriodDays?: number;
}) {
  if (!restriction || restriction.level === "NONE") return null;

  const gracePeriod = restriction.level === "GRACE_WARNING";
  const heading = gracePeriod
    ? "Payment overdue - grace period active"
    : restriction.level === "CREDIT_BLOCKED"
      ? "Credit usage temporarily blocked"
      : "Shipment bookings and amendments blocked";

  return (
    <section
      role="alert"
      className={`border px-4 py-3 text-sm ${
        gracePeriod
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-red-300 bg-red-50 text-red-800"
      }`}
    >
      <p className="font-semibold">{heading}</p>
      <p className="mt-1">{restriction.message}</p>
      {gracePeriod ? (
        <p className="mt-1 text-xs font-medium">
          {restriction.overdueDays} day{restriction.overdueDays === 1 ? "" : "s"} overdue. Credit and Customer Advance remain available during the {gracePeriodDays ?? 0}-day grace period.
        </p>
      ) : null}
    </section>
  );
}
