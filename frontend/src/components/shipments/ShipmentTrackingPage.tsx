"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  FiAlertCircle,
  FiCheckCircle,
  FiChevronDown,
  FiMapPin,
  FiPackage,
  FiSearch,
  FiTruck,
} from "react-icons/fi";
import {
  trackClientShipment,
  type ClientShipmentDetails,
} from "@/lib/clientDashboard";
import {
  listDpdShipments,
  type DpdShipmentHistoryItem,
  type ShipmentEvent,
} from "@/lib/dpdLabels";
import { listShipments, type ShipmentListItem } from "@/lib/shipmentsList";
import { formatDashboardDateTime } from "@/lib/dateFormat";

type TrackingMode = "admin" | "client";
type TrackingRecord = {
  draftId: string;
  consignee: string;
  destination: string;
  status: string;
  statusLabel: string;
  carrierShipmentNumber: string;
  swiftlineTrackingNumber: string;
  parcelNumbers: string[];
  shipmentReference: string;
  branchName: string;
  service: string;
  parcelCount: number;
  createdAt?: string | null;
  events: ShipmentEvent[];
};

type ShipmentTrackingPageProps = {
  mode: TrackingMode;
  title: string;
  description: string;
};

function labelStatus(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string) {
  if (status === "DELIVERED")
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["SHIPMENT_CANCELLED", "RETURNED", "LOST", "DAMAGED"].includes(status))
    return "border-red-200 bg-red-50 text-red-700";
  if (status === "ON_HOLD")
    return "border-amber-200 bg-amber-50 text-amber-800";
  if (["SHIPMENT_BOOKED", "DPD_CREATED", "LABEL_RECEIVED"].includes(status))
    return "border-slate-200 bg-slate-50 text-slate-700";
  return "border-blue-200 bg-blue-50 text-blue-800";
}

function fromAdmin(item: DpdShipmentHistoryItem): TrackingRecord {
  const current = item.currentEvent;
  return {
    draftId: item.dpdShipment.shipmentDraftId,
    consignee: item.shipmentDraft?.consigneeName || "Shipment consignee",
    destination:
      [
        item.shipmentDraft?.consigneeTownOrCity,
        item.shipmentDraft?.deliveryPostcode,
      ]
        .filter(Boolean)
        .join(", ") || "Destination not available",
    status: current?.status || item.dpdShipment.status,
    statusLabel: current?.statusLabel || labelStatus(item.dpdShipment.status),
    carrierShipmentNumber: item.dpdShipment.dpdShipmentId,
    swiftlineTrackingNumber: item.dpdShipment.swiftlineTrackingNumber,
    parcelNumbers: item.dpdShipment.parcelNumbers,
    shipmentReference: item.invoiceUpload?.shipmentReference || "",
    branchName: item.branch ? `${item.branch.name} (${item.branch.code})` : "",
    service:
      item.bookingConfirmation?.serviceType ||
      item.dpdShipment.serviceCode ||
      "",
    parcelCount:
      item.bookingConfirmation?.parcelCount ||
      item.dpdShipment.parcelNumbers.length,
    createdAt: item.dpdShipment.createdAt,
    events: item.events,
  };
}

function fromClient(shipment: ClientShipmentDetails): TrackingRecord {
  const current = shipment.currentEvent;
  return {
    draftId: shipment.shipmentDraft.id,
    consignee:
      shipment.shipmentDraft.consignee.companyName ||
      shipment.shipmentDraft.consignee.contactName ||
      "Shipment consignee",
    destination:
      [
        shipment.shipmentDraft.consignee.townOrCity,
        shipment.shipmentDraft.consignee.postcode,
        shipment.shipmentDraft.consignee.countryName,
      ]
        .filter(Boolean)
        .join(", ") || "Destination not available",
    status:
      current?.status ||
      shipment.dpdShipment?.status ||
      shipment.shipmentDraft.status,
    statusLabel:
      current?.statusLabel ||
      labelStatus(
        shipment.dpdShipment?.status || shipment.shipmentDraft.status,
      ),
    carrierShipmentNumber: shipment.dpdShipment?.dpdShipmentId || "",
    swiftlineTrackingNumber:
      shipment.dpdShipment?.swiftlineTrackingNumber || "",
    parcelNumbers: shipment.dpdShipment?.parcelNumbers || [],
    shipmentReference: shipment.invoiceUpload?.shipmentReference || "",
    branchName: "",
    service:
      shipment.bookingConfirmation?.serviceType ||
      shipment.shipmentDraft.serviceType ||
      "",
    parcelCount: shipment.shipmentDraft.parcelCount,
    createdAt:
      shipment.dpdShipment?.createdAt || shipment.shipmentDraft.createdAt,
    events: shipment.events,
  };
}

