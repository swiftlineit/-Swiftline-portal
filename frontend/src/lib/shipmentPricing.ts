import { ShipmentServiceType } from "@/lib/dpdLabels";

/**
 * Presentation helpers for shipment charges.
 *
 * The arithmetic that used to live here has moved to the server
 * (`shipmentPricing.service.ts`), reached through `shipmentCostEstimate.ts`. A
 * customer must be charged the figure they were shown, and a second
 * implementation in the browser is the one thing that can make those differ — so
 * there is deliberately no pricing calculation left in this file.
 */

export function getVolumetricDivisor(serviceType: ShipmentServiceType) {
  return serviceType === "CARGO" ? 6000 : 5000;
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
