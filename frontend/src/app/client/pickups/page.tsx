"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { FiCalendar, FiMapPin, FiPackage, FiTruck } from "react-icons/fi";
import { toast } from "react-toastify";
import { AddressAutocompleteField } from "@/components/business-accounts/AddressAutocompleteField";
import ClientPickupDetail from "@/components/pickups/ClientPickupDetail";
import { PickupStatusBadge } from "@/components/pickups/PickupStatusBadge";
import {
  emailValidationMessage,
  isValidBusinessContactEmail,
} from "@/lib/businessAccountContactRules";
import {
  createClientPickup,
  listClientPickups,
  listEligiblePickupShipments,
  type EligiblePickupShipment,
  type PickupAddress,
  type PickupDetail,
  type PickupSummary,
} from "@/lib/pickups";

const emptyAddress: PickupAddress = {
  addressLine1: "",
  addressLine2: "",
  townOrCity: "",
  county: "",
  postcode: "",
  countryCode: "IN",
  countryName: "India",
  googlePlaceId: "",
};
const addressLine = (address: Record<string, string>) =>
  [
    address.addressLine1,
    address.addressLine2,
    address.townOrCity,
    address.county,
    address.postcode,
  ]
    .filter(Boolean)
    .join(", ");
const dateTime = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

function ShipmentSkeleton() {
  return (
    <div className="space-y-3" aria-label="Loading eligible booked shipments">
      {[1, 2, 3].map((item) => (
        <div
          key={item}
          className="h-24 animate-pulse rounded-xl border border-slate-100 bg-slate-100"
        >
          <span className="sr-only">Loading shipment</span>
        </div>
      ))}
    </div>
  );
}

