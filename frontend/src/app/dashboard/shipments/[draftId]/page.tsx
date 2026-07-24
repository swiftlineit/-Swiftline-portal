"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { FiArrowLeft, FiCheckCircle, FiClock, FiFileText, FiMapPin, FiPackage, FiTruck } from "react-icons/fi";
import { toast } from "react-toastify";
import DashboardShell, { DashboardLoading } from "@/components/DashboardShell";
import ShipmentAmendmentPanel from "@/components/shipments/ShipmentAmendmentPanel";
import ShipmentCancellationPanel from "@/components/shipments/ShipmentCancellationPanel";
import ShipmentChargeVerificationPanel from "@/components/shipments/ShipmentChargeVerificationPanel";
import ShipmentInvoiceHistory from "@/components/shipments/ShipmentInvoiceHistory";
import ShipmentManifestPanel from "@/components/shipments/ShipmentManifestPanel";
import { ShipmentLabelsPanel } from "@/components/shipments/ShipmentLabelsPanel";
import {
  DpdShipmentHistoryItem,
  ShipmentAmendmentInput,
  ShipmentHoldReason,
  ShipmentDraft,
  ShipmentOperationalStatus,
  createShipmentAmendment,
  getDpdLabelAccessUrl,
  getShipmentDraft,
  holdDpdShipment,
  listDpdShipments,
  previewShipmentAmendment,
  reconcileDpdShipmentDocuments,
  releaseDpdShipment,
  shipmentHoldReasonOptions,
  shipmentOperationalStatusOptions,
  updateDpdShipmentOperationalStatus
} from "@/lib/dpdLabels";
import { formatDashboardDate, formatDashboardDateTime } from "@/lib/dateFormat";
import {
  getAdminShipmentCancellation,
  requestAdminShipmentCancellation,
  type ShipmentCancellation
} from "@/lib/shipmentCancellations";
import { useAdminUser } from "@/lib/useAdminUser";

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

function getDestination(draft: ShipmentDraft) {
  const consignee = draft.consigneeEnteredAddress;
  return [
    consignee.addressLine1,
    consignee.addressLine2,
    consignee.townOrCity,
    consignee.county,
    consignee.postcode,
    consignee.countryName || consignee.countryCode
  ].filter(Boolean).join(", ");
}

function getShipmentStatus(history: DpdShipmentHistoryItem | null) {
  if (history?.currentEvent?.statusLabel) return history.currentEvent.statusLabel;
  if (history?.dpdShipment.status === "LABEL_RECEIVED") return "Shipment Booked";
  if (history?.dpdShipment.status === "DPD_CREATED") return "Documents Need Review";
  if (history?.dpdShipment.status === "DPD_STATUS_UNKNOWN") return "Carrier Outcome Pending";
  if (history?.dpdShipment.status === "DPD_CREATING") return "Booking In Progress";
  if (history?.dpdShipment.status === "DPD_REJECTED") return "Booking Failed";
  if (history?.dpdShipment.status) return formatLabel(history.dpdShipment.status);
  return "Ready for Booking";
}

