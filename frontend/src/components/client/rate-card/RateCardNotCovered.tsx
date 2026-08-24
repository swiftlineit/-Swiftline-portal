"use client";

import Link from "next/link";
import { FiArrowRight, FiGlobe, FiMapPin } from "react-icons/fi";
import CountryFlag from "@/components/CountryFlag";
import { panelSurface } from "@/components/dashboard/DashboardWidgets";

/**
 * What a customer sees when they search a destination the card does not price.
 *
 * Deliberately not an error. A missing rate is a gap in coverage, not a mistake
 * the customer made, and the useful next step is a manual quote rather than an
 * apology. The tone says "not yet, here is how", because a customer who came
 * looking for a price is a customer with something to ship.
 */
export default function RateCardNotCovered({
  countryCode,
  countryName,
  canRequestQuote
}: {
  countryCode: string;
  countryName: string;
  canRequestQuote: boolean;
}) {
  return (
    <div className={`flex flex-col items-center gap-4 px-6 py-12 text-center ${panelSurface}`}>
      <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-[#0D1282]/5 text-[#0D1282]">
        <FiGlobe aria-hidden="true" className="h-7 w-7" />
        <span className="absolute -bottom-1 -right-1 rounded-lg bg-white p-1 shadow-sm">
          <CountryFlag code={countryCode} size={16} />
        </span>
      </span>

      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          We do not publish rates for {countryName} yet
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
          Swiftline is opening new lanes steadily, and {countryName} is on our map. In the meantime our pricing desk
          can quote this route by hand, usually within one working day.
        </p>
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
        {canRequestQuote ? (
          <Link
            href="/client/get-quote"
            className="inline-flex h-10 items-center gap-2 rounded-4xl bg-[#0D1282] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0a0e66] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0D1282]/40"
          >
            Request a quote
            <FiArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        ) : null}
        <Link
          href="/client/serviceability"
          className="inline-flex h-10 items-center gap-2 rounded-4xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 transition hover:border-slate-500"
        >
          <FiMapPin aria-hidden="true" className="h-3.5 w-3.5" />
          Check serviceability
        </Link>
      </div>
    </div>
  );
}
