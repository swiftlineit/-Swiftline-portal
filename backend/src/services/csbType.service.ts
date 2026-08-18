// CSB (Courier Shipping Bill) category for an export shipment.
//
// CSB-IV is the default free-of-charge customs route. CSB-V shipments clear under
// a different customs procedure that Swiftline bills a flat clearance charge for.
//
// The charge is per SHIPMENT, not per parcel and not per kg: a five box, 40 kg
// shipment attracts the same single charge as a one box, 1 kg shipment. It is
// added to the taxable base, so the existing 18% GST applies on top of it.

export const csbTypeValues = ["CSB_IV", "CSB_V"] as const;
export type CsbType = (typeof csbTypeValues)[number];

// Flat clearance charge in INR applied once per CSB-V shipment.
export const csbVClearanceCharge = 1800;

export const csbTypeLabels: Record<CsbType, string> = {
  CSB_IV: "CSB-IV",
  CSB_V: "CSB-V"
};

/**
 * Normalizes any stored/incoming value to a CSB type.
 *
 * Shipments created before CSB selection existed have no value stored. They are
 * treated as CSB-IV so their pricing stays exactly as it was originally booked-
 * repricing an old invoice or amendment must never introduce a new charge.
 */
export function normalizeCsbType(value: unknown): CsbType {
  return value === "CSB_V" ? "CSB_V" : "CSB_IV";
}

/**
 * The flat clearance charge for a shipment, in INR. Zero for CSB-IV.
 */
export function getCsbClearanceCharge(value: unknown): number {
  return normalizeCsbType(value) === "CSB_V" ? csbVClearanceCharge : 0;
}

export function formatCsbType(value: unknown): string {
  return csbTypeLabels[normalizeCsbType(value)];
}
