import type { IShipmentDraft } from "../models/shipmentDraft.model.js";

type ShipmentReferenceDraft = Pick<IShipmentDraft, "_id" | "parcelList">;

export function customerShipmentReference(draft: ShipmentReferenceDraft) {
  return draft.parcelList
    .map((parcel) => parcel.shipmentReference1?.trim() ?? "")
    .find(Boolean) ?? "";
}

/**
 * Carrier APIs require both an invoice and shipment reference even though the
 * Swiftline import template deliberately does not ask customers for an invoice
 * number. Use the customer's parcel reference where available and a stable
 * draft reference as the operational fallback.
 */
export function carrierShipmentSourceIdentity(draft: ShipmentReferenceDraft) {
  const reference = customerShipmentReference(draft)
    || `SLS-${String(draft._id).slice(-12).toUpperCase()}`;
  return { invoiceNumber: reference, shipmentReference: reference };
}

/** Customer-facing documents never expose carrier-only fallback identifiers. */
export function publicShipmentSourceIdentity(draft: ShipmentReferenceDraft) {
  return { invoiceNumber: "", shipmentReference: customerShipmentReference(draft) };
}
