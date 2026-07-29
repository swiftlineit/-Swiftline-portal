"use client";

import { useEffect, useState } from "react";
import { FiCheckCircle, FiRefreshCw } from "react-icons/fi";
import {
  ShipmentChargeVerificationPreview,
  ShipmentChargeVerificationState,
  ShipmentDraft,
  VerifiedShipmentParcelInput,
  finalizeFinalShipmentCharge,
  getShipmentChargeVerification,
  previewFinalShipmentCharge
} from "@/lib/dpdLabels";
import { formatDashboardDateTime } from "@/lib/dateFormat";
import { getVolumetricFormula } from "@/lib/shipmentPricing";
import InfoTooltip from "@/components/ui/InfoTooltip";

type Props = {
  dpdShipmentId: string;
  parcelList: ShipmentDraft["parcelList"];
  onFinalized: () => void | Promise<void>;
  onStateChange?: (finalized: boolean) => void;
};

type Measurement = {
  sequence: number;
  actualWeightKg: string;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
};

function formatMinorAmount(amountMinor: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2
  }).format(amountMinor / 100);
}

function initialMeasurements(parcelList: ShipmentDraft["parcelList"]): Measurement[] {
  return parcelList.map((parcel, index) => ({
    sequence: parcel.sequence || index + 1,
    actualWeightKg: String(parcel.weightKg ?? ""),
    lengthCm: String(parcel.lengthCm ?? ""),
    widthCm: String(parcel.widthCm ?? ""),
    heightCm: String(parcel.heightCm ?? "")
  }));
}

