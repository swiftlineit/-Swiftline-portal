"use client";

import { FiAlertTriangle, FiLock } from "react-icons/fi";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { formatCountryRateService, getCountryFlag } from "@/lib/countryRateCards";
import type { ShipmentServiceType } from "@/lib/dpdLabels";
import {
  formatEstimateMoney,
  type ShipmentChargeLine,
  type ShipmentCostEstimate
} from "@/lib/shipmentCostEstimate";
import { getVolumetricDivisor, getVolumetricFormula } from "@/lib/shipmentPricing";

/**
 * The full cost of a shipment, before it is booked.
 *
 * Every figure here comes from the server, priced by the same engine the booking
 * itself uses, so what a customer reads is what they are charged. The panel is
 * shared by the client and the admin booking forms — one breakdown, one place to
 * change it, and no way for the two to drift apart.
 */
export default function ShipmentCostEstimatePanel({
  estimate,
  loading,
  error,
  serviceType,
  countryCode,
  countryName,
  insuranceOptIn,
  onInsuranceOptInChange,
  forceGst,
  onForceGstChange,
  insuranceDisabled = false
}: {
  estimate: ShipmentCostEstimate | null;
  loading: boolean;
  error: string;
  serviceType: ShipmentServiceType;
  countryCode: string;
  countryName: string;
  insuranceOptIn: boolean;
  onInsuranceOptInChange: (next: boolean) => void;
  forceGst: boolean;
  onForceGstChange: (next: boolean) => void;
  /** Set while a save or booking is in flight, so cover cannot be toggled mid-request. */
  insuranceDisabled?: boolean;
}) {
  const pricing = estimate?.pricing ?? null;
  const funding = estimate?.funding ?? null;

  return (
    <div className="mt-4 rounded-2xl border border-slate-400 bg-slate-50 p-3">
      <div className="grid gap-3 text-sm">
        <DetailRow label="Service" value={formatCountryRateService(serviceType)} />
        <DetailRow
          label="Destination"
          value={`${getCountryFlag(countryCode)} ${countryName || "Not set"}`.trim()}
        />
        <DetailRow
          label="Volumetric Divisor"
          value={getVolumetricDivisor(serviceType)}
          tooltip={getVolumetricFormula(serviceType)}
        />
      </div>

      {error ? (
        <p className="mt-3 border-t border-slate-200 pt-3 text-xs font-semibold text-red-700">{error}</p>
      ) : null}

      {/* The previous total is kept on screen while a new one is being fetched, so
          a customer editing weights sees the figure settle rather than flicker. */}
      {!pricing ? (
        <p className="mt-3 border-t border-slate-200 pt-3 text-xs font-medium text-slate-500">
          {loading ? "Calculating charges..." : "Add box weights and a destination to see the full cost."}
        </p>
      ) : (
        <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
            {pricing.parcels.map((parcel) => (
              <div key={parcel.sequence} className="text-xs leading-5 text-slate-600">
                <p className="font-semibold text-slate-900">
                  Box {parcel.sequence}: {parcel.chargeableWeightKg.toFixed(2)} kg chargeable
                </p>
                <p>
                  Actual {parcel.actualWeightKg.toFixed(2)} kg / Volumetric {parcel.volumetricWeightKg.toFixed(2)} kg
                </p>
                <p>
                  {parcel.chargesPerKg === null
                    ? "No matching rate slab"
                    : `${formatEstimateMoney(Math.round(parcel.chargesPerKg * 100))} / kg`}
                </p>
                {parcel.exceedsMaxBoxKg && parcel.maxBoxKg !== null ? (
                  <p className="mt-1 font-semibold text-amber-700">
                    Max box weight limit is {parcel.maxBoxKg} kg. Charges are still calculated.
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          {pricing.missingRate ? (
            <p className="mt-3 border-t border-slate-200 pt-3 text-xs font-semibold text-red-700">
              No matching country rate slab was found for one or more boxes, so this shipment cannot be priced yet.
            </p>
          ) : (
            <>
              <dl className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                {pricing.lines.map((line) => (
                  <ChargeRow key={line.code} line={line} />
                ))}
              </dl>

              <div className="mt-3 flex items-start justify-between gap-3 border-t border-slate-200 pt-3">
                <dt className="text-sm font-semibold text-slate-950">Total payable</dt>
                <dd className="text-base font-bold whitespace-nowrap text-blue-900">
                  {formatEstimateMoney(Math.round(pricing.totalAmount * 100))}
                </dd>
              </div>

              {funding ? <FundingBreakdown funding={funding} /> : null}
              {estimate ? <PriceLockNote expiresAt={estimate.expiresAt} /> : null}
            </>
          )}
        </div>
      )}

      <InsuranceToggle
        checked={insuranceOptIn}
        disabled={insuranceDisabled}
        onChange={onInsuranceOptInChange}
        premiumMinor={pricing?.insuranceApplied ? Math.round(pricing.insuranceAmount * 100) : null}
        declaredGoodsValue={pricing?.declaredGoodsValue ?? 0}
      />
      <div className="mt-3 flex items-start justify-between gap-4 border-t border-slate-200 pt-3">
        <div>
          <p className="text-sm font-semibold text-slate-900">Apply GST</p>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">
            {pricing?.noGstEligible
              ? "This account is approved for no-GST billing. Turn this on to charge GST for this shipment."
              : "GST is mandatory unless the account has an approved no-GST permission."}
          </p>
        </div>
        <label className={`relative mt-1 inline-flex shrink-0 items-center ${pricing?.noGstEligible ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
          <input
            type="checkbox"
            className="peer sr-only"
            checked={pricing?.noGstEligible ? forceGst : true}
            disabled={insuranceDisabled || !pricing?.noGstEligible}
            onChange={(event) => onForceGstChange(event.target.checked)}
          />
          <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-[#0D1282] peer-focus-visible:ring-2 peer-focus-visible:ring-[#F0DE36] peer-disabled:cursor-not-allowed after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-5" />
        </label>
      </div>
    </div>
  );
}

/** One charge, tax or deduction, with the basis it was worked out from. */
function ChargeRow({ line }: { line: ShipmentChargeLine }) {
  const isDeduction = line.kind === "DEDUCTION";

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <dt className="text-sm font-medium text-slate-700">{line.label}</dt>
        <dd className="mt-0.5 text-xs leading-4 text-slate-500">{line.basis}</dd>
      </div>
      <dd
        className={`whitespace-nowrap text-sm font-semibold ${isDeduction ? "text-emerald-700" : "text-slate-950"}`}
      >
        {isDeduction ? "-" : ""}{formatEstimateMoney(line.amountMinor)}
      </dd>
    </div>
  );
}

/**
 * How the total will actually be settled.
 *
 * Shown before booking so the split between the Customer Advance balance and the
 * credit facility is never a surprise discovered on a statement.
 */
function FundingBreakdown({ funding }: { funding: ShipmentCostEstimate["funding"] }) {
  if (funding.mode === "COUNTER") {
    return (
      <p className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">
        {funding.message}
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
      <dl className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-xs font-medium text-slate-600">Advance deduction</dt>
          <dd className="whitespace-nowrap text-xs font-semibold text-slate-950">
            {funding.advanceDeductionMinor > 0 ? "-" : ""}{formatEstimateMoney(funding.advanceDeductionMinor)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-xs font-medium text-slate-600">Credit usage</dt>
          <dd className="whitespace-nowrap text-xs font-semibold text-slate-950">
            {formatEstimateMoney(funding.creditUsageMinor)}
          </dd>
        </div>
      </dl>
      <p
        className={`mt-2 border-t border-slate-100 pt-2 text-xs font-medium ${
          funding.canFund ? "text-slate-500" : "text-red-700"
        }`}
      >
        {!funding.canFund ? (
          <FiAlertTriangle aria-hidden="true" className="mr-1 inline-block h-3.5 w-3.5 align-text-bottom" />
        ) : null}
        {funding.message}
      </p>
    </div>
  );
}

/**
 * How long the quoted price is honoured for.
 *
 * The server refuses a booking priced against an estimate that has since moved,
 * so this is a promise the system actually keeps rather than a reassurance.
 */
function PriceLockNote({ expiresAt }: { expiresAt: string }) {
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) return null;

  return (
    <p className="mt-3 flex items-start gap-1.5 text-xs font-medium text-slate-500">
      <FiLock aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0" />
      <span>
        This price is held until{" "}
        {expiry.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}. If any charge changes
        before you book, you will be shown what changed and asked to confirm again.
      </span>
    </p>
  );
}

/**
 * Optional transit cover.
 *
 * Always rendered, including when the route has no insurance configured, because
 * a customer needs to see that cover was offered and declined — not merely that
 * no premium appeared. The premium itself only shows once cover is taken.
 */
function InsuranceToggle({
  checked,
  disabled,
  onChange,
  premiumMinor,
  declaredGoodsValue
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  premiumMinor: number | null;
  declaredGoodsValue: number;
}) {
  return (
    <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-blue-900 p-2 disabled:cursor-not-allowed"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
          Add transit insurance
        </span>
        <span className="mt-0.5 block text-xs leading-4 text-slate-500">
          {checked && premiumMinor !== null
            ? `${formatEstimateMoney(premiumMinor)} to cover the declared goods value.`
            : checked
              ? "No premium is configured for this route, so no charge applies."
              : `Covers the declared goods value of ${formatEstimateMoney(Math.round(declaredGoodsValue * 100))}.`}
        </span>
      </span>
    </label>
  );
}

function DetailRow({
  label,
  value,
  tooltip
}: {
  label: string;
  value?: string | number | null;
  tooltip?: string;
}) {
  return (
    <div>
      <span className="flex items-center gap-1 text-xs font-semibold uppercase text-slate-500">
        {label}
        {tooltip ? <InfoTooltip text={tooltip} /> : null}
      </span>
      <p className="mt-1 text-sm font-semibold text-slate-950">{value || "Not available"}</p>
    </div>
  );
}
