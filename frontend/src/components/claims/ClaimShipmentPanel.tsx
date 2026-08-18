import { formatDashboardDate, formatDashboardDateTime } from "@/lib/dateFormat";
import { formatClaimAmount, type ClaimShipmentSnapshot } from "@/lib/claims";

/**
 * The shipment, exactly as it was when the claim was filed.
 *
 * Read-only on purpose. These are frozen snapshot values, not live form fields-
 * an amendment months later must not change what a reviewer sees, and letting a
 * client edit them here would imply otherwise.
 */
export default function ClaimShipmentPanel({
  snapshot,
  compact = false
}: {
  snapshot: ClaimShipmentSnapshot;
  compact?: boolean;
}) {
  const facts: Array<[string, string]> = [
    ["Swiftline tracking", snapshot.trackingNumber || "-"],
    ["Carrier tracking", snapshot.carrierTrackingNumber || "-"],
    ["Booked", formatDashboardDate(snapshot.bookedAt)],
    ["Delivered", snapshot.deliveredAt ? formatDashboardDate(snapshot.deliveredAt) : "Not delivered"],
    ["Service", snapshot.serviceName || "-"],
    ["Route", `${snapshot.originCountryCode} → ${snapshot.destinationCountryCode}`],
    ["Consignor", snapshot.consignorName || "-"],
    ["Consignee", snapshot.consigneeName || "-"],
    ["Parcels", String(snapshot.parcelCount)],
    ["Declared value", formatClaimAmount(snapshot.totalDeclaredValueMinor)]
  ];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white">
      <header className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
          Shipment details
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Recorded when the claim was raised on {formatDashboardDateTime(snapshot.capturedAt)}.
        </p>
      </header>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
            <dd className="mt-0.5 text-sm font-medium text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>

      {compact ? null : (
        <div className="border-t border-slate-200 px-5 py-4">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-600">
            Parcels and contents
          </h3>
          <div className="space-y-4">
            {snapshot.parcels.map((parcel) => (
              <div key={parcel.sequence} className="rounded-xl border border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                  <p className="text-sm font-semibold text-slate-900">
                    Parcel {parcel.sequence}
                    <span className="ml-2 font-normal text-slate-500">{parcel.weightKg} kg</span>
                  </p>
                  <p className="text-sm font-semibold text-slate-900">
                    {formatClaimAmount(parcel.declaredValueMinor)}
                  </p>
                </div>

                {parcel.items.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-slate-500">
                    {parcel.contentsDescription || "No itemised contents recorded."}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="text-xs font-semibold uppercase text-slate-500">
                        <tr>
                          <th className="px-4 py-2">Item</th>
                          <th className="px-4 py-2">HS code</th>
                          <th className="px-4 py-2 text-right">Qty</th>
                          <th className="px-4 py-2 text-right">Unit value</th>
                          <th className="px-4 py-2 text-right">Line value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parcel.items.map((item) => (
                          <tr key={item.itemIndex}>
                            <td className="px-4 py-2 text-slate-900">{item.description || "-"}</td>
                            <td className="px-4 py-2 text-slate-500">{item.hsnCode || "-"}</td>
                            <td className="px-4 py-2 text-right text-slate-700">
                              {item.quantity} {item.unitType}
                            </td>
                            <td className="px-4 py-2 text-right text-slate-700">
                              {formatClaimAmount(item.unitRateMinor)}
                            </td>
                            <td className="px-4 py-2 text-right font-medium text-slate-900">
                              {formatClaimAmount(item.lineValueMinor)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