export default function ShipmentChargeVerificationPanel({
  dpdShipmentId,
  parcelList,
  onFinalized,
  onStateChange
}: Props) {
  const [state, setState] = useState<ShipmentChargeVerificationState | null>(null);
  const [measurements, setMeasurements] = useState(() => initialMeasurements(parcelList));
  const [preview, setPreview] = useState<ShipmentChargeVerificationPreview | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"PREVIEW" | "FINALIZE" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    getShipmentChargeVerification(dpdShipmentId)
      .then((result) => {
        if (active) {
          setState(result);
          onStateChange?.(result.status === "FINALIZED");
        }
      })
      .catch((caughtError) => {
        if (active) setError(caughtError instanceof Error ? caughtError.message : "Unable to load final charge verification.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [dpdShipmentId, onStateChange]);

  function updateMeasurement(index: number, field: keyof Omit<Measurement, "sequence">, value: string) {
    setMeasurements((current) => current.map((measurement, measurementIndex) => (
      measurementIndex === index ? { ...measurement, [field]: value } : measurement
    )));
    setPreview(null);
    setError("");
  }

  function parsedMeasurements(): VerifiedShipmentParcelInput[] | null {
    const parcels = measurements.map((measurement) => ({
      sequence: measurement.sequence,
      actualWeightKg: Number(measurement.actualWeightKg),
      lengthCm: Number(measurement.lengthCm),
      widthCm: Number(measurement.widthCm),
      heightCm: Number(measurement.heightCm)
    }));

    if (parcels.some((parcel) => (
      !Number.isFinite(parcel.actualWeightKg) || parcel.actualWeightKg <= 0
      || !Number.isFinite(parcel.lengthCm) || parcel.lengthCm <= 0
      || !Number.isFinite(parcel.widthCm) || parcel.widthCm <= 0
      || !Number.isFinite(parcel.heightCm) || parcel.heightCm <= 0
    ))) {
      setError("Enter a valid final weight and all three dimensions for every parcel.");
      return null;
    }

    return parcels;
  }

  async function checkCharges() {
    const parcels = parsedMeasurements();
    if (!parcels) return;

    setBusy("PREVIEW");
    setError("");
    try {
      const result = await previewFinalShipmentCharge(dpdShipmentId, parcels);
      setPreview(result.preview);
    } catch (caughtError) {
      setPreview(null);
      setError(caughtError instanceof Error ? caughtError.message : "Unable to calculate the final shipment charge.");
    } finally {
      setBusy(null);
    }
  }

  async function finalizeCharge() {
    const parcels = parsedMeasurements();
    if (!parcels || !preview) return;

    setBusy("FINALIZE");
    setError("");
    try {
      const result = await finalizeFinalShipmentCharge({
        dpdShipmentId,
        parcels,
        expectedTotalAmountMinor: preview.expectedTotalAmountMinor,
        note
      });
      setState({ status: "FINALIZED", eligible: false, message: "", verification: result.verification });
      onStateChange?.(true);
      setPreview(null);
      await onFinalized();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to finalize the shipment charge.");
    } finally {
      setBusy(null);
    }
  }

  const verification = state?.verification;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Final Weight &amp; Charge</h2>
          <p className="mt-1 text-sm text-slate-600">Verify measured parcel details before Warehouse Scan In.</p>
        </div>
        {verification ? (
          <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
            <FiCheckCircle aria-hidden="true" /> Verified
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="px-5 py-5 text-sm text-slate-600">Loading verification status...</div>
      ) : verification ? (
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-5">
          <Summary label="Previous Charge" value={formatMinorAmount(verification.previousAmountMinor)} />
          <Summary label="Final Charge" value={formatMinorAmount(verification.verifiedAmountMinor)} />
          <Summary
            label="Difference"
            value={`${verification.deltaAmountMinor > 0 ? "+" : ""}${formatMinorAmount(verification.deltaAmountMinor)}`}
          />
          <Summary label="Invoice Revision" value={`Invoice ${verification.invoiceRevision}`} />
          <Summary label="Verified At" value={formatDashboardDateTime(verification.verifiedAt)} />
        </div>
      ) : !state?.eligible ? (
        <div className="px-5 py-5 text-sm font-semibold text-amber-700">
          {state?.message || "Final charge verification is not available for this shipment."}
        </div>
      ) : (
        <div className="space-y-5 p-5">
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div className="overflow-x-auto">
              <table className="min-w-[760px] w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-3">Parcel</th>
                    <th className="px-3 py-3">Actual Weight KG</th>
                    <th className="px-3 py-3">Length CM</th>
                    <th className="px-3 py-3">Width CM</th>
                    <th className="px-3 py-3">Height CM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {measurements.map((measurement, index) => (
                    <tr key={measurement.sequence}>
                      <td className="px-3 py-3 font-semibold text-slate-950">{measurement.sequence}</td>
                      {(["actualWeightKg", "lengthCm", "widthCm", "heightCm"] as const).map((field) => (
                        <td key={field} className="px-3 py-3">
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            value={measurement[field]}
                            onChange={(event) => updateMeasurement(index, field, event.target.value)}
                            aria-label={`Parcel ${measurement.sequence} ${field}`}
                            className="h-10 w-full min-w-28 rounded-lg border border-slate-300 px-3 text-slate-950 outline-none focus:border-blue-900"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {preview ? <VerificationPreview preview={preview} /> : null}

          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-500">Verification Note</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Optional operations note"
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-950 outline-none focus:border-blue-900"
            />
          </label>

          {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div> : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void checkCharges()}
              disabled={Boolean(busy)}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-blue-900 px-4 text-sm font-semibold text-blue-900 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-400"
            >
              <FiRefreshCw aria-hidden="true" />
              {busy === "PREVIEW" ? "Calculating..." : "Check Charges"}
            </button>
            <button
              type="button"
              onClick={() => void finalizeCharge()}
              disabled={Boolean(busy) || !preview?.fundingPreview.canFund}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              <FiCheckCircle aria-hidden="true" />
              {busy === "FINALIZE" ? "Finalizing..." : "Finalize Weight & Charge"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function VerificationPreview({ preview }: { preview: ShipmentChargeVerificationPreview }) {
  const funding = preview.fundingPreview;
  const adjustment = funding.adjustment;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Summary label="Current Charge" value={formatMinorAmount(funding.previousAmountMinor)} />
        <Summary label="Final Charge" value={formatMinorAmount(funding.amendedAmountMinor)} />
        <Summary label="Difference" value={`${funding.deltaAmountMinor > 0 ? "+" : ""}${formatMinorAmount(funding.deltaAmountMinor)}`} />
        <Summary
          label={funding.billingMode === "TEST" ? "Billing Mode" : "Available Capacity"}
          value={funding.billingMode === "TEST" ? "Test - no account charge" : formatMinorAmount(funding.availableBookingCapacityMinor)}
        />
      </div>

      <div className="overflow-x-auto border-t border-slate-200">
        <table className="min-w-[720px] w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <tr>
              <th className="px-3 py-3 text-left">Parcel</th>
              <th className="px-3 py-3 text-right">Actual KG</th>
              <th className="px-3 py-3 text-right">
                <span className="inline-flex items-center gap-1">
                  Volumetric KG
                  <InfoTooltip text={getVolumetricFormula()} />
                </span>
              </th>
              <th className="px-3 py-3 text-right">Chargeable KG</th>
              <th className="px-3 py-3 text-right">Rate / KG</th>
              <th className="px-3 py-3 text-right">Base Charge</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {preview.verifiedPricing.parcels.map((parcel) => (
              <tr key={parcel.sequence}>
                <td className="px-3 py-3 font-semibold text-slate-950">{parcel.sequence}</td>
                <td className="px-3 py-3 text-right">{parcel.actualWeightKg.toFixed(3)}</td>
                <td className="px-3 py-3 text-right">{parcel.volumetricWeightKg.toFixed(3)}</td>
                <td className="px-3 py-3 text-right font-semibold">{parcel.chargeableWeightKg.toFixed(3)}</td>
                <td className="px-3 py-3 text-right">{parcel.chargesPerKg === null ? "Not found" : formatMinorAmount(parcel.chargesPerKg * 100)}</td>
                <td className="px-3 py-3 text-right font-semibold">{formatMinorAmount(parcel.baseAmount * 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adjustment && funding.billingMode === "BUSINESS_ACCOUNT" ? (
        <div className="grid gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm sm:grid-cols-2">
          {funding.deltaAmountMinor >= 0 ? (
            <>
              <FundingItem label="Customer Advance Used" amountMinor={adjustment.advanceUsedMinor} />
              <FundingItem label="Credit Used" amountMinor={adjustment.creditUsedMinor} />
            </>
          ) : (
            <>
              <FundingItem label="Credit Reduced" amountMinor={adjustment.creditReducedMinor} />
              <FundingItem label="Customer Advance Refunded" amountMinor={adjustment.advanceRefundedMinor} />
            </>
          )}
        </div>
      ) : null}

      {preview.exceedsMaxBoxKg ? (
        <p className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          One or more parcels exceed the configured maximum box weight. The displayed charge remains an estimate based on the applicable rate slab.
        </p>
      ) : null}
      {!funding.canFund ? (
        <p className="border-t border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{funding.message}</p>
      ) : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function FundingItem({ label, amountMinor }: { label: string; amountMinor: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-600">{label}</span>
      <span className="font-semibold text-slate-950">{formatMinorAmount(amountMinor)}</span>
    </div>
  );
}