/** One selectable piece: the DPD forwarding number with its Swiftline barcode. */
type SelectableParcel = { forwardingNumber: string; swiftlineNumber: string };

function shipmentParcels(shipment: ShipmentListItem): SelectableParcel[] {
  const count = Math.max(
    shipment.forwardingNumbers.length,
    shipment.awbNumbers.length,
  );
  return Array.from({ length: count }, (_, index) => ({
    forwardingNumber: shipment.forwardingNumbers[index] ?? "",
    swiftlineNumber: shipment.awbNumbers[index] ?? "",
  })).filter((parcel) => parcel.forwardingNumber || parcel.swiftlineNumber);
}

function shipmentLabel(shipment: ShipmentListItem) {
  const reference =
    shipment.shipmentReference || shipment.swiftlineTrackingNumber || shipment.id;
  return [reference, shipment.consignee, shipment.destination]
    .filter(Boolean)
    .join(" · ");
}

export default function ShipmentTrackingPage({
  mode,
  title,
  description,
}: ShipmentTrackingPageProps) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<TrackingRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [shipments, setShipments] = useState<ShipmentListItem[]>([]);
  const [selectedShipmentId, setSelectedShipmentId] = useState("");
  // The number the current result was found by, so a parcel-level search can be
  // called out against a timeline that is always shipment level.
  const [trackedNumber, setTrackedNumber] = useState("");

  const loadShipments = useCallback(async () => {
    try {
      setShipments((await listShipments(mode, { limit: 50 })).shipments);
    } catch {
      // The picker is a convenience; manual entry still tracks anything.
      setShipments([]);
    }
  }, [mode]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadShipments(), 0);
    return () => window.clearTimeout(timer);
  }, [loadShipments]);

  const selectedShipment = useMemo(
    () => shipments.find((shipment) => shipment.id === selectedShipmentId) ?? null,
    [selectedShipmentId, shipments],
  );
  const parcels = selectedShipment ? shipmentParcels(selectedShipment) : [];

  const track = useCallback(
    async (value: string) => {
      const trackingNumber = value.trim();
      if (!trackingNumber) {
        setError("Enter a Swiftline, carrier, or parcel tracking number.");
        return;
      }
      setLoading(true);
      setError("");
      setResult(null);
      setSearched(true);
      setTrackedNumber(trackingNumber);
      try {
        if (mode === "client") {
          setResult(
            fromClient((await trackClientShipment(trackingNumber)).shipment),
          );
        } else {
          const matches = (await listDpdShipments(1, trackingNumber)).shipments;
          if (!matches[0])
            throw new Error("No shipment was found for that tracking number.");
          setResult(fromAdmin(matches[0]));
        }
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Tracking information could not be loaded.",
        );
      } finally {
        setLoading(false);
      }
    },
    [mode],
  );

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void track(query);
  }

  function trackParcel(parcelNumber: string) {
    setQuery(parcelNumber);
    void track(parcelNumber);
  }

  const timeline = [...(result?.events ?? [])].sort(
    (left, right) =>
      new Date(left.eventAt).getTime() - new Date(right.eventAt).getTime(),
  );
  // A parcel-level search is one whose number belongs to a piece rather than the
  // shipment itself, whether it was picked from the list or typed by hand.
  const trackedParcel =
    result &&
    [
      ...result.parcelNumbers,
      ...(selectedShipment?.awbNumbers ?? []),
    ].find((number) => number.toLowerCase() === trackedNumber.toLowerCase());
  const detailsHref = result
    ? mode === "client"
      ? `/client/shipments/${result.draftId}`
      : `/dashboard/shipments/${result.draftId}`
    : "#";

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>
      </div>

      <section className="border border-slate-300 bg-white rounded-2xl ">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-950">Find Shipment</h2>
          <p className="mt-1 text-sm text-slate-500">
            Search using a Swiftline tracking number, carrier shipment number,
            or parcel number.
          </p>
        </div>
        <form onSubmit={search} className="flex flex-col gap-3 p-5 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Tracking number</span>
            <FiSearch
              aria-hidden="true"
              className="absolute left-3 top-3.5 h-4 w-4 text-slate-400"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Example: SLDL20072026000001"
              className="h-11  rounded-xl w-full border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-950 outline-none focus:border-blue-900 focus:ring-1 focus:ring-blue-900"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 items-center rounded-4xl justify-center gap-2 bg-blue-950 px-6 text-sm font-semibold text-white hover:bg-blue-900 disabled:bg-slate-400"
          >
            <FiSearch aria-hidden="true" />
            {loading ? "Searching..." : "Track Shipment"}
          </button>
        </form>

        {shipments.length ? (
          <div className="border-t border-slate-200 px-5 py-5">
            <div className="mb-4 flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-slate-200" />
              <span className="text-xs font-semibold uppercase text-slate-400">
                Or pick a parcel
              </span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Select Shipment
              </span>
              <div className="relative mt-2">
                <select
                  value={selectedShipmentId}
                  onChange={(event) => setSelectedShipmentId(event.target.value)}
                  className="h-11 w-full appearance-none rounded-xl border border-slate-300 bg-white px-3 pr-11 text-sm text-slate-950 outline-none transition focus:border-blue-900 focus:ring-1 focus:ring-blue-900"
                >
                  <option value="">Choose from recent shipments</option>
                  {shipments.map((shipment) => (
                    <option key={shipment.id} value={shipment.id}>
                      {shipmentLabel(shipment)}
                    </option>
                  ))}
                </select>
                <FiChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                />
              </div>
            </label>

            {selectedShipment ? (
              parcels.length ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Parcels — select one to track
                  </p>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-4">
                    {parcels.map((parcel) => {
                      const number =
                        parcel.forwardingNumber || parcel.swiftlineNumber;
                      const active =
                        number.toLowerCase() === query.trim().toLowerCase();
                      return (
                        <li key={number}>
                          <button
                            type="button"
                            onClick={() => trackParcel(number)}
                            disabled={loading}
                            className={`w-full rounded-xl border px-4 py-3 text-left transition disabled:opacity-60 ${
                              active
                                ? "border-blue-900 bg-blue-50"
                                : "border-slate-300 bg-white hover:border-blue-900"
                            }`}
                          >
                            <span className="flex items-center  text-sm  tracking-wide text-slate-950">
                              {/* <FiTruck
                                aria-hidden="true"
                                className="h-4 w-4 shrink-0 text-blue-900"
                              /> */}
                              {number}
                            </span>
                            {parcel.swiftlineNumber &&
                            parcel.swiftlineNumber !== number ? (
                              <span className="mt-1 block  text-xs text-slate-500">
                                {parcel.swiftlineNumber}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500">
                  No parcel numbers have been assigned to this shipment yet.
                </p>
              )
            ) : null}
          </div>
        ) : null}
      </section>

      {error ? (
        <div className="mt-5 flex rounded-2xl items-start  der border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <FiAlertCircle className=" shrink-0 mr-2 mt-0.5" />
          <div>
            <p className="font-semibold">
              Unable to find shipment {""}
              {error}
            </p>
          </div>
        </div>
      ) : null}
      {!searched && !result ? (
        <div className="mt-5 border border-dashed border-slate-300 bg-white p-10 text-center rounded-2xl">
          {/* <FiPackage className="mx-auto  h-6 w-6 text-blue-900" />
           */}
           <Image
            src="/logo.svg"
            alt="Track Shipment"
            height={100}
            width={100}
            className="mx-auto h-12 w-30"
          />
        
       
          <p className="mt-3 font-semibold text-slate-900">
            Tracking details will appear here
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Enter one of the tracking numbers printed on the shipment label.
          </p>
        </div>
      ) : null}

      {result ? (
        <div className="mt-5 space-y-5">
          {trackedParcel ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-900">
              <FiTruck aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="font-semibold tracking-wide">Tracking parcel {trackedParcel}</span>
              <span className="text-blue-800">
                of shipment{" "}
                {result.shipmentReference || result.swiftlineTrackingNumber} (
                {result.parcelCount}{" "}
                {result.parcelCount === 1 ? "parcel" : "parcels"}). Events below
                cover the whole shipment.
              </span>
            </div>
          ) : null}

          <section className="border border-slate-100 border-b-0 bg-white rounded-2xl">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">
                  Current Shipment Status
                </p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950">
                  {result.consignee}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {result.swiftlineTrackingNumber ||
                    result.carrierShipmentNumber}
                </p>
              </div>
              <span
                className={`border px-3 py-1.5 text-xs font-semibold uppercase ${statusTone(result.status)}`}
              >
                {result.statusLabel}
              </span>
            </div>
            <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
              <Info
                label="Swiftline Tracking"
                value={result.swiftlineTrackingNumber || "Not assigned"}
              />
              <Info
                label="Carrier Shipment"
                value={result.carrierShipmentNumber || "Not assigned"}
              />
              <Info
                label="Shipment Reference"
                value={result.shipmentReference || "Not provided"}
              />
              <Info
                label="Booked"
                value={formatDashboardDateTime(result.createdAt)}
              />
            </div>
          </section>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="border border-slate-200 bg-white rounded-2xl">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="font-semibold tracking-wide text-slate-950">
                  Shipment Timeline
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Confirmed shipment events from Swiftline operations.
                </p>
              </div>
              <div className="p-5">
                {timeline.length ? (
                  <ol className="relative ml-3 border-l border-slate-300">
                    {timeline.map((item) => (
                      <li
                        key={item.id}
                        className="relative pb-7 pl-7 last:pb-0"
                      >
                        <span className="absolute -left-3 top-0 flex h-6 w-6 items-center justify-center border border-emerald-400 bg-emerald-50 text-emerald-600 rounded">
                          <FiCheckCircle className="h-4 w-4" />
                        </span>
                        <p className="font-semibold tracking-wide text-slate-950">
                          {item.statusLabel || labelStatus(item.status)}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          {formatDashboardDateTime(item.eventAt)}
                        </p>
                        {item.note ? (
                          <p className="mt-1 text-sm text-slate-600">
                            {item.note}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-slate-500">
                    No customer-visible tracking events have been recorded yet.
                  </p>
                )}
              </div>
            </section>

            <aside className="border border-slate-200 bg-white rounded-2xl">
              <div className="border-b border-slate-200 px-5 py-4">
                <h2 className="font-semibold text-slate-950 tracking-wide">
                  Shipment Details
                </h2>
              </div>
              <div className="divide-y divide-slate-200">
                <Detail
                  icon={<FiMapPin />}
                  label="Destination"
                  value={result.destination}
                />
                <Detail
                  icon={<FiPackage />}
                  label="Packages"
                  value={`${result.parcelCount} | ${result.service ? labelStatus(result.service) : "Service not available"}`}
                />
                {result.parcelNumbers.length ? (
                  <div className="flex gap-3 p-5">
                    <span className="mt-0.5 text-blue-900">
                      <FiTruck />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase text-slate-500">
                        Parcel Numbers
                      </p>
                      <ul className="mt-1 space-y-1">
                        {result.parcelNumbers.map((number) => {
                          const active = number === trackedParcel;
                          return (
                            <li
                              key={number}
                              className={`break-words text-sm tracking-wide ${
                                active
                                  ? "font-semibold  text-blue-900"
                                  : "font-medium text-slate-900"
                              }`}
                            >
                              {active ? "▸ " : ""}
                              {number}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                ) : null}
                {result.branchName ? (
                  <Detail
                    icon={<FiMapPin />}
                    label="Assigned Branch"
                    value={result.branchName}
                  />
                ) : null}
              </div>
              <div className="border-t border-slate-200 p-5">
                <Link
                  href={detailsHref}
                  className="inline-flex h-10 w-full items-center justify-center border border-blue-900 text-sm font-semibold text-blue-900 hover:bg-blue-50 rounded-4xl"
                >
                  Open Shipment Details
                </Link>
              </div>
            </aside>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-white px-5 py-4">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-2 break-words text-sm  tracking-wide text-slate-950">
        {value}
      </p>
    </div>
  );
}

function Detail({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3 p-5">
      <span className="mt-0.5 text-blue-900">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase text-slate-500">
          {label}
        </p>
        <p className="mt-1 break-words text-sm  tracking-wide text-slate-900">
          {value}
        </p>
      </div>
    </div>
  );
}
