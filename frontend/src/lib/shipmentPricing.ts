import { ShipmentServiceType } from "@/lib/dpdLabels";

/**
 * Presentation helpers for shipment charges.
 *
 * The arithmetic that used to live here has moved to the server
 * (`shipmentPricing.service.ts`), reached through `shipmentCostEstimate.ts`. A
 * customer must be charged the figure they were shown, and a second
 * implementation in the browser is the one thing that can make those differ- so
 * there is deliberately no pricing calculation left in this file.
 */

export function getVolumetricDivisor(serviceType: ShipmentServiceType) {
  return serviceType === "CARGO" ? 6000 : 5000;
}

/**
 * The largest parcel Swiftline carries, per side- 100 x 60 x 70 cm, the 230 cm
 * girth the network is built around.
 *
 * Maximum weight is deliberately absent: it comes from the matched rate card's
 * maxBoxKg, so it varies by destination and service and is only known once the
 * server has priced the shipment.
 *
 * KEEP IN SYNC with the server, which is the authority (separate package, cannot
 * share a module): portal/backend/src/services/shipmentValidation.service.ts
 */
export const standardParcelDimensionsCm = {
  lengthCm: 100,
  widthCm: 60,
  heightCm: 70
} as const;

/** "100 x 60 x 70 cm", for the advisory note. */
export const standardParcelDimensionsLabel = [
  standardParcelDimensionsCm.lengthCm,
  standardParcelDimensionsCm.widthCm,
  standardParcelDimensionsCm.heightCm
].join(" x ") + " cm";

/**
 * Whether a box is larger than the standard parcel envelope.
 *
 * Advisory only- oversized parcels are accepted and priced, their volumetric
 * weight carrying the extra cost. This drives a note so the sender is told
 * before booking rather than surprised by the charge afterwards.
 *
 * Compared side by side rather than sorted: the note is a heads-up, and warning
 * on a box that would fit rotated is harmless where refusing it would not be.
 */
export function exceedsStandardParcelSize(parcel: {
  lengthCm: string | number;
  widthCm: string | number;
  heightCm: string | number;
}) {
  const over = (value: string | number, limit: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > limit;
  };

  return over(parcel.lengthCm, standardParcelDimensionsCm.lengthCm)
    || over(parcel.widthCm, standardParcelDimensionsCm.widthCm)
    || over(parcel.heightCm, standardParcelDimensionsCm.heightCm);
}

/**
 * How volumetric weight is worked out, for the hint shown wherever it appears.
 * Pass the service type when it is known; without one, both divisors are listed
 * because the divisor is what differs between Cargo and Courier.
 */
export function getVolumetricFormula(serviceType?: ShipmentServiceType) {
  const divisor = serviceType
    ? `${getVolumetricDivisor(serviceType)} for ${serviceType === "CARGO" ? "Cargo" : "Courier"}`
    : "6000 for Cargo, 5000 for Courier";
  return `Volumetric weight = (Length × Width × Height in cm) ÷ ${divisor}. `
    + "The higher of actual and volumetric weight is charged.";
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(value);
}
