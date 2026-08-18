import mongoose from "mongoose";
import { DpdShipment } from "../../models/dpdShipment.model.js";
import { ShipmentDraft } from "../../models/shipmentDraft.model.js";
import { ShipmentEvent } from "../../models/shipmentEvent.model.js";
import type { ClaimShipmentSnapshot } from "../../models/claim.model.js";

/**
 * Freezes what a shipment looked like when a claim was filed.
 *
 * A claim is a legal record that can be read years later, and the shipment
 * underneath it keeps moving: amendments change parcels, addresses get
 * corrected, invoices get revised. Referencing the live shipment would mean the
 * claim quietly says something different every time it is opened.
 *
 * So everything a reviewer or a client needs to see is copied here once, at
 * submission, and never refreshed.
 */

/** Rupee floats on the shipment become integer paise on the claim. */
function toMinor(value: number | null | undefined) {
  return Math.round((value ?? 0) * 100);
}

/**
 * Declared value of one parcel, from its items.
 *
 * Recomputed from `quantity x unitRate` rather than read from a total, because
 * the shipment stores no per-parcel total and deriving it here keeps the
 * snapshot's arithmetic self-consistent with the item rows beside it.
 */
function parcelDeclaredValueMinor(parcel: { items?: Array<{ quantity?: number; unitRate?: number }> }) {
  return (parcel.items ?? []).reduce(
    (total, item) => total + toMinor((item.quantity ?? 0) * (item.unitRate ?? 0)),
    0
  );
}

export async function captureShipmentSnapshot(
  shipmentDraftId: mongoose.Types.ObjectId
): Promise<ClaimShipmentSnapshot> {
  const shipment = await ShipmentDraft.findById(shipmentDraftId).lean().exec();
  if (!shipment) throw new Error("Shipment not found.");

  const [booking, collected, delivered] = await Promise.all([
    DpdShipment.findOne({ shipmentDraftId })
      .select("swiftlineTrackingNumber parcelNumbers createdAt")
      .lean()
      .exec(),
    ShipmentEvent.findOne({ shipmentDraftId, status: "PARCEL_COLLECTED" })
      .sort({ eventAt: 1 })
      .select("eventAt")
      .lean()
      .exec(),
    ShipmentEvent.findOne({ shipmentDraftId, status: "DELIVERED" })
      .sort({ eventAt: -1 })
      .select("eventAt")
      .lean()
      .exec()
  ]);

  const parcels = (shipment.parcelList ?? []).map((parcel, index) => ({
    // The sequence the client sees, and half of the coordinate an affected item
    // is recorded against. Falls back to position for older rows that predate
    // the field.
    sequence: parcel.sequence ?? index + 1,
    weightKg: parcel.weightKg ?? 0,
    contentsDescription: parcel.contentsDescription ?? "",
    declaredValueMinor: parcelDeclaredValueMinor(parcel),
    items: (parcel.items ?? []).map((item, itemIndex) => ({
      // The other half of the coordinate. Parcel items have no id of their own,
      // so position within this frozen list is the only stable handle there is.
      itemIndex,
      description: item.description ?? "",
      hsnCode: item.hsnCode ?? "",
      unitType: item.unitType ?? "",
      quantity: item.quantity ?? 0,
      unitRateMinor: toMinor(item.unitRate),
      lineValueMinor: toMinor((item.quantity ?? 0) * (item.unitRate ?? 0))
    }))
  }));

  const consignee =
    shipment.consigneeValidatedAddress ??
    shipment.consigneeSelectedAddress ??
    shipment.consigneeEnteredAddress;

  return {
    shipmentDraftId,
    trackingNumber: booking?.swiftlineTrackingNumber ?? "",
    carrierTrackingNumber: (booking?.parcelNumbers ?? []).join(", "),
    // The booking record's creation is when the shipment became real. The draft's
    // own timestamp would date from when someone first opened the form.
    bookedAt: booking?.createdAt ?? collected?.eventAt ?? new Date(),
    deliveredAt: delivered?.eventAt ?? null,
    serviceName: shipment.serviceCode ?? "",
    originCountryCode: shipment.consignorAddress?.countryCode ?? "IN",
    destinationCountryCode: consignee?.countryCode ?? "",
    consignorName: shipment.consignorAddress?.contactName ?? "",
    consigneeName: consignee?.contactName ?? "",
    parcelCount: parcels.length,
    totalDeclaredValueMinor: parcels.reduce((total, parcel) => total + parcel.declaredValueMinor, 0),
    parcels,
    capturedAt: new Date()
  };
}

/**
 * Resolves an affected-item coordinate against a snapshot.
 *
 * Returns null when the coordinate does not exist, which the caller must treat
 * as a validation failure rather than as an empty item- a claim referencing a
 * parcel that was never in the shipment is malformed, not merely sparse.
 */
export function resolveSnapshotItem(
  snapshot: ClaimShipmentSnapshot,
  coordinate: { parcelSequence: number; itemIndex: number }
) {
  const parcels = snapshot.parcels as Array<{
    sequence: number;
    items: Array<{ itemIndex: number; description: string; quantity: number; unitRateMinor: number }>;
  }>;

  const parcel = parcels.find((entry) => entry.sequence === coordinate.parcelSequence);
  if (!parcel) return null;

  const item = parcel.items.find((entry) => entry.itemIndex === coordinate.itemIndex);
  if (!item) return null;

  return {
    description: item.description,
    quantityShipped: item.quantity,
    declaredUnitValueMinor: item.unitRateMinor
  };
}
