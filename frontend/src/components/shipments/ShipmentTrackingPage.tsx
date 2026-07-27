"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { FiAlertCircle, FiCheckCircle, FiMapPin, FiPackage, FiSearch, FiTruck } from "react-icons/fi";
import { trackClientShipment, type ClientShipmentDetails } from "@/lib/clientDashboard";
import { listDpdShipments, type DpdShipmentHistoryItem, type ShipmentEvent } from "@/lib/dpdLabels";
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

type ShipmentTrackingPageProps = { mode: TrackingMode; title: string; description: string };

function labelStatus(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string) {
  if (status === "DELIVERED") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["SHIPMENT_CANCELLED", "RETURNED", "LOST", "DAMAGED"].includes(status)) return "border-red-200 bg-red-50 text-red-700";
  if (status === "ON_HOLD") return "border-amber-200 bg-amber-50 text-amber-800";
  if (["SHIPMENT_BOOKED", "DPD_CREATED", "LABEL_RECEIVED"].includes(status)) return "border-slate-200 bg-slate-50 text-slate-700";
  return "border-blue-200 bg-blue-50 text-blue-800";
}

function fromAdmin(item: DpdShipmentHistoryItem): TrackingRecord {
  const current = item.currentEvent;
  return {
    draftId: item.dpdShipment.shipmentDraftId,
    consignee: item.shipmentDraft?.consigneeName || "Shipment consignee",
    destination: [item.shipmentDraft?.consigneeTownOrCity, item.shipmentDraft?.deliveryPostcode].filter(Boolean).join(", ") || "Destination not available",
    status: current?.status || item.dpdShipment.status,
    statusLabel: current?.statusLabel || labelStatus(item.dpdShipment.status),
    carrierShipmentNumber: item.dpdShipment.dpdShipmentId,
    swiftlineTrackingNumber: item.dpdShipment.swiftlineTrackingNumber,
    parcelNumbers: item.dpdShipment.parcelNumbers,
    shipmentReference: item.invoiceUpload?.shipmentReference || "",
    branchName: item.branch ? `${item.branch.name} (${item.branch.code})` : "",
    service: item.bookingConfirmation?.serviceType || item.dpdShipment.serviceCode || "",
    parcelCount: item.bookingConfirmation?.parcelCount || item.dpdShipment.parcelNumbers.length,
    createdAt: item.dpdShipment.createdAt,
    events: item.events
  };
}

function fromClient(shipment: ClientShipmentDetails): TrackingRecord {
  const current = shipment.currentEvent;
  return {
    draftId: shipment.shipmentDraft.id,
    consignee: shipment.shipmentDraft.consignee.companyName || shipment.shipmentDraft.consignee.contactName || "Shipment consignee",
    destination: [shipment.shipmentDraft.consignee.townOrCity, shipment.shipmentDraft.consignee.postcode, shipment.shipmentDraft.consignee.countryName].filter(Boolean).join(", ") || "Destination not available",
    status: current?.status || shipment.dpdShipment?.status || shipment.shipmentDraft.status,
    statusLabel: current?.statusLabel || labelStatus(shipment.dpdShipment?.status || shipment.shipmentDraft.status),
    carrierShipmentNumber: shipment.dpdShipment?.dpdShipmentId || "",
    swiftlineTrackingNumber: shipment.dpdShipment?.swiftlineTrackingNumber || "",
    parcelNumbers: shipment.dpdShipment?.parcelNumbers || [],
    shipmentReference: shipment.invoiceUpload?.shipmentReference || "",
    branchName: "",
    service: shipment.bookingConfirmation?.serviceType || shipment.shipmentDraft.serviceType || "",
    parcelCount: shipment.shipmentDraft.parcelCount,
    createdAt: shipment.dpdShipment?.createdAt || shipment.shipmentDraft.createdAt,
    events: shipment.events
  };
}