export default function ClientPickupsPage() {
  const [eligible, setEligible] = useState<EligiblePickupShipment[]>([]);
  const [pickups, setPickups] = useState<PickupSummary[]>([]);
  const [eligibleLoading, setEligibleLoading] = useState(true);
  const [pickupsLoading, setPickupsLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [contact, setContact] = useState({ name: "", email: "", phone: "" });
  const [pickupAddress, setPickupAddress] =
    useState<PickupAddress>(emptyAddress);
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [instructions, setInstructions] = useState("");
  const [detailId, setDetailId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reloadEligible() {
    setEligibleLoading(true);
    try {
      setEligible((await listEligiblePickupShipments()).shipments);
    } finally {
      setEligibleLoading(false);
    }
  }
  async function reloadPickups() {
    setPickupsLoading(true);
    try {
      setPickups((await listClientPickups()).pickups);
    } finally {
      setPickupsLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void listEligiblePickupShipments()
      .then((result) => {
        if (active) setEligible(result.shipments);
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load eligible shipments.",
          );
      })
      .finally(() => {
        if (active) setEligibleLoading(false);
      });
    void listClientPickups()
      .then((result) => {
        if (active) setPickups(result.pickups);
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load pickups.",
          );
      })
      .finally(() => {
        if (active) setPickupsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedRows = useMemo(
    () => eligible.filter((item) => selected.includes(item.shipmentDraftId)),
    [eligible, selected],
  );
  const selectionKey = selectedRows[0]
    ? `${selectedRows[0].businessAccountId}|${selectedRows[0].branchId}`
    : "";
  const emailError =
    contact.email && !isValidBusinessContactEmail(contact.email)
      ? emailValidationMessage
      : "";

  function toggle(item: EligiblePickupShipment) {
    const selecting = !selected.includes(item.shipmentDraftId);
    setSelected((current) =>
      selecting
        ? [...current, item.shipmentDraftId]
        : current.filter((id) => id !== item.shipmentDraftId),
    );
    if (selecting && !contact.name)
      setContact({
        name: item.pickupAddress.contactName || "",
        email: item.pickupAddress.email || "",
        phone: `${item.pickupAddress.mobileCountryCode || ""}${item.pickupAddress.mobileNumber || ""}`,
      });
    if (selecting && !pickupAddress.addressLine1)
      setPickupAddress({
        addressLine1: item.pickupAddress.addressLine1 || "",
        addressLine2: item.pickupAddress.addressLine2 || "",
        townOrCity:
          item.pickupAddress.townOrCity || item.pickupAddress.city || "",
        county: item.pickupAddress.county || item.pickupAddress.state || "",
        postcode:
          item.pickupAddress.postcode || item.pickupAddress.postalCode || "",
        countryCode: item.pickupAddress.countryCode || "IN",
        countryName: item.pickupAddress.countryName || "India",
        googlePlaceId: "",
      });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!selected.length)
        throw new Error("Select at least one booked shipment.");
      if (!isValidBusinessContactEmail(contact.email))
        throw new Error(emailValidationMessage);
      const result = await createClientPickup({
        shipmentDraftIds: selected,
        requestedWindow: {
          startAt: new Date(startAt).toISOString(),
          endAt: new Date(endAt).toISOString(),
          timezone: "Asia/Kolkata",
        },
        contact,
        pickupAddress,
        instructions,
      });
      toast.success(`${result.pickup.requestNumber} submitted.`);
      setSelected([]);
      setStartAt("");
      setEndAt("");
      setInstructions("");
      setPickupAddress(emptyAddress);
      await Promise.all([reloadEligible(), reloadPickups()]);
      setDetailId(result.pickup.id);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to request pickup.",
      );
    } finally {
      setBusy(false);
    }
  }

  function updatePickup(updated: PickupDetail) {
    setPickups((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    void reloadEligible().catch(() => undefined);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-950">
          Request Pickup
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Select multiple booked shipments from the same client account and
          branch, then choose their collection address.
        </p>
      </div>
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}
      <form onSubmit={submit} className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <FiPackage className="text-[#0D1282]" />
            <h2 className="font-semibold">Eligible booked shipments</h2>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Up to 100 shipments can be combined. After the first selection, only
            another account or branch is disabled.
          </p>
          <div className="mt-4 space-y-3">
            {eligibleLoading ? (
              <ShipmentSkeleton />
            ) : (
              eligible.map((item) => {
                const key = `${item.businessAccountId}|${item.branchId}`;
                const disabled = Boolean(
                  selectionKey &&
                  key !== selectionKey &&
                  !selected.includes(item.shipmentDraftId),
                );
                return (
                  <label
                    key={item.shipmentDraftId}
                    className={`flex items-start gap-3 rounded-xl border p-4 ${disabled ? "cursor-not-allowed bg-slate-50 opacity-55" : selected.includes(item.shipmentDraftId) ? "cursor-pointer border-[#0D1282] bg-blue-50/40" : "cursor-pointer border-slate-200 hover:border-[#0D1282]"}`}
                  >
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={selected.includes(item.shipmentDraftId)}
                      onChange={() => toggle(item)}
                      className="mt-1 h-4 w-4"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-slate-950">
                        {item.trackingNumber}
                      </span>
                      <span className="mt-1 block text-xs text-slate-500">
                        {item.parcelCount} parcel
                        {item.parcelCount === 1 ? "" : "s"} ·{" "}
                        {item.totalWeightKg.toFixed(2)} kg
                      </span>
                      <span className="mt-1 flex items-start gap-1 text-xs text-slate-600">
                        <FiMapPin className="mt-0.5 shrink-0" />
                        Shipment sender: {addressLine(item.pickupAddress)}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
            {!eligibleLoading && !eligible.length ? (
              <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">
                No booked shipments are currently eligible for pickup.
              </p>
            ) : null}
          </div>
        </section>
        <section className="h-fit rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:sticky xl:top-4">
          <h2 className="font-semibold">Pickup details</h2>
          <p className="mt-1 text-xs text-slate-500">
            This collection address is stored on the pickup request and can
            differ from the account address.
          </p>
          <div className="mt-4 grid gap-3">
            <AddressAutocompleteField
              label="Pickup address"
              value={pickupAddress.addressLine1}
              countryName="India"
              required
              onChange={(value) =>
                setPickupAddress((current) => ({
                  ...current,
                  addressLine1: value,
                  googlePlaceId: "",
                }))
              }
              onAddressSelected={(value) =>
                setPickupAddress({
                  addressLine1: value.addressLine1,
                  addressLine2: value.addressLine2,
                  townOrCity: value.city,
                  county: value.state,
                  postcode: value.postalCode,
                  countryCode: value.countryCode,
                  countryName: value.countryName,
                  googlePlaceId: "",
                })
              }
            />
            <input
              placeholder="Building, floor, unit or landmark (optional)"
              value={pickupAddress.addressLine2}
              onChange={(event) =>
                setPickupAddress((current) => ({
                  ...current,
                  addressLine2: event.target.value,
                }))
              }
              className="h-11 rounded-xl border border-slate-300 px-3 text-sm"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                required
                placeholder="City"
                value={pickupAddress.townOrCity}
                onChange={(event) =>
                  setPickupAddress((current) => ({
                    ...current,
                    townOrCity: event.target.value,
                  }))
                }
                className="h-11 rounded-xl border border-slate-300 px-3 text-sm"
              />
              <input
                placeholder="State"
                value={pickupAddress.county}
                onChange={(event) =>
                  setPickupAddress((current) => ({
                    ...current,
                    county: event.target.value,
                  }))
                }
                className="h-11 rounded-xl border border-slate-300 px-3 text-sm"
              />
              <input
                required
                placeholder="PIN code"
                value={pickupAddress.postcode}
                onChange={(event) =>
                  setPickupAddress((current) => ({
                    ...current,
                    postcode: event.target.value,
                  }))
                }
                className="h-11 rounded-xl border border-slate-300 px-3 text-sm"
              />
            </div>
            <div className="my-1 border-t border-slate-200" />
            <input
              required
              placeholder="Pickup contact name"
              value={contact.name}
              onChange={(event) =>
                setContact((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              className="h-11 rounded-xl border border-slate-300 px-3 text-sm"
            />
            <div>
              <input
                required
                placeholder="Pickup contact email"
                type="email"
                value={contact.email}
                onChange={(event) =>
                  setContact((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                className={`h-11 w-full rounded-xl border px-3 text-sm ${emailError ? "border-red-400" : "border-slate-300"}`}
              />
              {emailError ? (
                <p className="mt-1 text-xs font-semibold text-red-600">
                  {emailError}
                </p>
              ) : null}
            </div>
            <input
              required
              type="tel"
              placeholder="Pickup contact phone, e.g. +91 98765 43210"
              value={contact.phone}
              onChange={(event) =>
                setContact((current) => ({
                  ...current,
                  phone: event.target.value,
                }))
              }
              className="h-11 rounded-xl border border-slate-300 px-3 text-sm"
            />
            <label className="text-xs font-semibold uppercase text-slate-500">
              Requested from
              <input
                required
                type="datetime-local"
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal normal-case"
              />
            </label>
            <label className="text-xs font-semibold uppercase text-slate-500">
              Requested until
              <input
                required
                type="datetime-local"
                value={endAt}
                onChange={(event) => setEndAt(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm font-normal normal-case"
              />
            </label>
            <textarea
              placeholder="Floor, access, loading, or collection instructions"
              value={instructions}
              maxLength={500}
              onChange={(event) => setInstructions(event.target.value)}
              className="min-h-24 rounded-xl border border-slate-300 p-3 text-sm"
            />
          </div>
          <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
            <strong>{selected.length}</strong> shipment
            {selected.length === 1 ? "" : "s"} ·{" "}
            <strong>
              {selectedRows.reduce((sum, row) => sum + row.parcelCount, 0)}
            </strong>{" "}
            parcels
          </div>
          <button
            disabled={busy || !selected.length || Boolean(emailError)}
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#0D1282] text-sm font-semibold text-white disabled:bg-slate-400"
          >
            <FiTruck />
            {busy ? "Submitting..." : "Submit pickup request"}
          </button>
        </section>
      </form>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <FiCalendar className="text-[#0D1282]" />
          <h2 className="font-semibold">Your pickup requests</h2>
        </div>
        {pickupsLoading ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-28 animate-pulse rounded-xl bg-slate-100"
              />
            ))}
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pickups.map((pickup) => (
              <button
                type="button"
                key={pickup.id}
                onClick={() => setDetailId(pickup.id)}
                className="rounded-xl border border-slate-200 p-4 text-left transition hover:border-[#0D1282] hover:shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong>{pickup.requestNumber}</strong>
                  <PickupStatusBadge status={pickup.status} />
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {pickup.shipmentCount} shipments · {pickup.parcelCount}{" "}
                  parcels
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Requested {dateTime(pickup.requestedWindow.startAt)}
                </p>
                <p className="mt-3 text-xs font-semibold text-[#0D1282]">
                  Open details
                </p>
              </button>
            ))}
          </div>
        )}
      </section>
      {detailId ? (
        <ClientPickupDetail
          pickupId={detailId}
          onClose={() => setDetailId("")}
          onUpdated={updatePickup}
        />
      ) : null}
    </div>
  );
}
