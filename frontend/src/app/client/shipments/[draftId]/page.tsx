"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { FiArrowLeft, FiCheckCircle, FiClock, FiFileText, FiMapPin, FiPackage, FiTruck } from "react-icons/fi";
import {
  ClientDashboardLoading,
  ClientDashboardShell,
  ClientShellUser
} from "@/components/client/ClientDashboardShell";
import ShipmentAmendmentPanel from "@/components/shipments/ShipmentAmendmentPanel";
import ShipmentInvoiceHistory from "@/components/shipments/ShipmentInvoiceHistory";
import ShipmentManifestPanel from "@/components/shipments/ShipmentManifestPanel";
import ShipmentCancellationPanel from "@/components/shipments/ShipmentCancellationPanel";
import { ShipmentLabelsPanel } from "@/components/shipments/ShipmentLabelsPanel";
import { apiUrl } from "@/lib/api";
import { getAccessToken, logout, refreshAccessToken } from "@/lib/auth";
import {
  ClientShipmentDetails,
  createClientShipmentAmendment,
  getClientShipmentLabelAccessUrl,
  getClientShipmentDetails,
  previewClientShipmentAmendment
} from "@/lib/clientDashboard";
import { formatDashboardDate, formatDashboardDateTime } from "@/lib/dateFormat";
import { ShipmentAmendmentInput } from "@/lib/dpdLabels";
import {
  getClientShipmentCancellation,
  requestClientShipmentCancellation,
  type ShipmentCancellation
} from "@/lib/shipmentCancellations";

