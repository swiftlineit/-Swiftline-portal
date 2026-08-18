"use client";

import { useEffect, useMemo, useState } from "react";
import { FiCalendar, FiMapPin, FiPackage, FiPhone, FiTruck, FiUser, FiX } from "react-icons/fi";
import { toast } from "react-toastify";
import PickupProofGallery from "@/components/pickups/PickupProofGallery";
import { PickupStatusBadge } from "@/components/pickups/PickupStatusBadge";
import { cancelClientPickup, getClientPickup, rescheduleClientPickup, reschedulableClientPickupStatuses, type PickupDetail } from "@/lib/pickups";

const format = (value?: string | null) => value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not confirmed";
const address = (value: Record<string, string>) => [value.addressLine1, value.addressLine2, value.townOrCity, value.county, value.postcode, value.countryName].filter(Boolean).join(", ");

export default function ClientPickupDetail({ pickupId, onClose, onUpdated }: { pickupId: string; onClose: () => void; onUpdated: (pickup: PickupDetail) => void }) {
  const [pickup, setPickup] = useState<PickupDetail | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [newStartAt, setNewStartAt] = useState("");
  const [newEndAt, setNewEndAt] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void getClientPickup(pickupId).then((result) => { if (active) setPickup(result.pickup); }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Pickup details could not be loaded."); });
    return () => { active = false; };
  }, [pickupId]);

  const latestAttempt = pickup?.attempts[0] ?? null;
  const driver = latestAttempt?.assignedDriverUserId;
  // Mirrors the server: a driver being assigned, or a pickup missed, is still
  // before any collection work, so both remain cancellable.
  const canCancel = pickup && ["REQUESTED", "CONFIRMED", "DRIVER_ASSIGNED", "ACTION_REQUIRED", "MISSED"].includes(pickup.status) && (!latestAttempt || ["SCHEDULED", "ASSIGNED"].includes(latestAttempt.status));
  const canReschedule = pickup && reschedulableClientPickupStatuses.includes(pickup.status);
  const cancelledByName = useMemo(() => {
    if (!pickup?.cancelledBy || typeof pickup.cancelledBy === "string") return "";
    return pickup.cancelledBy.name || `${pickup.cancelledBy.firstName ?? ""} ${pickup.cancelledBy.lastName ?? ""}`.trim();
  }, [pickup]);

  /**
   * Moves the pickup to a new window.
   *
   * The server returns it to REQUESTED, so the panel re-renders as a pickup
   * awaiting confirmation- which is what it now is.
   */
  async function reschedule() {
    if (!pickup || !newStartAt || !newEndAt) return;
    setBusy(true);
    try {
      const result = await rescheduleClientPickup(pickup.id, {
        startAt: new Date(newStartAt).toISOString(),
        endAt: new Date(newEndAt).toISOString()
      });
      setPickup(result.pickup);
      onUpdated(result.pickup);
      setShowReschedule(false);
      setNewStartAt("");
      setNewEndAt("");
      toast.success(result.message);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Pickup could not be rescheduled.");
    } finally { setBusy(false); }
  }

  async function cancel() {
    if (!pickup || reason.trim().length < 3) return;
    setBusy(true);
    try {
      const result = await cancelClientPickup(pickup.id, reason);
      setPickup(result.pickup);
      onUpdated(result.pickup);
      setShowCancel(false);
      toast.success(result.message);
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Pickup could not be cancelled."); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50" role="dialog" aria-modal="true" aria-label="Pickup request details">
    <div className="h-full w-full overflow-y-auto bg-slate-100 shadow-2xl sm:max-w-2xl">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-6"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pickup details</p><h2 className="text-lg font-bold text-slate-950">{pickup?.requestNumber ?? "Loading..."}</h2></div><button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100"><FiX /></button></header>
      <div className="space-y-4 p-4 sm:p-6">
        {error ? <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</p> : null}
        {!pickup && !error ? <div className="space-y-3">{[1, 2, 3, 4].map((item) => <div key={item} className="h-24 animate-pulse rounded-2xl bg-white" />)}</div> : null}
        {pickup ? <>
          <section className="rounded-2xl bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><PickupStatusBadge status={pickup.status} /><span className="text-xs text-slate-500">Created {format(pickup.createdAt)}</span></div><div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-slate-50 p-3"><strong>{pickup.shipmentCount}</strong><p className="text-[11px] text-slate-500">Shipments</p></div><div className="rounded-xl bg-slate-50 p-3"><strong>{pickup.parcelCount}</strong><p className="text-[11px] text-slate-500">Parcels</p></div><div className="rounded-xl bg-slate-50 p-3"><strong>{pickup.totalWeightKg.toFixed(1)}</strong><p className="text-[11px] text-slate-500">kg</p></div></div></section>
          {pickup.status === "CANCELLED" ? <section className="rounded-2xl border border-slate-300 bg-slate-200/70 p-4"><h3 className="font-semibold">Cancellation</h3><p className="mt-2 text-sm">Cancelled by <strong>{pickup.cancellationSource === "CLIENT" ? "Client" : "Swiftline Admin"}</strong>{cancelledByName ? ` (${cancelledByName})` : ""} on {format(pickup.cancelledAt)}.</p><p className="mt-2 text-sm text-slate-600">{pickup.cancellationReason}</p></section> : null}
          <section className="rounded-2xl bg-white p-4 shadow-sm"><h3 className="font-semibold">Collection details</h3><div className="mt-3 space-y-3 text-sm"><p className="flex items-start gap-2"><FiMapPin className="mt-0.5 shrink-0 text-[#0D1282]" />{address(pickup.pickupAddress)}</p><p className="flex items-center gap-2"><FiUser className="text-[#0D1282]" />{pickup.pickupContact.name}</p><p className="flex items-center gap-2"><FiPhone className="text-[#0D1282]" />{pickup.pickupContact.phone}</p><p className="flex items-center gap-2"><FiCalendar className="text-[#0D1282]" />Requested: {format(pickup.requestedWindow.startAt)} - {format(pickup.requestedWindow.endAt)}</p><p className="flex items-center gap-2"><FiCalendar className="text-[#0D1282]" />Confirmed: {format(pickup.confirmedWindow?.startAt)}{pickup.confirmedWindow?.endAt ? ` - ${format(pickup.confirmedWindow.endAt)}` : ""}</p>{pickup.instructions ? <p className="rounded-xl bg-amber-50 p-3 text-amber-900"><strong>Instructions:</strong> {pickup.instructions}</p> : null}</div></section>
          <section className="rounded-2xl bg-white p-4 shadow-sm"><h3 className="font-semibold">Assigned driver</h3>{driver ? <div className="mt-3 rounded-xl bg-slate-50 p-3"><p className="font-semibold">{driver.name || `${driver.firstName ?? ""} ${driver.lastName ?? ""}`}</p><p className="mt-1 text-sm text-slate-600">{driver.phone || "Phone not provided"}</p><p className="mt-2 text-xs font-semibold uppercase text-slate-500">{latestAttempt?.assignedDriverProfileId?.engagementType?.replace(/_/g, " ")} · {latestAttempt?.status.replace(/_/g, " ")}</p>{latestAttempt?.vehicle?.type ? <p className="mt-2 flex items-center gap-2 text-sm"><FiTruck className="text-[#0D1282]" />{latestAttempt.vehicle.type} · {latestAttempt.vehicle.registrationNumber}</p> : null}</div> : <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No driver assigned yet.</p>}</section>
          <section className="rounded-2xl bg-white p-4 shadow-sm"><h3 className="font-semibold">Shipments and parcels</h3><div className="mt-3 space-y-3">{pickup.shipments.map((shipment) => <div key={shipment._id} className="rounded-xl border border-slate-200 p-3"><div className="flex items-center justify-between gap-3"><strong className="text-sm">{shipment.trackingNumber}</strong><PickupStatusBadge status={shipment.status} /></div><div className="mt-2 space-y-1">{shipment.parcels.map((parcel) => <p key={parcel.parcelNumber} className="flex items-center justify-between gap-3 text-xs text-slate-600"><span className="flex items-center gap-1"><FiPackage />{parcel.parcelNumber}</span><span>{parcel.status.replace(/_/g, " ")}</span></p>)}</div></div>)}</div></section>
          {["COLLECTED", "PARTIALLY_COLLECTED"].includes(pickup.status) ? <PickupProofGallery pickupId={pickup.id} attempts={pickup.attempts} audience="client" /> : null}
          {canReschedule ? <section className="rounded-2xl border border-slate-200 bg-white p-4">
            {showReschedule ? <div>
              <h3 className="font-semibold text-slate-900">Reschedule pickup</h3>
              <p className="mt-1 text-sm text-slate-500">Swiftline will confirm the new window before a driver is assigned.</p>
              <label className="mt-3 block text-xs font-semibold uppercase text-slate-500">From</label>
              <input type="datetime-local" value={newStartAt} onChange={(event) => setNewStartAt(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" />
              <label className="mt-3 block text-xs font-semibold uppercase text-slate-500">To</label>
              <input type="datetime-local" value={newEndAt} onChange={(event) => setNewEndAt(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setShowReschedule(false)} className="h-11 rounded-xl border border-slate-300 text-sm font-semibold">Keep window</button>
                <button type="button" disabled={busy || !newStartAt || !newEndAt} onClick={() => void reschedule()} className="h-11 rounded-xl bg-blue-950 text-sm font-semibold text-white disabled:bg-slate-300">Confirm new window</button>
              </div>
            </div> : <button type="button" onClick={() => setShowReschedule(true)} className="h-11 w-full rounded-xl border border-slate-300 text-sm font-semibold text-slate-700">Reschedule pickup</button>}
          </section> : null}
          {canCancel ? <section className="rounded-2xl border border-red-200 bg-white p-4">{showCancel ? <div><h3 className="font-semibold text-red-800">Cancel pickup request</h3><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for cancellation" maxLength={500} className="mt-3 min-h-24 w-full rounded-xl border border-red-300 p-3 text-sm" /><div className="mt-3 grid grid-cols-2 gap-2"><button type="button" onClick={() => setShowCancel(false)} className="h-11 rounded-xl border border-slate-300 text-sm font-semibold">Keep pickup</button><button type="button" disabled={busy || reason.trim().length < 3} onClick={() => void cancel()} className="h-11 rounded-xl bg-red-600 text-sm font-semibold text-white disabled:bg-slate-300">Confirm cancellation</button></div></div> : <button type="button" onClick={() => setShowCancel(true)} className="h-11 w-full rounded-xl border border-red-300 text-sm font-semibold text-red-700">Cancel pickup request</button>}</section> : null}
        </> : null}
      </div>
    </div>
  </div>;
}
