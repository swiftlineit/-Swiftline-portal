"use client";

import { FiAlertTriangle, FiInfo } from "react-icons/fi";
import { csbVClearanceCharge } from "@/lib/csbType";
import type { ShipmentImportSummary } from "@/lib/dpdLabels";

/** Highlights fields that deserve review on drafts prefilled by Shipment Import. */
export default function ShipmentImportBanner({ summary }: { summary: ShipmentImportSummary | null | undefined }) {
  if (!summary) return null;

  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
      <div className="flex items-start gap-3">
        <FiInfo aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-blue-900" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-blue-950">
            Prefilled from your shipment workbook
            {summary.originalFilename ? (
              <span className="font-normal text-blue-900"> ({summary.originalFilename})</span>
            ) : null}
          </p>
          <p className="mt-1 text-xs leading-5 text-blue-900">
            Review before booking - especially the shipment type (CSB-IV / CSB-V), weights and item
            values. CSB-V adds a flat Rs {csbVClearanceCharge.toLocaleString("en-IN")} clearance charge plus GST.
          </p>
        </div>
      </div>

      {summary.warnings.length ? (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-amber-900">
            <FiAlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            Some details could not be read from the uploaded workbook
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-900">
            {summary.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
