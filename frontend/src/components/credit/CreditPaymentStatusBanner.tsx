import Link from "next/link";
import { FiAlertTriangle, FiArrowRight, FiClock } from "react-icons/fi";
import type { CreditAccount } from "@/lib/creditAccounts";
import { getCreditPaymentStatus } from "@/lib/creditPaymentStatus";

/**
 * The payment warning a customer sees before a booking stops working.
 *
 * Shown only when something needs doing - due within three days, overdue, or
 * already blocked. Its presence is the signal, so a customer who is on top of
 * their account never sees it at all.
 */
export default function CreditPaymentStatusBanner({
  account,
  businessAccountId
}: {
  account: CreditAccount | null;
  businessAccountId?: string;
}) {
  const status = getCreditPaymentStatus(account);
  if (!status) return null;

  const critical = status.tone === "critical";
  const statementsHref = businessAccountId
    ? `/client/credit/statements?businessAccountId=${encodeURIComponent(businessAccountId)}`
    : "/client/credit/statements";

  return (
    <section
      role={critical ? "alert" : "status"}
      className={`rounded-2xl border p-5 ${
        critical ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              critical ? "bg-red-200 text-red-900" : "bg-amber-200 text-amber-900"
            }`}
          >
            {critical
              ? <FiAlertTriangle aria-hidden="true" className="h-5 w-5" />
              : <FiClock aria-hidden="true" className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <h2 className={`text-sm font-semibold ${critical ? "text-red-900" : "text-slate-900"}`}>
              {status.heading}
            </h2>
            <p className={`mt-1 max-w-2xl text-sm leading-6 ${critical ? "text-red-800" : "text-slate-700"}`}>
              {status.detail}
            </p>
          </div>
        </div>

        <Link
          href={statementsHref}
          className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-4xl px-4 text-sm font-semibold text-white ${
            critical ? "bg-red-700 hover:bg-red-800" : "bg-blue-900 hover:bg-blue-800"
          }`}
        >
          {status.level === "DUE_SOON" ? "View statement" : "Pay now"}
          <FiArrowRight aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
