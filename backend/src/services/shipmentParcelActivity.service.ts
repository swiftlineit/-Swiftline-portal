import mongoose from "mongoose";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { FlightLinehaul } from "../models/flightLinehaul.model.js";
import { FlightOffload } from "../models/flightOffload.model.js";
import { ShipmentCancellation } from "../models/shipmentCancellation.model.js";
import { readShipmentBookingSnapshot } from "./shipmentBookingSnapshot.service.js";

export type ShipmentParcelActivity = {
  parcelNumber: string;
  status: "OFFLOADED" | "CANCELLED";
  eventAt: Date;
  reason: string;
  customerMessage: string;
  flightLinehaulId: string | null;
  flightLinehaulNumber: string;
  flightNumber: string;
};

function addActivity(
  target: Map<string, ShipmentParcelActivity[]>,
  shipmentDraftId: unknown,
  activity: ShipmentParcelActivity
) {
  const key = String(shipmentDraftId);
  const current = target.get(key) ?? [];
  current.push(activity);
  target.set(key, current);
}

function shipmentParcelNumbers(shipment: {
  parcelNumbers?: string[];
  currentShipmentSnapshot?: unknown;
  bookingSnapshot?: unknown;
}) {
  const stored = (shipment.parcelNumbers ?? []).map((value) => value.trim().toUpperCase()).filter(Boolean);
  if (stored.length) return [...new Set(stored)];
  const snapshot = readShipmentBookingSnapshot(shipment.currentShipmentSnapshot)
    ?? readShipmentBookingSnapshot(shipment.bookingSnapshot);
  return [...new Set((snapshot?.parcels ?? [])
    .map((parcel) => parcel.swiftlineParcelNumber.trim().toUpperCase())
    .filter(Boolean))];
}

export async function loadShipmentParcelActivitiesByDraftIds(
  shipmentDraftIds: mongoose.Types.ObjectId[]
) {
  const uniqueDraftIds = [...new Map(shipmentDraftIds.map((id) => [String(id), id])).values()];
  const result = new Map<string, ShipmentParcelActivity[]>();
  if (!uniqueDraftIds.length) return result;

  const [offloads, cancellations, shipments] = await Promise.all([
    FlightOffload.find({ "affectedParcels.shipmentDraftId": { $in: uniqueDraftIds } })
      .select("flightLinehaulId detail affectedParcels createdAt")
      .sort({ createdAt: -1 })
      .lean()
      .exec(),
    ShipmentCancellation.find({ shipmentDraftId: { $in: uniqueDraftIds }, status: "COMPLETED" })
      .select("shipmentDraftId reason completedAt reviewedAt updatedAt")
      .sort({ completedAt: -1 })
      .lean()
      .exec(),
    DpdShipment.find({ shipmentDraftId: { $in: uniqueDraftIds } })
      .select("shipmentDraftId parcelNumbers currentShipmentSnapshot bookingSnapshot")
      .lean()
      .exec()
  ]);

  const flightIds = [...new Map(offloads.map((offload) => [String(offload.flightLinehaulId), offload.flightLinehaulId])).values()];
  const flights = flightIds.length
    ? await FlightLinehaul.find({ _id: { $in: flightIds } }).select("flightLinehaulNumber flightNumber").lean().exec()
    : [];
  const flightById = new Map(flights.map((flight) => [String(flight._id), flight]));

  for (const offload of offloads) {
    const flight = flightById.get(String(offload.flightLinehaulId));
    for (const parcel of offload.affectedParcels ?? []) {
      addActivity(result, parcel.shipmentDraftId, {
        parcelNumber: parcel.parcelNumber,
        status: "OFFLOADED",
        eventAt: offload.createdAt,
        reason: offload.detail,
        customerMessage: "This parcel was removed from its scheduled flight and is being handled by Swiftline Operations.",
        flightLinehaulId: offload.flightLinehaulId ? String(offload.flightLinehaulId) : null,
        flightLinehaulNumber: flight?.flightLinehaulNumber ?? "",
        flightNumber: flight?.flightNumber ?? ""
      });
    }
  }

  const shipmentByDraftId = new Map(shipments.map((shipment) => [String(shipment.shipmentDraftId), shipment]));
  for (const cancellation of cancellations) {
    const shipment = shipmentByDraftId.get(String(cancellation.shipmentDraftId));
    const eventAt = cancellation.completedAt ?? cancellation.reviewedAt ?? cancellation.updatedAt;
    for (const parcelNumber of shipment ? shipmentParcelNumbers(shipment) : []) {
      addActivity(result, cancellation.shipmentDraftId, {
        parcelNumber,
        status: "CANCELLED",
        eventAt,
        reason: cancellation.reason,
        customerMessage: "This parcel was cancelled as part of the shipment cancellation.",
        flightLinehaulId: null,
        flightLinehaulNumber: "",
        flightNumber: ""
      });
    }
  }

  for (const activities of result.values()) {
    activities.sort((left, right) => right.eventAt.getTime() - left.eventAt.getTime());
  }
  return result;
}

export async function loadShipmentParcelActivities(shipmentDraftId: mongoose.Types.ObjectId) {
  const byDraftId = await loadShipmentParcelActivitiesByDraftIds([shipmentDraftId]);
  return byDraftId.get(String(shipmentDraftId)) ?? [];
}
