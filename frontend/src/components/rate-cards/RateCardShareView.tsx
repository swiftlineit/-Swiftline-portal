"use client";

import { FiAlertTriangle, FiCalendar, FiCheckCircle, FiDownload, FiGlobe, FiInfo, FiLayers, FiTrendingDown } from "react-icons/fi";
import { FlagImage, type CountryIso2 } from "react-international-phone";
import {
  daysUntil,
  formatRate,
  formatShareDate,
  groupRateCardRows,
  type RateCardShare,
} from "@/lib/rateCardShares";

/**
 * The rate card as a customer sees it. Rendered identically inside the client
 * portal modal and on the public link page, so the sheet a recipient opens from
 * WhatsApp is the same artefact their colleague sees signed in.
 */
export default function RateCardShareView({
  share,
  recipientLabel,
  onDownload,
  downloading = "",
}: {
  share: RateCardShare;
  recipientLabel: string;
  onDownload?: (format: "pdf" | "xlsx") => void;
  downloading?: "" | "pdf" | "xlsx";
}) {
  const groups = groupRateCardRows(share.rows);
  const countryCount = new Set(share.rows.map((row) => row.countryCode)).size;
  const lowestRate = share.rows.length
    ? Math.min(...share.rows.map((row) => row.chargesPerKg))
    : 0;
  const remainingDays = daysUntil(share.terms.validUntil);

  return (
    <div className="text-slate-900">
      <header className="relative overflow-hidden rounded-t-2xl bg-[#0D1282] px-6 py-7 text-white sm:px-8">
        {/* Two soft radials keep the band from reading as a flat colour block
            without needing an image the public page could not load. */}
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-10 h-56 w-56 rounded-full bg-sky-400/20 blur-3xl" />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-200">
              {share.documentType === "EXTERNAL_PROPOSAL"
                ? "Swiftline - External Rate Proposal"
                : "Swiftline - Your Rate Card"}
            </p>
            <h2 className="mt-2 text-2xl font-semibold leading-tight sm:text-3xl">
              {share.title}
            </h2>
            <p className="mt-2 text-sm text-indigo-100">
              Prepared for <span className="font-semibold text-white">{recipientLabel}</span>
            </p>
          </div>

         
        </div>

        <div className="relative mt-6 grid gap-3 sm:grid-cols-3">
          <Metric icon={<FiGlobe />} label="Destinations" value={String(countryCount)} />
          <Metric icon={<FiLayers />} label="Weight slabs" value={String(share.rows.length)} />
          <Metric
            icon={<FiTrendingDown />}
            label="Starting from"
            value={lowestRate ? `${formatRate(lowestRate, share.currency)} / kg` : "-"}
          />
          <Metric icon={<FiCalendar />} label="Valid until" value={formatShareDate(share.terms.validUntil)} /> 
          <Metric icon={<FiInfo />} label="Reference" value={share.shareNumber} />
             {onDownload ? (
          <div className="flex flex-wrap gap-3 mt-4">
            <DownloadButton
              label="Download PDF"
              busy={downloading === "pdf"}
              tone="primary"
              onClick={() => onDownload("pdf")}
            />
            <DownloadButton
              label="Download Excel"
              busy={downloading === "xlsx"}
              tone="secondary"
              onClick={() => onDownload("xlsx")}
            />
          </div>
        ) : null}

         
        </div>
      </header>

      <div className="space-y-6 bg-white px-6 py-6 sm:px-8">
        <ValidityBanner
          expired={share.expired}
          remainingDays={remainingDays}
          validFrom={share.terms.validFrom}
          validUntil={share.terms.validUntil}
        />

       
        <section>
          <SectionHeading>Weight slabs &amp; rates</SectionHeading>

          <div className="space-y-4">
            {groups.map((group) => (
              <div
                key={`${group.countryCode}-${group.service}`}
                className="overflow-hidden rounded-xl border border-slate-200"
              >
                <div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                  <p className="flex min-w-0 items-center gap-2.5 font-semibold text-slate-900">
                    <span className="flex h-5 w-7 shrink-0 items-center justify-center overflow-hidden [&_img]:rounded-none">
                      <FlagImage iso2={group.countryCode.toLowerCase() as CountryIso2} size="20px" />
                    </span>
                    <span className="truncate">{group.countryName}</span>
                  </p>
                  <span className="shrink-0 rounded-full bg-[#0D1282]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[#0D1282]">
                    {group.service.toLowerCase()}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-y border-slate-200 bg-white text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">From KG</th>
                        <th className="px-4 py-2.5 font-semibold">To KG</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Rate / KG</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Max Box KG</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((row) => (
                        <tr
                          key={`${row.fromKg}-${row.toKg}`}
                          className="border-b border-slate-100 last:border-b-0 odd:bg-white even:bg-slate-50/60"
                        >
                          <td className="px-4 py-2.5 text-slate-700">{row.fromKg}</td>
                          <td className="px-4 py-2.5 text-slate-700">{row.toKg}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-slate-900">
                            {formatRate(row.chargesPerKg, share.currency)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-700">{row.maxBoxKg}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>

        {share.routeCharges.length ? <RouteChargesSection share={share} /> : null}

        <TermsSection share={share} />

        {share.terms.remarks ? (
          <section>
            <SectionHeading>Remarks</SectionHeading>
            <p className="whitespace-pre-line rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
              {share.terms.remarks}
            </p>
          </section>
        ) : null}

        <p className="border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">
          Rates exclude duties, taxes, customs clearance charges and any charges levied at destination, and are
          subject to revision on account of carrier tariff changes, currency movement or regulatory action.
          Shipments are accepted subject to Swiftline&apos;s standard terms and conditions of carriage.
        </p>
      </div>
    </div>
  );
}

function RouteChargesSection({ share }: { share: RateCardShare }) {
  return (
    <section>
      <SectionHeading>Route-specific charges</SectionHeading>
      <div className="grid gap-3 lg:grid-cols-2">
        {share.routeCharges.map((charge) => (
          <article
            key={`${charge.countryCode}-${charge.service}`}
            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold text-slate-900">{charge.countryCode}</p>
              <span className="rounded-full bg-[#0D1282]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-[#0D1282]">
                {charge.service.toLowerCase()}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <RouteChargeTerm label="Fuel surcharge" value={`${charge.fuelSurchargePercent}%`} />
              <RouteChargeTerm label="Discount" value={`${charge.discountPercent}%`} />
              <RouteChargeTerm label="Remote area" value={formatRate(charge.remoteAreaCharge, share.currency)} />
              <RouteChargeTerm label="Handling" value={formatRate(charge.handlingCharge, share.currency)} />
              {/* Insurance is switched off portal-wide and is never charged, so
                  quoting a premium to a customer would be a rate we cannot honour. */}
            </dl>
            {charge.remoteAreaPostcodes.length ? (
              <p className="mt-3 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-600">
                <span className="font-semibold text-slate-700">Remote postcode prefixes:</span>{" "}
                {charge.remoteAreaPostcodes.join(", ")}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function RouteChargeTerm({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/15 backdrop-blur">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-indigo-200">{label}</p>
        <p className="truncate text-sm font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}

/**
 * The validity window gets its own banner because "are these rates still good?"
 * is the first thing a customer needs answered, and the answer changes tone
 * three ways: live, closing soon, and gone.
 */
function ValidityBanner({
  expired,
  remainingDays,
  validFrom,
  validUntil,
}: {
  expired: boolean;
  remainingDays: number;
  validFrom: string;
  validUntil: string;
}) {
  const closingSoon = !expired && remainingDays <= 7;
  const tone = expired
    ? "border-red-200 bg-red-50 text-red-800"
    : closingSoon
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : "border-emerald-200 bg-emerald-50 text-emerald-900";

  const icon = expired ? <FiAlertTriangle /> : closingSoon ? <FiCalendar /> : <FiCheckCircle />;
  const headline = expired
    ? "These rates have expired"
    : closingSoon
      ? `These rates expire in ${remainingDays} ${remainingDays === 1 ? "day" : "days"}`
      : "These rates are currently valid";

  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${tone}`}>
      <span className="mt-0.5 shrink-0 text-lg">{icon}</span>
      <div>
        <p className="text-sm font-semibold">{headline}</p>
        <p className="mt-0.5 text-xs">
          Valid {formatShareDate(validFrom)}- {formatShareDate(validUntil)}
          {expired ? ". Please contact your Swiftline representative for the latest rates." : ""}
        </p>
      </div>
    </div>
  );
}

function TermsSection({ share }: { share: RateCardShare }) {
  // A zeroed term is one that was never set, so it is left out rather than
  // printed as "0%"- which a customer would read as a commitment.
  const terms = [
    { label: "Currency", value: `${share.currency} per kilogram` },
    share.terms.fuelSurchargePercent > 0
      ? { label: "Fuel surcharge", value: `${share.terms.fuelSurchargePercent}% on net freight` }
      : null,
    share.terms.gstPercent > 0
      ? { label: "GST", value: `${share.terms.gstPercent}% extra as applicable` }
      : null,
    share.terms.minChargeableWeightKg > 0
      ? { label: "Min chargeable weight", value: `${share.terms.minChargeableWeightKg} kg per shipment` }
      : null,
    share.terms.volumetricDivisor > 0
      ? { label: "Volumetric weight", value: `L × W × H (cm) ÷ ${share.terms.volumetricDivisor}` }
      : null,
  ].filter((term): term is { label: string; value: string } => Boolean(term));

  return (
    <section>
      <SectionHeading>Commercial terms</SectionHeading>

      <dl className="grid gap-3 sm:grid-cols-4">
        {terms.map((term) => (
          <div key={term.label} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <dt className="text-xs  font-semibold uppercase tracking-wide text-slate-500">{term.label}</dt>
            <dd className="mt-1 text-sm  text-slate-900">{term.value}</dd>
          </div>
        ))}
      </dl>

      {share.terms.customTerms.length ? (
        <ul className="mt-3 space-y-2">
          {share.terms.customTerms.map((term) => (
            <li key={term} className="flex gap-2.5 text-sm leading-6 text-slate-700">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0D1282]" />
              <span>{term}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 flex items-center gap-3 text-sm   uppercase tracking-[0.15em] text-[#0D1282]">
      {children}
      <span className="h-px flex-1 bg-slate-200" />
    </h3>
  );
}

function DownloadButton({
  label,
  busy,
  tone,
  onClick,
}: {
  label: string;
  busy: boolean;
  tone: "primary" | "secondary";
  onClick: () => void;
}) {
  const styles = tone === "primary"
    ? "bg-white text-red-500 hover:bg-slate-300  disabled:bg-slate-400"
    : "border border-slate-300 bg-white text-green-800 hover:border-[#0D1282] hover:text-[#0D1282] disabled:text-slate-400";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold transition disabled:cursor-not-allowed ${styles}`}
    >
      <FiDownload aria-hidden="true" className="h-4 w-4" />
      {busy ? "Preparing..." : label}
    </button>
  );
}
