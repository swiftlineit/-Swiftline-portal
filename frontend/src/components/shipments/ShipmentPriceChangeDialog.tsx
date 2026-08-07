"use client";

import { FiAlertTriangle } from "react-icons/fi";
import {
  formatEstimateMoney,
  type ShipmentChargeLineCode,
  type ShipmentPricing
} from "@/lib/shipmentCostEstimate";

type ChangedLine = {
  code: ShipmentChargeLineCode | "TOTAL";
  label: string;
  previousMinor: number | null;
  currentMinor: number | null;
};

/**
 * Compares the price the customer accepted with the price the shipment now
 * prices at, listing only the lines that actually moved.
 *
 * A line that has appeared or disappeared is included with a null on the side it
 * is missing from, so a newly applied surcharge is as visible as a changed one.
 */
function getChangedLines(previous: ShipmentPricing | null, current: ShipmentPricing): ChangedLine[] {
  const previousByCode = new Map((previous?.lines ?? []).map((line) => [line.code, line]));
  const currentByCode = new Map(current.lines.map((line) => [line.code, line]));
  const codes = [...new Set([...previousByCode.keys(), ...currentByCode.keys()])];

  const changed: ChangedLine[] = codes
    .map((code) => {
      const before = previousByCode.get(code);
      const after = currentByCode.get(code);
      return {
        code,
        label: after?.label ?? before?.label ?? code,
        previousMinor: before?.amountMinor ?? null,
        currentMinor: after?.amountMinor ?? null
      };
    })
    .filter((line) => line.previousMinor !== line.currentMinor);

  // Ordered by the current breakdown so the dialog reads in the same order as the
  // panel behind it, with the total last.
  const order = current.lines.map((line) => line.code);
  changed.sort((first, second) => order.indexOf(first.code as ShipmentChargeLineCode) - order.indexOf(second.code as ShipmentChargeLineCode));

  const previousTotalMinor = previous ? Math.round(previous.totalAmount * 100) : null;
  const currentTotalMinor = Math.round(current.totalAmount * 100);
  if (previousTotalMinor !== currentTotalMinor) {
    changed.push({
      code: "TOTAL",
      label: "Total payable",
      previousMinor: previousTotalMinor,
      currentMinor: currentTotalMinor
    });
  }

  return changed;
}

/**
 * Asks for explicit consent to a price that changed after it was quoted.
 *
 * Booking is blocked server-side until the new price is accepted, so this dialog
 * is the only way forward — a customer is never charged a figure they did not
 * confirm, and they are told exactly which charge moved and by how much.
 */
export default function ShipmentPriceChangeDialog({
  previousPricing,
  currentPricing,
  message,
  busy,
  onAccept,
  onCancel
}: {
  /** The breakdown the customer had accepted, or null if the panel had none. */
  previousPricing: ShipmentPricing | null;
  currentPricing: ShipmentPricing;
  message: string;
  busy: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const changedLines = getChangedLines(previousPricing, currentPricing);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shipment-price-change-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
    >
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
            <FiAlertTriangle aria-hidden="true" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="shipment-price-change-title" className="text-base font-semibold text-slate-950">
              The price for this shipment changed
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">{message}</p>
          </div>
        </div>

        <div className="space-y-5 px-5 py-4">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">What changed</h3>
            <dl className="mt-3 space-y-2">
              {changedLines.map((line) => (
                <div key={line.code} className="flex items-center justify-between gap-3 text-sm">
                  <dt className={line.code === "TOTAL" ? "font-semibold text-slate-950" : "text-slate-700"}>
                    {line.label}
                  </dt>
                  <dd className="flex items-center gap-2 whitespace-nowrap">
                    <span className="text-slate-500 line-through">
                      {line.previousMinor === null ? "Not charged" : formatEstimateMoney(line.previousMinor)}
                    </span>
                    <span aria-hidden="true" className="text-slate-400">-&gt;</span>
                    <span className={line.code === "TOTAL" ? "font-bold text-blue-900" : "font-semibold text-slate-950"}>
                      {line.currentMinor === null ? "No longer charged" : formatEstimateMoney(line.currentMinor)}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">New charge summary</h3>
                <p className="mt-1 text-xs text-slate-600">This is the price that will be used after you accept it.</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total payable</p>
                <p className="mt-1 text-xl font-bold text-blue-900">
                  {formatEstimateMoney(Math.round(currentPricing.totalAmount * 100))}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3 border-t border-blue-100 pt-3">
              {currentPricing.parcels.map((parcel) => (
                <div key={parcel.sequence} className="rounded-lg border border-white bg-white px-3 py-2 text-xs text-slate-600">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-slate-950">Box {parcel.sequence}</span>
                    <span className="font-semibold text-slate-900">{parcel.chargeableWeightKg.toFixed(2)} kg chargeable</span>
                  </div>
                  <p className="mt-1">Actual {parcel.actualWeightKg.toFixed(2)} kg · Volumetric {parcel.volumetricWeightKg.toFixed(2)} kg</p>
                  <p>{parcel.chargesPerKg === null ? "No matching rate slab" : `${formatEstimateMoney(Math.round(parcel.chargesPerKg * 100))} / kg`}</p>
                </div>
              ))}
            </div>

            <dl className="mt-3 space-y-2 border-t border-blue-100 pt-3">
              {currentPricing.lines.map((line) => (
                <div key={line.code} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <dt className="font-medium text-slate-700">{line.label}</dt>
                    <dd className="mt-0.5 text-xs leading-4 text-slate-500">{line.basis}</dd>
                  </div>
                  <dd className={`whitespace-nowrap font-semibold ${line.kind === "DEDUCTION" ? "text-emerald-700" : "text-slate-950"}`}>
                    {line.kind === "DEDUCTION" ? "-" : ""}{formatEstimateMoney(line.amountMinor)}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="mt-3 border-t border-blue-100 pt-3 text-xs text-slate-600">
              <p className="font-semibold text-slate-800">Tax summary</p>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
                <span>GST: {formatEstimateMoney(Math.round(currentPricing.gstAmount * 100))}</span>
                <span>Declared goods value: {formatEstimateMoney(Math.round(currentPricing.declaredGoodsValue * 100))}</span>
              </div>
            </div>
          </section>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:border-slate-400 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            Cancel booking
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={busy}
            className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-900 px-4 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {busy ? "Applying charges..." : "Accept new charges"}
          </button>
        </div>
      </div>
    </div>
  );
}
