"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  FiCalendar,
  FiMapPin,
  FiPackage,
  FiRefreshCw,
  FiTruck,
  FiUser,
} from "react-icons/fi";
import { toast } from "react-toastify";
import { DashboardLoading } from "@/components/DashboardShell";
import PickupProofGallery from "@/components/pickups/PickupProofGallery";
import {
  PickupNewBadge,
  PickupStatusBadge,
} from "@/components/pickups/PickupStatusBadge";
import type { Driver } from "@/lib/drivers";
import {
  assignInternalPickup,
  cancelInternalPickup,
  confirmInternalPickup,
  getInternalPickup,
  listAvailablePickupDrivers,
  listInternalPickups,
  pickupVehicleTypes,
  reviewInternalPickupOtpException,
  type PickupDetail,
  type PickupSummary,
} from "@/lib/pickups";
import { OPERATIONS_AREA } from "@/lib/roles";
import { useAdminUser } from "@/lib/useAdminUser";

const format = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not confirmed";
const address = (value: Record<string, string>) =>
  [
    value.addressLine1,
    value.addressLine2,
    value.townOrCity,
    value.county,
    value.postcode,
    value.countryName,
  ]
    .filter(Boolean)
    .join(", ");

export default function PickupManagementPage() {
  const { user, loading } = useAdminUser(OPERATIONS_AREA);
  const [pickups, setPickups] = useState<PickupSummary[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selected, setSelected] = useState<PickupDetail | null>(null);
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [driverId, setDriverId] = useState("");
  const [vehicle, setVehicle] = useState({
    source: "DRIVER_OWNED",
    type: "",
    registrationNumber: "",
  });
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const [pickupData, driverData] = await Promise.all([
      listInternalPickups(),
      listAvailablePickupDrivers(),
    ]);
    setPickups(pickupData.pickups);
    setDrivers(driverData.drivers);
  }
  useEffect(() => {
    if (!user) return;
    let active = true;
    void Promise.all([listInternalPickups(), listAvailablePickupDrivers()])
      .then(([pickupData, driverData]) => {
        if (active) {
          setPickups(pickupData.pickups);
          setDrivers(driverData.drivers);
        }
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load pickups.",
          );
      });
    return () => {
      active = false;
    };
  }, [user]);

  async function open(pickup: PickupSummary) {
    setBusy(true);
    setShowCancel(false);
    try {
      setSelected((await getInternalPickup(pickup.id)).pickup);
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "Unable to open pickup.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      const result = await confirmInternalPickup(selected.id, {
        startAt: new Date(windowStart).toISOString(),
        endAt: new Date(windowEnd).toISOString(),
        timezone: "Asia/Kolkata",
      });
      setSelected(result.pickup);
      toast.success("Pickup confirmed.");
      await load();
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "Unable to confirm pickup.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function assign(event: FormEvent) {
    event.preventDefault();
    const attempt = selected?.attempts[0];
    if (!selected || !attempt) return;
    setBusy(true);
    try {
      const result = await assignInternalPickup(selected.id, {
        attemptId: attempt._id,
        driverProfileId: driverId,
        vehicle,
      });
      setSelected(result.pickup);
      toast.success("Driver assigned.");
      await load();
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "Unable to assign driver.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function reviewOtpException(attemptId: string, approved: boolean) {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await reviewInternalPickupOtpException(selected.id, {
        attemptId,
        approved,
      });
      setSelected(result.pickup);
      toast.success(result.message);
      await load();
    } catch (caught) {
      toast.error(
        caught instanceof Error
          ? caught.message
          : "Unable to review OTP exception.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!selected || cancelReason.trim().length < 3) return;
    setBusy(true);
    try {
      const result = await cancelInternalPickup(selected.id, cancelReason);
      setSelected(result.pickup);
      setShowCancel(false);
      setCancelReason("");
      toast.success(result.message);
      await load();
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "Unable to cancel pickup.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <DashboardLoading />;
  const attempt = selected?.attempts[0] ?? null;
  const pendingOtpExceptions =
    selected?.attempts.filter(
      (item) =>
        item.otpExceptionRequestedAt &&
        !item.otpExceptionApprovedAt &&
        !item.otpExceptionRejectedAt,
    ) ?? [];
  const canCancel =
    selected &&
    ["REQUESTED", "CONFIRMED", "ACTION_REQUIRED"].includes(selected.status) &&
    (!attempt || ["SCHEDULED", "ASSIGNED"].includes(attempt.status));
  const cancelledBy =
    selected?.cancelledBy && typeof selected.cancelledBy !== "string"
      ? selected.cancelledBy.name ||
        `${selected.cancelledBy.firstName ?? ""} ${selected.cancelledBy.lastName ?? ""}`.trim()
      : "";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">
            Pickup Requests
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Confirm windows, assign drivers, review proof, and manage
            cancellations.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-300 px-4 text-sm font-semibold"
        >
          <FiRefreshCw />
          Refresh
        </button>
      </div>
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[.75fr_1.25fr]">
        <section className="space-y-3">
          {pickups.map((pickup) => (
            <button
              key={pickup.id}
              onClick={() => void open(pickup)}
              className={`w-full rounded-2xl border bg-white p-4 text-left shadow-sm ${selected?.id === pickup.id ? "border-[#0D1282] ring-2 ring-blue-100" : "border-slate-200"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{pickup.requestNumber}</strong>
                <div className="flex gap-2">
                  {pickup.status === "REQUESTED" ? <PickupNewBadge /> : null}
                  <PickupStatusBadge status={pickup.status} />
                </div>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {pickup.pickupContact.name} · {pickup.parcelCount} parcels
              </p>
              <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                {address(pickup.pickupAddress)}
              </p>
              {pickup.status === "CANCELLED" ? (
                <p className="mt-2 text-xs font-semibold text-slate-600">
                  Cancelled by{" "}
                  {pickup.cancellationSource === "CLIENT" ? "Client" : "Admin"}
                </p>
              ) : null}
            </button>
          ))}
          {!pickups.length ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              No pickup requests found.
            </div>
          ) : null}
        </section>
        <section className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-4">
          {selected ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">
                    {selected.requestNumber}
                  </h2>
                  <div className="mt-2">
                    <PickupStatusBadge status={selected.status} />
                  </div>
                </div>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-[#0D1282]">
                  {selected.shipmentCount} shipments · {selected.parcelCount}{" "}
                  parcels
                </span>
              </div>
              {selected.status === "CANCELLED" ? (
                <div className="rounded-xl border border-slate-300 bg-slate-100 p-4">
                  <strong>
                    Cancelled by{" "}
                    {selected.cancellationSource === "CLIENT"
                      ? "Client"
                      : "Admin"}
                  </strong>
                  {cancelledBy ? <span> ({cancelledBy})</span> : null}
                  <p className="mt-1 text-xs text-slate-500">
                    {format(selected.cancelledAt)}
                  </p>
                  <p className="mt-2 text-sm">{selected.cancellationReason}</p>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <p className="rounded-xl bg-slate-50 p-3 text-sm">
                  <FiUser className="mb-1 text-[#0D1282]" />
                  {selected.pickupContact.name}
                  <br />
                  <span className="text-xs text-slate-500">
                    {selected.pickupContact.phone}
                    <br />
                    {selected.pickupContact.email}
                  </span>
                </p>
                <p className="rounded-xl bg-slate-50 p-3 text-sm">
                  <FiMapPin className="mb-1 text-[#0D1282]" />
                  {address(selected.pickupAddress)}
                </p>
                <p className="rounded-xl bg-slate-50 p-3 text-sm">
                  <FiCalendar className="mb-1 text-[#0D1282]" />
                  Requested
                  <br />
                  <span className="text-xs text-slate-500">
                    {format(selected.requestedWindow.startAt)} -{" "}
                    {format(selected.requestedWindow.endAt)}
                  </span>
                </p>
                <p className="rounded-xl bg-slate-50 p-3 text-sm">
                  <FiPackage className="mb-1 text-[#0D1282]" />
                  {selected.totalWeightKg.toFixed(2)} kg total
                </p>
              </div>
              {["REQUESTED", "PARTIALLY_COLLECTED"].includes(
                selected.status,
              ) ? (
                <form
                  onSubmit={confirm}
                  className="rounded-xl border border-blue-100 bg-blue-50/50 p-4"
                >
                  <h3 className="font-semibold">
                    {selected.status === "PARTIALLY_COLLECTED"
                      ? "Schedule remaining parcels"
                      : "Confirm collection window"}
                  </h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <input
                      required
                      type="datetime-local"
                      value={windowStart}
                      onChange={(event) => setWindowStart(event.target.value)}
                      className="h-11 rounded-xl border border-slate-300 px-3 text-sm"
                    />
                    <input
                      required
                      type="datetime-local"
                      value={windowEnd}
                      onChange={(event) => setWindowEnd(event.target.value)}
                      className="h-11 rounded-xl border border-slate-300 px-3 text-sm"
                    />
                  </div>
                  <button
                    disabled={busy}
                    className="mt-3 h-10 rounded-full bg-[#0D1282] px-4 text-sm font-semibold text-white"
                  >
                    {selected.status === "PARTIALLY_COLLECTED"
                      ? "Schedule retry"
                      : "Confirm pickup"}
                  </button>
                </form>
              ) : null}
              {attempt && ["SCHEDULED", "ASSIGNED"].includes(attempt.status) ? (
                <form
                  onSubmit={assign}
                  className="rounded-xl border border-amber-100 bg-amber-50/50 p-4"
                >
                  <h3 className="font-semibold">Assign driver and vehicle</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <select
                      required
                      value={driverId}
                      onChange={(event) => setDriverId(event.target.value)}
                      className="h-11 rounded-xl border border-slate-300 px-3 text-sm"
                    >
                      <option value="">Select approved driver</option>
                      {drivers.map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          {driver.firstName} {driver.lastName} ·{" "}
                          {driver.engagementType.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                    <select
                      value={vehicle.source}
                      onChange={(event) =>
                        setVehicle((current) => ({
                          ...current,
                          source: event.target.value,
                        }))
                      }
                      className="h-11 rounded-xl border border-slate-300 px-3 text-sm"
                    >
                      <option value="COMPANY_OWNED">Company owned</option>
                      <option value="DRIVER_OWNED">Driver owned</option>
                      <option value="HIRED">Hired</option>
                    </select>
                    <select
                      required
                      value={vehicle.type}
                      onChange={(event) =>
                        setVehicle((current) => ({
                          ...current,
                          type: event.target.value,
                        }))
                      }
                      className="h-11 rounded-xl border border-slate-300 px-3 text-sm"
                    >
                      <option value="">Select vehicle type</option>
                      {pickupVehicleTypes.map((type) => (
                        <option key={type}>{type}</option>
                      ))}
                    </select>
                    <input
                      required
                      placeholder="Registration number"
                      value={vehicle.registrationNumber}
                      onChange={(event) =>
                        setVehicle((current) => ({
                          ...current,
                          registrationNumber: event.target.value,
                        }))
                      }
                      className="h-11 rounded-xl border border-slate-300 px-3 text-sm uppercase"
                    />
                  </div>
                  <button
                    disabled={busy || !driverId}
                    className="mt-3 inline-flex h-10 items-center gap-2 rounded-full bg-amber-500 px-4 text-sm font-semibold text-slate-950"
                  >
                    <FiTruck />
                    Assign driver
                  </button>
                </form>
              ) : null}
              {pendingOtpExceptions.map((item) => (
                <div
                  key={item._id}
                  className="rounded-xl border border-amber-200 bg-amber-50 p-4"
                >
                  <h3 className="font-semibold text-amber-950">
                    OTP exception review
                  </h3>
                  <p className="mt-1 text-sm text-amber-900">
                    {item.otpExceptionReason}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      disabled={busy}
                      onClick={() => void reviewOtpException(item._id, true)}
                      className="h-9 rounded-full bg-emerald-600 px-3 text-xs font-semibold text-white"
                    >
                      Approve exception
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void reviewOtpException(item._id, false)}
                      className="h-9 rounded-full border border-red-300 bg-white px-3 text-xs font-semibold text-red-700"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
              <div className="space-y-2">
                {selected.attempts.map((item) => (
                  <div
                    key={item._id}
                    className="rounded-xl border border-slate-200 p-4 text-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <strong>Attempt {item.sequence}</strong>
                      <PickupStatusBadge status={item.status} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {format(item.scheduledWindow.startAt)} -{" "}
                      {format(item.scheduledWindow.endAt)}
                    </p>
                    {item.assignedDriverUserId ? (
                      <p className="mt-2">
                        Driver:{" "}
                        {item.assignedDriverUserId.name ||
                          `${item.assignedDriverUserId.firstName ?? ""} ${item.assignedDriverUserId.lastName ?? ""}`}
                      </p>
                    ) : (
                      <p className="mt-2 text-slate-500">No driver assigned.</p>
                    )}
                  </div>
                ))}
              </div>
              <PickupProofGallery
                pickupId={selected.id}
                attempts={selected.attempts}
                audience="internal"
              />
              {canCancel ? (
                <div className="rounded-xl border border-red-200 p-4">
                  {showCancel ? (
                    <div>
                      <textarea
                        value={cancelReason}
                        onChange={(event) =>
                          setCancelReason(event.target.value)
                        }
                        placeholder="Cancellation reason"
                        className="min-h-20 w-full rounded-xl border border-red-300 p-3 text-sm"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setShowCancel(false)}
                          className="h-10 rounded-full border border-slate-300 px-4 text-sm font-semibold"
                        >
                          Keep pickup
                        </button>
                        <button
                          type="button"
                          disabled={busy || cancelReason.trim().length < 3}
                          onClick={() => void cancel()}
                          className="h-10 rounded-full bg-red-600 px-4 text-sm font-semibold text-white disabled:bg-slate-300"
                        >
                          Cancel pickup
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowCancel(true)}
                      className="h-10 rounded-full border border-red-300 px-4 text-sm font-semibold text-red-700"
                    >
                      Cancel pickup request
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="py-20 text-center text-sm text-slate-500">
              <FiTruck className="mx-auto mb-3 h-8 w-8" />
              Select a pickup request.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
