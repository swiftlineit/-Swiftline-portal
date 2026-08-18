// CSB (Courier Shipping Bill) category for an export shipment. Frontend mirror of
// the backend's csbType.service.ts- the two live in separate packages, so keep
// them in step by hand. The backend is authoritative for what is actually charged.
//
// CSB-V shipments attract a flat clearance charge applied ONCE per shipment (not
// per parcel and not per kg), added to the taxable base before the existing 18% GST.

export const csbTypeValues = ["CSB_IV", "CSB_V"] as const;
export type CsbType = (typeof csbTypeValues)[number];

// Flat clearance charge in INR (major units) applied once per CSB-V shipment.
export const csbVClearanceCharge = 1800;
export const csbVClearanceChargeMinor = csbVClearanceCharge * 100;

export const csbTypeLabels: Record<CsbType, string> = {
  CSB_IV: "CSB-IV",
  CSB_V: "CSB-V"
};

export const csbTypeOptions: Array<{ value: CsbType; label: string; description: string }> = [
  {
    value: "CSB_IV",
    label: "CSB-IV",
    description: "Standard courier shipping bill. No additional clearance charge."
  },
  {
    value: "CSB_V",
    label: "CSB-V",
    description: `Adds a flat ₹${csbVClearanceCharge.toLocaleString("en-IN")} clearance charge per shipment, plus GST.`
  }
];

/**
 * Normalizes any stored value to a CSB type. Shipments created before CSB
 * selection existed have none and read as CSB-IV, matching the backend.
 */
export function normalizeCsbType(value: unknown): CsbType {
  return value === "CSB_V" ? "CSB_V" : "CSB_IV";
}

/**
 * The flat clearance charge for a shipment, in INR. Zero for CSB-IV.
 * Applied once per shipment- never per parcel and never per kg.
 */
export function getCsbClearanceCharge(value: unknown): number {
  return normalizeCsbType(value) === "CSB_V" ? csbVClearanceCharge : 0;
}

export function formatCsbType(value: unknown): string {
  return csbTypeLabels[normalizeCsbType(value)];
}