export default function ShipmentTrackingPage({ mode, title, description }: ShipmentTrackingPageProps) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<TrackingRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trackingNumber = query.trim();
    if (!trackingNumber) { setError("Enter a Swiftline, carrier, or parcel tracking number."); return; }
    setLoading(true); setError(""); setResult(null); setSearched(true);
    try {
      if (mode === "client") {
        setResult(fromClient((await trackClientShipment(trackingNumber)).shipment));
      } else {
        const matches = (await listDpdShipments(1, trackingNumber)).shipments;
        if (!matches[0]) throw new Error("No shipment was found for that tracking number.");
        setResult(fromAdmin(matches[0]));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Tracking information could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  const timeline = [...(result?.events ?? [])].sort((left, right) => new Date(left.eventAt).getTime() - new Date(right.eventAt).getTime());
  const detailsHref = result ? (mode === "client" ? `/client/shipments/${result.draftId}` : `/dashboard/shipments/${result.draftId}`) : "#";

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-950">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>
      </div>

      <section className="border border-slate-300 bg-white rounded-2xl ">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold text-slate-950">Find Shipment</h2>
          <p className="mt-1 text-sm text-slate-500">Search using a Swiftline tracking number, carrier shipment number, or parcel number.</p>
        </div>
        <form onSubmit={search} className="flex flex-col gap-3 p-5 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Tracking number</span>
            <FiSearch aria-hidden="true" className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Example: SLDL20072026000001" className="h-11  rounded-xl w-full border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-950 outline-none focus:border-blue-900 focus:ring-1 focus:ring-blue-900" />
          </label>
          <button type="submit" disabled={loading} className="inline-flex h-11 items-center rounded-xl justify-center gap-2 bg-blue-950 px-6 text-sm font-semibold text-white hover:bg-blue-900 disabled:bg-slate-400"><FiSearch aria-hidden="true" />{loading ? "Searching..." : "Track Shipment"}</button>
        </form>
      </section>

      {error ? <div className="mt-5 flex rounded-2xl items-start  der border-red-200 bg-red-50 p-4 text-sm text-red-700"><FiAlertCircle className=" shrink-0" /><div><p className="font-semibold">Unable to find shipment {""}{error}</p></div></div> : null}
      {!searched && !result ? <div className="mt-5 border border-dashed border-slate-300 bg-slate-50 p-10 text-center"><FiPackage className="mx-auto  h-6 w-6 text-blue-900" /><p className="mt-3 font-semibold text-slate-900">Tracking details will appear here</p><p className="mt-1 text-sm text-slate-500">Enter one of the tracking numbers printed on the shipment label.</p></div> : null}

      {result ? <div className="mt-5 space-y-5">
        <section className="border border-b-0 bg-white rounded-2xl">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div><p className="text-xs font-semibold uppercase text-slate-500">Current Shipment Status</p><h2 className="mt-1 text-xl font-semibold text-slate-950">{result.consignee}</h2><p className="mt-1 text-sm text-slate-500">{result.swiftlineTrackingNumber || result.carrierShipmentNumber}</p></div>
            <span className={`border px-3 py-1.5 text-xs font-semibold uppercase ${statusTone(result.status)}`}>{result.statusLabel}</span>
          </div>
          <div className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
            <Info label="Swiftline Tracking" value={result.swiftlineTrackingNumber || "Not assigned"} />
            <Info label="Carrier Shipment" value={result.carrierShipmentNumber || "Not assigned"} />
            <Info label="Shipment Reference" value={result.shipmentReference || "Not provided"} />
            <Info label="Booked" value={formatDashboardDateTime(result.createdAt)} />
          </div>
        </section>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="border border-slate-200 bg-white rounded-2xl">
            <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-950">Shipment Timeline</h2><p className="mt-1 text-sm text-slate-500">Confirmed shipment events from Swiftline operations.</p></div>
            <div className="p-5">
              {timeline.length ? <ol className="relative ml-3 border-l border-slate-300">
                {timeline.map((item) => (
                  <li key={item.id} className="relative pb-7 pl-7 last:pb-0">
                    <span className="absolute -left-3 top-0 flex h-6 w-6 items-center justify-center border border-emerald-400 bg-emerald-50 text-emerald-600 rounded">
                      <FiCheckCircle className="h-4 w-4" />
                    </span>
                    <p className="font-semibold text-slate-950">{item.statusLabel || labelStatus(item.status)}</p>
                    <p className="mt-1 text-sm text-slate-500">{formatDashboardDateTime(item.eventAt)}</p>
                    {item.note ? <p className="mt-1 text-sm text-slate-600">{item.note}</p> : null}
                  </li>
                ))}
              </ol> : <p className="text-sm text-slate-500">No customer-visible tracking events have been recorded yet.</p>}
            </div>
          </section>

          <aside className="border border-slate-200 bg-white rounded-2xl">
            <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-semibold text-slate-950">Shipment Details</h2></div>
            <div className="divide-y divide-slate-200">
              <Detail icon={<FiMapPin />} label="Destination" value={result.destination} />
              <Detail icon={<FiPackage />} label="Packages" value={`${result.parcelCount} | ${result.service ? labelStatus(result.service) : "Service not available"}`} />
              {result.parcelNumbers.length ? <Detail icon={<FiTruck />} label="Parcel Numbers" value={result.parcelNumbers.join(", ")} /> : null}
              {result.branchName ? <Detail icon={<FiMapPin />} label="Assigned Branch" value={result.branchName} /> : null}
            </div>
            <div className="border-t border-slate-200 p-5"><Link href={detailsHref} className="inline-flex h-10 w-full items-center justify-center border border-blue-900 text-sm font-semibold text-blue-900 hover:bg-blue-50 rounded-xl">Open Shipment Details</Link></div>
          </aside>
        </div>
      </div> : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 bg-white px-5 py-4"><p className="text-xs font-semibold uppercase text-slate-500">{label}</p><p className="mt-2 break-words text-sm font-semibold text-slate-950">{value}</p></div>;
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex gap-3 p-5"><span className="mt-0.5 text-blue-900">{icon}</span><div className="min-w-0"><p className="text-xs font-semibold uppercase text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</p></div></div>;
}
