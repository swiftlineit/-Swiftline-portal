"use client";

import Link from "next/link";
import { formatDashboardDate } from "@/lib/dateFormat";
import {
  formatQuoteMoney,
  type QuoteAudience,
  type ShipmentQuote,
} from "@/lib/shipmentQuotes";

export default function QuoteList({
  quotes,
  audience,
  loading,
}: {
  quotes: ShipmentQuote[];
  audience: QuoteAudience;
  loading: boolean;
}) {
  const base =
    audience === "client" ? "/client/quotes" : "/dashboard/quote-requests";
  return (
    <div className="overflow-x-auto border border-slate-200 bg-white  rounded-2xl">
      <table className="w-full min-w-[900px] border-collapse text-left text-sm">
        <thead className="bg-slate-100 text-xs font-semibold uppercase text-slate-600">
          <tr>
            <th className="px-5 py-4">Quote</th>
            <th className="px-5 py-4">Customer</th>
            <th className="px-5 py-4">Route</th>
            <th className="px-5 py-4">Service</th>
            <th className="px-5 py-4 text-right">Amount</th>
            <th className="px-5 py-4">Valid Until</th>
            <th className="px-5 py-4">Status</th>
            <th className="px-5 py-4 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {loading ? (
            <tr>
              <td colSpan={8} className="px-5 py-10 text-center text-slate-500">
                Loading quotes...
              </td>
            </tr>
          ) : null}
          {!loading && !quotes.length ? (
            <tr>
              <td colSpan={8} className="px-5 py-10 text-center text-slate-500">
                No shipment quotes found.
              </td>
            </tr>
          ) : null}
          {!loading
            ? quotes.map((quote) => (
                <tr key={quote.id} className="hover:bg-slate-50">
                  <td className="px-5 py-4">
                    <p className="font-semibold text-slate-950">
                      {quote.quoteNumber}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDashboardDate(quote.createdAt)}
                    </p>
                  </td>
                  <td className="px-5 py-4">
                    <p className="font-semibold text-slate-900">
                      {quote.account?.companyName || "-"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {quote.account?.accountId || ""}
                    </p>
                  </td>
                  <td className="px-5 py-4">
                    {quote.request.originCity} to{" "}
                    {quote.request.destinationCountryName}
                  </td>
                  <td className="px-5 py-4">
                    {quote.request.serviceType === "COURIER"
                      ? "Courier"
                      : "Cargo"}
                  </td>
                  <td className="px-5 py-4 text-right font-semibold">
                    {quote.finalPricing
                      ? formatQuoteMoney(quote.finalPricing.totalMinor)
                      : quote.estimate.missingRate
                        ? "Pending"
                        : formatQuoteMoney(quote.estimate.totalMinor)}
                  </td>
                  <td className="px-5 py-4">
                    {quote.validUntil
                      ? formatDashboardDate(quote.validUntil)
                      : "Not issued"}
                  </td>
                  <td className="px-5 py-4">
                    <Status value={quote.status} />
                  </td>
                  <td className="px-5 py-4 text-right">
                    <Link
                      href={`${base}/${quote.id}`}
                      className="font-semibold text-blue-900 hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))
            : null}
        </tbody>
      </table>
    </div>
  );
}

export function Status({ value }: { value: ShipmentQuote["status"] }) {
  const style =
    value === "QUOTED" || value === "CONVERTED"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : value === "DECLINED" || value === "EXPIRED"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-amber-200 bg-amber-50 text-amber-800";
  return (
    <span
      className={`inline-flex border px-2.5 py-1 text-xs rounded-4xl font-semibold ${style}`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