async function loadCurrentUser() {
  let token = getAccessToken() ?? await refreshAccessToken();
  if (!token) return null;

  let response = await fetch(apiUrl("/api/v1/auth/me"), {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (response.status === 401) {
    token = await refreshAccessToken();
    if (!token) return null;

    response = await fetch(apiUrl("/api/v1/auth/me"), {
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  const data = await response.json();
  return data.success ? data.user as ClientShellUser : null;
}

function formatDateTime(value?: string | null) {
  return formatDashboardDateTime(value);
}

function formatLabel(value?: string | null) {
  if (!value) return "Not available";
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatMoneyMinor(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2
  }).format(value / 100);
}

function getDestination(shipment: ClientShipmentDetails) {
  const consignee = shipment.shipmentDraft.consignee;
  return [
    consignee.addressLine1,
    consignee.addressLine2,
    consignee.townOrCity,
    consignee.county,
    consignee.postcode,
    consignee.countryName || consignee.countryCode
  ].filter(Boolean).join(", ");
}

function getShipmentStatus(shipment: ClientShipmentDetails) {
  if (shipment.currentEvent?.statusLabel) return shipment.currentEvent.statusLabel;
  if (shipment.dpdShipment?.status === "LABEL_RECEIVED") return "Shipment Booked";
  if (shipment.dpdShipment?.status === "DPD_CREATED") return "Documents Being Finalized";
  if (shipment.dpdShipment?.status === "DPD_STATUS_UNKNOWN") return "Carrier Confirmation Pending";
  if (shipment.dpdShipment?.status === "DPD_CREATING") return "Booking In Progress";
  if (shipment.dpdShipment?.status === "DPD_REJECTED") return "Booking Failed";
  if (shipment.dpdShipment?.status) return formatLabel(shipment.dpdShipment.status);
  return "Ready for Booking";
}

function getTrackingEvents(shipment: ClientShipmentDetails) {
  const orderedStatuses = [
    "SHIPMENT_BOOKED",
    "PARCEL_COLLECTED",
    "WAREHOUSE_SCAN_IN",
    "EXPORT_CUSTOMS_CLEARED",
    "FLIGHT_ASSIGNED",
    "FLIGHT_DEPARTED",
    "DESTINATION_ARRIVED",
    "IMPORT_CUSTOMS_CLEARANCE",
    "OUT_FOR_DELIVERY",
    "DELIVERED"
  ];
  const sourceEvents = [...shipment.events].reverse();
  const eventsByStatus = new Map(sourceEvents.map((event) => [event.status, event]));
  const events: Array<{ label: string; value: string; done: boolean }> = [];

  if (shipment.dpdShipment && !eventsByStatus.has("SHIPMENT_BOOKED")) {
    events.push({
      label: "Shipment Booked",
      value: `${formatDashboardDate(shipment.dpdShipment.createdAt)} â€¢ Live action updated by Swiftline Operations`,
      done: true
    });
  }

  const cancelledEvent = eventsByStatus.get("SHIPMENT_CANCELLED");
  if (cancelledEvent) {
    for (const status of orderedStatuses) {
      const event = eventsByStatus.get(status);
      if (!event) continue;
      events.push({
        label: event.statusLabel ?? formatLabel(status),
        value: `${formatDashboardDate(event.eventAt)} - ${event.note || "Live action updated by Swiftline Operations"}`,
        done: true
      });
    }
    events.push({
      label: cancelledEvent.statusLabel ?? "Shipment Cancelled",
      value: `${formatDashboardDate(cancelledEvent.eventAt)} - ${cancelledEvent.note}`,
      done: true
    });
    return events;
  }

  for (const status of orderedStatuses) {
    if (status === "SHIPMENT_BOOKED" && shipment.dpdShipment && !eventsByStatus.has(status)) continue;
    const event = eventsByStatus.get(status);
    events.push({
      label: event?.statusLabel ?? formatLabel(status),
      value: event
        ? `${formatDashboardDate(event.eventAt)} • ${event.note || "Live action updated by Swiftline Operations"}`
        : "Pending",
      done: Boolean(event)
    });
  }

  return events;
}

function hasMovedPastParcelCollected(shipment: ClientShipmentDetails | null) {
  const blockedStatuses = new Set([
    "WAREHOUSE_SCAN_IN",
    "EXPORT_CUSTOMS_CLEARED",
    "FLIGHT_ASSIGNED",
    "FLIGHT_DEPARTED",
    "DESTINATION_ARRIVED",
    "IMPORT_CUSTOMS_CLEARANCE",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
    "RETURNED",
    "LOST",
    "DAMAGED"
  ]);

  return Boolean(shipment?.events.some((event) => blockedStatuses.has(event.status)));
}

function hasBeenCollected(shipment: ClientShipmentDetails | null) {
  const collectedOrLater = new Set([
    "PARCEL_COLLECTED", "WAREHOUSE_SCAN_IN", "EXPORT_CUSTOMS_CLEARED", "FLIGHT_ASSIGNED",
    "FLIGHT_DEPARTED", "DESTINATION_ARRIVED", "IMPORT_CUSTOMS_CLEARANCE",
    "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED", "LOST", "DAMAGED"
  ]);
  return Boolean(shipment?.events.some((event) => collectedOrLater.has(event.status)));
}

export default function ClientShipmentDetailsPage() {
  const params = useParams<{ draftId: string }>();
  const router = useRouter();
  const [user, setUser] = useState<ClientShellUser | null>(null);
  const [shipment, setShipment] = useState<ClientShipmentDetails | null>(null);
  const [cancellation, setCancellation] = useState<ShipmentCancellation | null>(null);
  const [cancellationCanRequest, setCancellationCanRequest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [amendmentBusy, setAmendmentBusy] = useState(false);
  const [cancellationBusy, setCancellationBusy] = useState(false);
  const [cancellationError, setCancellationError] = useState("");

  const totalWeight = useMemo(() => (
    shipment?.shipmentDraft.parcelList.reduce((total, parcel) => total + (Number(parcel.weightKg) || 0), 0) ?? 0
  ), [shipment]);

  useEffect(() => {
    let mounted = true;

    async function loadShipment() {
      setLoading(true);
      setError("");

      try {
        const currentUser = await loadCurrentUser();
        if (!currentUser) {
          await logout();
          router.replace("/");
          return;
        }

        if (currentUser.role !== "client") {
          router.replace("/dashboard");
          return;
        }

        const [data, cancellationData] = await Promise.all([
          getClientShipmentDetails(params.draftId),
          getClientShipmentCancellation(params.draftId)
        ]);
        if (!mounted) return;

        setUser(currentUser);
        setShipment(data.shipment);
        setCancellation(cancellationData.cancellation);
        setCancellationCanRequest(cancellationData.canRequest);
      } catch (caughtError) {
        if (!mounted) return;
        setError(caughtError instanceof Error ? caughtError.message : "Unable to load shipment.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadShipment();

    return () => {
      mounted = false;
    };
  }, [params.draftId, router]);

  async function handleAmendment(input: ShipmentAmendmentInput) {
    setAmendmentBusy(true);
    setError("");

    try {
      await createClientShipmentAmendment(params.draftId, input);
      const data = await getClientShipmentDetails(params.draftId);
      setShipment(data.shipment);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Unable to apply amendment.");
      throw caughtError;
    } finally {
      setAmendmentBusy(false);
    }
  }

  async function handleAmendmentPreview(input: ShipmentAmendmentInput) {
    const result = await previewClientShipmentAmendment(params.draftId, input);
    return {
      pricingImpact: result.pricingImpact,
      fundingPreview: result.fundingPreview
    };
  }

  async function handleCancellation(reason: string) {
    setCancellationBusy(true);
    setCancellationError("");
    try {
      const result = await requestClientShipmentCancellation(params.draftId, reason);
      setCancellation(result.cancellation);
    } catch (caughtError) {
      setCancellationError(caughtError instanceof Error ? caughtError.message : "Unable to request cancellation.");
      throw caughtError;
    } finally {
      setCancellationBusy(false);
    }
  }

  if (loading || !user) return <ClientDashboardLoading />;

  return (
    <ClientDashboardShell user={user}>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/client/dashboard" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-900 hover:text-blue-700">
              <FiArrowLeft aria-hidden="true" className="h-4 w-4" />
              Dashboard
            </Link>
            <h1 className="mt-3 text-2xl font-semibold text-slate-950">Shipment Details</h1>
            <p className="mt-1 text-sm text-slate-500">Read-only shipment and label information.</p>
          </div>
          {shipment?.dpdShipment ? (
            <StatusPill
              label={getShipmentStatus(shipment)}
              tone={shipment.dpdShipment.status === "LABEL_RECEIVED" ? "success" : "neutral"}
            />
          ) : (
            <StatusPill label="Ready for Booking" tone="neutral" />
          )}
        </div>

        {error ? (
          <section className="border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">{error}</section>
        ) : !shipment ? (
          <section className="border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-600">Shipment not found.</section>
        ) : (
          <>
            {shipment.dpdShipment?.status === "DPD_CREATED" || shipment.dpdShipment?.status === "DPD_STATUS_UNKNOWN" ? (
              <section className="border border-amber-300 bg-amber-50 px-5 py-4">
                <h2 className="font-semibold text-amber-950">Swiftline Operations is reviewing this booking</h2>
                <p className="mt-1 text-sm text-amber-800">Do not submit it again. Your account allocation remains protected while carrier documents are finalized.</p>
              </section>
            ) : null}
            <section className="border border-slate-200 bg-white">
              <div className="grid gap-0 lg:grid-cols-3">
                <DetailPanel title="Shipment" icon={<FiTruck aria-hidden="true" className="h-4 w-4" />}>
                  <DetailRow label="Shipment Reference" value={shipment.invoiceUpload?.shipmentReference} />
                  <DetailRow label="Invoice Number" value={shipment.invoiceUpload?.invoiceNumber} />
                  <DetailRow label="Current Status" value={getShipmentStatus(shipment)} />
                  <DetailRow label="Updated" value={formatDateTime(shipment.shipmentDraft.updatedAt)} />
                </DetailPanel>

                <DetailPanel title="Booking" icon={<FiFileText aria-hidden="true" className="h-4 w-4" />}>
                  <DetailRow label="Label Provider" value={shipment.dpdShipment?.bookingProvider === "SWIFTLINE" ? "Swiftline Only" : "DPD"} />
                  {shipment.dpdShipment?.bookingProvider !== "SWIFTLINE" ? <DetailRow label="DPD Shipment ID" value={shipment.dpdShipment?.dpdShipmentId || "Pending"} /> : null}
                  <DetailRow label="Swiftline Tracking" value={shipment.dpdShipment?.swiftlineTrackingNumber || "Pending"} />
                  {shipment.dpdShipment?.bookingProvider !== "SWIFTLINE" ? <DetailRow label="Carrier Parcels" value={shipment.dpdShipment?.parcelNumbers.join(", ") || "Pending"} /> : null}
                  <DetailRow label="Booked At" value={formatDateTime(shipment.dpdShipment?.createdAt)} />
                </DetailPanel>

                <DetailPanel title="Parcels" icon={<FiPackage aria-hidden="true" className="h-4 w-4" />}>
                  <DetailRow label="Parcel Count" value={String(shipment.shipmentDraft.parcelCount || shipment.shipmentDraft.parcelList.length)} />
                  <DetailRow label="Total Weight" value={`${totalWeight.toFixed(2)} kg`} />
                  <DetailRow label="Service" value={shipment.shipmentDraft.serviceCode || formatLabel(shipment.shipmentDraft.serviceType)} />
                </DetailPanel>
              </div>
            </section>

            {shipment.bookingConfirmation ? (
              <section className="border border-slate-200 bg-white rounded-2xl ">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h2 className="text-base font-semibold text-slate-950">Booking Confirmation</h2>
                  <p className="mt-1 text-sm text-slate-600">Locked shipment, pricing, and account allocation recorded at booking.</p>
                </div>
                <dl className="grid sm:grid-cols-2 xl:grid-cols-5">
                  <ConfirmationValue label="Customer Reference" value={shipment.bookingConfirmation.customerReference || "Not provided"} />
                  <ConfirmationValue label="Base Charge" value={formatMoneyMinor(shipment.bookingConfirmation.baseAmountMinor)} />
                  <ConfirmationValue label="GST" value={formatMoneyMinor(shipment.bookingConfirmation.gstAmountMinor)} />
                  <ConfirmationValue label="Total" value={formatMoneyMinor(shipment.bookingConfirmation.totalAmountMinor)} emphasis />
                  <ConfirmationValue label="Advance / Credit" value={`${formatMoneyMinor(shipment.bookingConfirmation.advanceAmountMinor)} / ${formatMoneyMinor(shipment.bookingConfirmation.creditAmountMinor)}`} />
                </dl>
              </section>
            ) : null}

            {shipment.dpdShipment && shipment.labels.length ? (
              <ShipmentLabelsPanel
                labels={shipment.labels}
                swiftlineTrackingNumber={shipment.dpdShipment.swiftlineTrackingNumber}
                getAccessUrl={(labelId, disposition) => getClientShipmentLabelAccessUrl(params.draftId, labelId, disposition)}
              />
            ) : null}

            {shipment.dpdShipment ? (
              <>
                <ShipmentInvoiceHistory draftId={params.draftId} audience="client" />
                <ShipmentManifestPanel draftId={params.draftId} audience="client" />
              </>
            ) : null}

            <ShipmentCancellationPanel
              cancellation={cancellation}
              canRequest={cancellationCanRequest && Boolean(shipment.dpdShipment) && !hasBeenCollected(shipment)}
              blockedReason={
                !cancellationCanRequest
                  ? "Your business-account role cannot request shipment cancellation."
                  : shipment.dpdShipment
                    ? "Cancellation is no longer available because the parcel has been collected. Contact your assigned branch."
                  : "Shipment must be booked before cancellation can be requested."
              }
              audience="client"
              busy={cancellationBusy}
              error={cancellationError}
              onRequest={handleCancellation}
            />

            <ShipmentAmendmentPanel
              key={shipment.shipmentDraft.updatedAt ?? shipment.shipmentDraft.id}
              address={shipment.shipmentDraft.consignee}
              parcelList={shipment.shipmentDraft.parcelList}
              serviceType={shipment.shipmentDraft.serviceType ?? "COURIER"}
              canAmend={
                Boolean(shipment.dpdShipment)
                && !hasMovedPastParcelCollected(shipment)
                && cancellation?.status !== "REQUESTED"
                && cancellation?.status !== "COMPLETED"
              }
              blockedReason={
                cancellation?.status === "REQUESTED"
                  ? "Amendments are paused while the cancellation request is under review."
                  : cancellation?.status === "COMPLETED"
                    ? "Cancelled shipments cannot be amended."
                    : shipment.dpdShipment
                  ? "Amendments are blocked after Parcel Collected."
                  : "Shipment must be booked before amendments can be applied."
              }
              busy={amendmentBusy}
              onPreview={handleAmendmentPreview}
              onSubmit={handleAmendment}
            />

            <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="border border-slate-200 bg-white p-5">
                <div className="flex items-center gap-2 text-slate-500">
                  <FiMapPin aria-hidden="true" className="h-4 w-4" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide">Destination</h2>
                </div>
                <p className="mt-4 text-lg font-semibold text-slate-950">
                  {shipment.shipmentDraft.consignee.companyName || shipment.shipmentDraft.consignee.contactName || "Consignee"}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{getDestination(shipment) || "Not available"}</p>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <DetailRow label="Contact" value={shipment.shipmentDraft.consignee.contactName} />
                  <DetailRow label="Email" value={shipment.shipmentDraft.consignee.email} />
                  <DetailRow
                    label="Mobile"
                    value={`${shipment.shipmentDraft.consignee.mobileCountryCode ?? ""} ${shipment.shipmentDraft.consignee.mobileNumber ?? ""}`.trim()}
                  />
                  <DetailRow label="Instructions" value={shipment.shipmentDraft.consignee.deliveryInstructions} />
                </div>
              </div>

              <div className="border border-slate-200 bg-white p-5 rounded-2xl">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Shipment Timeline</h2>
                <div className="mt-5 space-y-4">
                  {getTrackingEvents(shipment).map((event) => (
                    <TimelineItem key={event.label} done={event.done} label={event.label} value={event.value} />
                  ))}
                </div>
              </div>
            </section>

            <section className="border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Parcel Details</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Parcel</th>
                      <th className="px-5 py-3">Contents</th>
                      <th className="px-5 py-3">Weight</th>
                      <th className="px-5 py-3">Dimensions</th>
                      <th className="px-5 py-3">Reference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shipment.shipmentDraft.parcelList.map((parcel) => (
                      <tr key={parcel.sequence}>
                        <td className="px-5 py-3 font-semibold text-slate-950">#{parcel.sequence}</td>
                        <td className="px-5 py-3 text-slate-700">{parcel.contentsDescription || "Not available"}</td>
                        <td className="px-5 py-3 text-slate-700">{parcel.weightKg} kg</td>
                        <td className="px-5 py-3 text-slate-700">
                          {[parcel.lengthCm, parcel.widthCm, parcel.heightCm].filter(Boolean).join(" x ") || "Not available"}
                        </td>
                        <td className="px-5 py-3 text-slate-700">{parcel.shipmentReference1 || parcel.shipmentReference2 || "Not available"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </ClientDashboardShell>
  );
}

function ConfirmationValue({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`min-w-0 border-b border-slate-200 px-5 py-4 sm:border-r xl:border-b-0 ${emphasis ? "bg-blue-950 text-white" : ""}`}>
      <dt className={`text-xs font-semibold uppercase ${emphasis ? "text-blue-100" : "text-slate-500"}`}>{label}</dt>
      <dd className="mt-2 break-words font-semibold">{value}</dd>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "success" | "neutral" }) {
  const classes = tone === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-slate-200 bg-slate-50 text-slate-700";

  return <span className={`border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${classes}`}>{label}</span>;
}

function DetailPanel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="border-b border-slate-200 p-5 lg:border-b-0 lg:border-r lg:last:border-r-0">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
      </div>
      <dl className="mt-5 space-y-4">{children}</dl>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-slate-800">{value || "Not available"}</dd>
    </div>
  );
}

function TimelineItem({ done, label, value }: { done: boolean; label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border ${done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
        {done ? <FiCheckCircle aria-hidden="true" className="h-4 w-4" /> : <FiClock aria-hidden="true" className="h-4 w-4" />}
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-950">{label}</p>
        <p className="mt-0.5 text-xs font-medium text-slate-500">{value}</p>
      </div>
    </div>
  );
}