function getTrackingEvents(draft: ShipmentDraft, history: DpdShipmentHistoryItem | null) {
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
  const sourceEvents = [...(history?.events ?? [])].reverse();
  const eventsByStatus = new Map(sourceEvents.map((event) => [event.status, event]));
  const events: Array<{ label: string; value: string; done: boolean }> = [];

  if (history?.dpdShipment && !eventsByStatus.has("SHIPMENT_BOOKED")) {
    events.push({
      label: "Shipment Booked",
      value: `${formatDashboardDate(history.dpdShipment.createdAt)} • Live action updated by Swiftline Operations`,
      done: true
    });
  }

  const cancellationEvent = eventsByStatus.get("SHIPMENT_CANCELLED");
  if (cancellationEvent) {
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
      label: cancellationEvent.statusLabel ?? "Shipment Cancelled",
      value: `${formatDashboardDate(cancellationEvent.eventAt)} - ${cancellationEvent.note || "Cancelled by Swiftline Operations"}`,
      done: true
    });
    return events;
  }

  for (const status of orderedStatuses) {
    if (status === "SHIPMENT_BOOKED" && history?.dpdShipment && !eventsByStatus.has(status)) continue;
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

function hasMovedPastParcelCollected(history: DpdShipmentHistoryItem | null) {
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

  return Boolean(history?.events.some((event) => blockedStatuses.has(event.status)));
}

function hasReachedWarehouse(history: DpdShipmentHistoryItem | null) {
  const blockedStatuses = new Set([
    "WAREHOUSE_SCAN_IN", "EXPORT_CUSTOMS_CLEARED", "FLIGHT_ASSIGNED", "FLIGHT_DEPARTED",
    "DESTINATION_ARRIVED", "IMPORT_CUSTOMS_CLEARANCE", "OUT_FOR_DELIVERY", "DELIVERED",
    "RETURNED", "LOST", "DAMAGED"
  ]);
  return Boolean(history?.events.some((event) => blockedStatuses.has(event.status)));
}

export default function AdminShipmentDetailsPage() {
  const params = useParams<{ draftId: string }>();
  const { user, loading } = useAdminUser();
  const [draft, setDraft] = useState<ShipmentDraft | null>(null);
  const [history, setHistory] = useState<DpdShipmentHistoryItem | null>(null);
  const [cancellation, setCancellation] = useState<ShipmentCancellation | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionFeedback, setActionFeedback] = useState<{ message: string; tone: "warning" | "error" } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMode, setActionMode] = useState<"hold" | "release" | "status" | null>(null);
  const [holdReason, setHoldReason] = useState<ShipmentHoldReason>("missing_documents");
  const [nextStatus, setNextStatus] = useState<ShipmentOperationalStatus>("PARCEL_COLLECTED");
  const [actionNote, setActionNote] = useState("");
  const [amendmentBusy, setAmendmentBusy] = useState(false);
  const [chargeVerified, setChargeVerified] = useState(false);
  const [cancellationBusy, setCancellationBusy] = useState(false);
  const [cancellationError, setCancellationError] = useState("");

  const totalWeight = useMemo(() => (
    draft?.parcelList.reduce((total, parcel) => total + (Number(parcel.weightKg) || 0), 0) ?? 0
  ), [draft]);
  const isOnHold = history?.currentEvent?.status === "ON_HOLD";
  const cancellationLocked = cancellation?.status === "REQUESTED" || cancellation?.status === "COMPLETED";

  const loadShipment = useCallback(async () => {
    if (!params.draftId) return;

    setLoadError("");

    try {
      const [draftData, shipmentData, cancellationData] = await Promise.all([
        getShipmentDraft(params.draftId),
        listDpdShipments(100),
        getAdminShipmentCancellation(params.draftId)
      ]);
      const matchingShipment = shipmentData.shipments.find((item) => item.shipmentDraft?.id === params.draftId) ?? null;

      setDraft(draftData.shipmentDraft);
      setHistory(matchingShipment);
      setCancellation(cancellationData.cancellation);
    } catch (caughtError) {
      setLoadError(caughtError instanceof Error ? caughtError.message : "Unable to load shipment.");
    }
  }, [params.draftId]);

  useEffect(() => {
    if (!user || !params.draftId) return;

    let mounted = true;

    async function loadWhenMounted() {
      await Promise.resolve();
      if (!mounted) return;
      await loadShipment();
    }

    void loadWhenMounted();

    return () => {
      mounted = false;
    };
  }, [loadShipment, params.draftId, user]);

  async function handleShipmentAction() {
    if (!history?.dpdShipment || !actionMode) return;
    if ((actionMode === "hold" || actionMode === "release") && actionNote.trim().length < 3) return;

    setActionBusy(true);
    setActionFeedback(null);

    try {
      if (actionMode === "hold") {
        await holdDpdShipment({
          dpdShipmentId: history.dpdShipment.id,
          reason: holdReason,
          note: actionNote
        });
      } else if (actionMode === "release") {
        await releaseDpdShipment({
          dpdShipmentId: history.dpdShipment.id,
          note: actionNote
        });
      } else {
        await updateDpdShipmentOperationalStatus({
          dpdShipmentId: history.dpdShipment.id,
          status: nextStatus,
          note: actionNote || "Live action updated by Swiftline Operations"
        });
      }

      setActionMode(null);
      setActionNote("");
      await loadShipment();
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Shipment action failed.";
      const requiresFinalVerification = message.toLowerCase().includes("verify the final shipment weight and charge");
      setActionFeedback({ message, tone: requiresFinalVerification ? "warning" : "error" });
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDocumentReconciliation() {
    if (!history?.dpdShipment) return;
    setActionBusy(true);
    setActionFeedback(null);
    try {
      const result = await reconcileDpdShipmentDocuments(history.dpdShipment.id);
      toast.success(result.message);
      await loadShipment();
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Shipment documents could not be reconciled.";
      setActionFeedback({ message, tone: "error" });
      toast.error(message);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleAmendment(input: ShipmentAmendmentInput) {
    if (!draft) return;

    setAmendmentBusy(true);
    setActionFeedback(null);

    try {
      await createShipmentAmendment(draft._id, input);
      await loadShipment();
    } catch (caughtError) {
      setActionFeedback({
        message: caughtError instanceof Error ? caughtError.message : "Unable to apply amendment.",
        tone: "error"
      });
      throw caughtError;
    } finally {
      setAmendmentBusy(false);
    }
  }

  async function handleAmendmentPreview(input: ShipmentAmendmentInput) {
    if (!draft) throw new Error("Shipment is not available.");

    const result = await previewShipmentAmendment(draft._id, input);
    return {
      pricingImpact: result.pricingImpact,
      fundingPreview: result.fundingPreview
    };
  }

  async function handleCancellation(reason: string) {
    if (!draft) return;
    setCancellationBusy(true);
    setCancellationError("");
    try {
      const result = await requestAdminShipmentCancellation(draft._id, reason);
      setCancellation(result.cancellation);
      setActionMode(null);
    } catch (caughtError) {
      setCancellationError(caughtError instanceof Error ? caughtError.message : "Unable to request cancellation.");
      throw caughtError;
    } finally {
      setCancellationBusy(false);
    }
  }

  if (loading || !user) return <DashboardLoading />;

  return (
    <DashboardShell user={user}>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link href="/dashboard/dpd-labels" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-900 hover:text-blue-700">
              <FiArrowLeft aria-hidden="true" className="h-4 w-4" />
              Shipments
            </Link>
            <h1 className="mt-3 text-2xl font-semibold text-slate-950">Shipment Details</h1>
            <p className="mt-1 text-sm text-slate-500">Customer-facing shipment view for admin support.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill label={getShipmentStatus(history)} tone={isOnHold ? "warning" : history?.dpdShipment ? "success" : "neutral"} />
            {history?.dpdShipment && !cancellationLocked ? (
              <>
                {!isOnHold ? (
                  <button
                    type="button"
                    onClick={() => {
                      setActionMode("status");
                      setActionNote("");
                    }}
                    className="h-10 border border-blue-900 px-4 text-sm font-semibold text-blue-900 hover:bg-blue-50"
                  >
                    Update Status
                  </button>
                ) : null}
                {isOnHold ? (
                  <button
                    type="button"
                    onClick={() => {
                      setActionMode("release");
                      setActionNote("");
                    }}
                    className="h-10 border border-emerald-700 px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
                  >
                    Release Hold
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setActionMode("hold");
                      setActionNote("");
                    }}
                    className="h-10 border border-amber-700 px-4 text-sm font-semibold text-amber-700 hover:bg-amber-50"
                  >
                    Put On Hold
                  </button>
                )}
              </>
            ) : null}
          </div>
        </div>

        {loadError ? (
          <section className="border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">{loadError}</section>
        ) : !draft ? (
          <section className="border border-slate-200 bg-white p-5 text-sm font-semibold text-slate-600">Shipment not found.</section>
        ) : (
          <>
            {actionFeedback ? (
              <section
                role={actionFeedback.tone === "error" ? "alert" : "status"}
                className={`border p-4 text-sm font-medium ${
                  actionFeedback.tone === "warning"
                    ? "border-amber-300 bg-amber-50 text-amber-900"
                    : "border-red-200 bg-red-50 text-red-700"
                }`}
              >
                {actionFeedback.message}
              </section>
            ) : null}
            {actionMode ? (
              <section className="border border-slate-200 bg-white p-5">
                <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_auto] lg:items-end">
                  {actionMode === "hold" ? (
                    <label>
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hold Reason</span>
                      <select
                        value={holdReason}
                        onChange={(event) => setHoldReason(event.target.value as ShipmentHoldReason)}
                        className="mt-2 h-10 w-full border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 focus:border-blue-900 focus:outline-none"
                      >
                        {shipmentHoldReasonOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  ) : actionMode === "status" ? (
                    <label>
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Shipment Status</span>
                      <select
                        value={nextStatus}
                        onChange={(event) => setNextStatus(event.target.value as ShipmentOperationalStatus)}
                        className="mt-2 h-10 w-full border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 focus:border-blue-900 focus:outline-none"
                      >
                        {shipmentOperationalStatusOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Release Action</p>
                      <p className="mt-2 text-sm font-semibold text-slate-950">Release shipment from hold</p>
                    </div>
                  )}
                  <label>
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {actionMode === "hold" ? "Hold Note" : "Release Note"}
                    </span>
                    <input
                      value={actionNote}
                      onChange={(event) => setActionNote(event.target.value)}
                      placeholder={actionMode === "hold" ? "Explain why this shipment is on hold" : actionMode === "release" ? "Explain why this shipment can continue" : "Optional status note"}
                      className="mt-2 h-10 w-full border border-slate-300 px-3 text-sm text-slate-900 focus:border-blue-900 focus:outline-none"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleShipmentAction}
                      disabled={actionBusy || ((actionMode === "hold" || actionMode === "release") && actionNote.trim().length < 3)}
                      className="h-10 bg-blue-900 px-4 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                    >
                      {actionBusy ? "Saving..." : actionMode === "hold" ? "Hold" : actionMode === "release" ? "Release" : "Update"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActionMode(null);
                        setActionNote("");
                      }}
                      className="h-10 border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:border-slate-500"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </section>
        ) : null}

        {history?.dpdShipment.status === "DPD_CREATED" ? (
          <section className="flex flex-wrap items-center justify-between gap-4 border border-amber-300 bg-amber-50 px-5 py-4">
            <div>
              <h2 className="font-semibold text-amber-950">Carrier booking accepted, documents need review</h2>
              <p className="mt-1 text-sm text-amber-800">Finalize the saved booking without submitting another request to DPD.</p>
            </div>
            <button
              type="button"
              onClick={handleDocumentReconciliation}
              disabled={actionBusy}
              className="h-10 border border-amber-700 bg-white px-4 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
            >
              {actionBusy ? "Finalizing..." : "Finalize Documents"}
            </button>
          </section>
        ) : null}

        {history?.dpdShipment.status === "DPD_STATUS_UNKNOWN" ? (
          <section className="border border-red-300 bg-red-50 px-5 py-4">
            <h2 className="font-semibold text-red-950">Carrier outcome requires confirmation</h2>
            <p className="mt-1 text-sm text-red-800">Do not submit this shipment again. Confirm the booking directly with DPD before releasing or completing it.</p>
          </section>
        ) : null}

            <section className="border border-slate-200 bg-white">
              <div className="grid gap-0 lg:grid-cols-3">
                <DetailPanel title="Shipment" icon={<FiTruck aria-hidden="true" className="h-4 w-4" />}>
                  <DetailRow label="Shipment Reference" value={history?.invoiceUpload?.shipmentReference} />
                  <DetailRow label="Invoice Number" value={history?.invoiceUpload?.invoiceNumber} />
                  <DetailRow label="Current Status" value={getShipmentStatus(history)} />
                  <DetailRow label="Updated" value={formatDateTime(history?.dpdShipment.updatedAt)} />
                </DetailPanel>

                <DetailPanel title="Booking" icon={<FiFileText aria-hidden="true" className="h-4 w-4" />}>
                  <DetailRow label="Label Provider" value={history?.dpdShipment.bookingProvider === "SWIFTLINE" ? "Swiftline Only" : "DPD"} />
                  {history?.dpdShipment.bookingProvider !== "SWIFTLINE" ? <DetailRow label="DPD Shipment ID" value={history?.dpdShipment.dpdShipmentId || "Pending"} /> : null}
                  <DetailRow label="Swiftline Tracking" value={history?.dpdShipment.swiftlineTrackingNumber || "Pending"} />
                  {history?.dpdShipment.bookingProvider !== "SWIFTLINE" ? <DetailRow label="Carrier Parcels" value={history?.dpdShipment.parcelNumbers.join(", ") || "Pending"} /> : null}
                  <DetailRow label="Booked At" value={formatDateTime(history?.dpdShipment.createdAt)} />
                </DetailPanel>

                <DetailPanel title="Parcels" icon={<FiPackage aria-hidden="true" className="h-4 w-4" />}>
                  <DetailRow label="Parcel Count" value={String(draft.parcelCount || draft.parcelList.length)} />
                  <DetailRow label="Total Weight" value={`${totalWeight.toFixed(2)} kg`} />
                  <DetailRow label="Service" value={draft.serviceCode || formatLabel(draft.serviceType)} />
                </DetailPanel>
              </div>
            </section>

            {history?.bookingConfirmation && (history.shipmentInvoice?.revision ?? 1) === 1 ? (
              <section className="border border-slate-200 bg-white">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h2 className="text-base font-semibold text-slate-950">Booking Confirmation</h2>
                  <p className="mt-1 text-sm text-slate-600">Locked shipment, pricing, and account allocation recorded at booking.</p>
                </div>
                <dl className="grid sm:grid-cols-2 xl:grid-cols-5">
                  <ConfirmationValue label="Customer Reference" value={history.bookingConfirmation.customerReference || "Not provided"} />
                  <ConfirmationValue label="Base Charge" value={formatMoneyMinor(history.bookingConfirmation.baseAmountMinor)} />
                  <ConfirmationValue label="GST" value={formatMoneyMinor(history.bookingConfirmation.gstAmountMinor)} />
                  <ConfirmationValue label="Total" value={formatMoneyMinor(history.bookingConfirmation.totalAmountMinor)} emphasis />
                  <ConfirmationValue label="Advance / Credit" value={`${formatMoneyMinor(history.bookingConfirmation.advanceAmountMinor)} / ${formatMoneyMinor(history.bookingConfirmation.creditAmountMinor)}`} />
                </dl>
              </section>
            ) : null}

            {history?.labels.length ? (
              <ShipmentLabelsPanel
                labels={history.labels}
                swiftlineTrackingNumber={history.dpdShipment.swiftlineTrackingNumber}
                getAccessUrl={(labelId, disposition) => getDpdLabelAccessUrl(history.dpdShipment.id, labelId, disposition)}
              />
            ) : null}

            {history?.dpdShipment ? (
              <>
                <ShipmentInvoiceHistory draftId={draft._id} audience="admin" />
                <ShipmentManifestPanel draftId={draft._id} audience="admin" />
              </>
            ) : null}

            <ShipmentCancellationPanel
              cancellation={cancellation}
              canRequest={Boolean(history?.dpdShipment) && !hasReachedWarehouse(history)}
              blockedReason={history?.dpdShipment
                ? "Admin cancellation is blocked after Warehouse Scan In."
                : "Shipment must be booked before cancellation can be requested."}
              audience="admin"
              busy={cancellationBusy}
              error={cancellationError}
              onRequest={handleCancellation}
            />

            {history?.dpdShipment && !cancellationLocked ? (
              <ShipmentChargeVerificationPanel
                dpdShipmentId={history.dpdShipment.id}
                parcelList={draft.parcelList}
                onStateChange={setChargeVerified}
                onFinalized={loadShipment}
              />
            ) : null}

            <ShipmentAmendmentPanel
              key={draft.updatedAt ?? draft._id}
              address={draft.consigneeEnteredAddress}
              parcelList={draft.parcelList}
              serviceType={draft.serviceType ?? "COURIER"}
              canAmend={Boolean(history?.dpdShipment) && !hasMovedPastParcelCollected(history) && !chargeVerified && !cancellationLocked}
              blockedReason={
                cancellation?.status === "REQUESTED"
                  ? "Amendments are paused while the cancellation request is under review."
                  : cancellation?.status === "COMPLETED"
                    ? "Cancelled shipments cannot be amended."
                    : chargeVerified
                  ? "Amendments are blocked after final charge verification."
                  : history?.dpdShipment
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
                  {draft.consigneeEnteredAddress.companyName || draft.consigneeEnteredAddress.contactName || "Consignee"}
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{getDestination(draft) || "Not available"}</p>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <DetailRow label="Contact" value={draft.consigneeEnteredAddress.contactName} />
                  <DetailRow label="Email" value={draft.consigneeEnteredAddress.email} />
                  <DetailRow
                    label="Mobile"
                    value={`${draft.consigneeEnteredAddress.mobileCountryCode ?? ""} ${draft.consigneeEnteredAddress.mobileNumber ?? ""}`.trim()}
                  />
                  <DetailRow label="Instructions" value={draft.consigneeEnteredAddress.deliveryInstructions} />
                </div>
              </div>

              <div className="border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Shipment Timeline</h2>
                <div className="mt-5 space-y-4">
                  {getTrackingEvents(draft, history).map((event) => (
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
                    {draft.parcelList.map((parcel) => (
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
    </DashboardShell>
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

function StatusPill({ label, tone }: { label: string; tone: "success" | "neutral" | "warning" }) {
  const classes = tone === "success"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-700"
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
