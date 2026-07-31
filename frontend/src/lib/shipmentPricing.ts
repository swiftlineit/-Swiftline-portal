import { CountryRateCard } from "@/lib/countryRateCards";
import { getCsbClearanceCharge, normalizeCsbType, type CsbType } from "@/lib/csbType";
import { ShipmentServiceType } from "@/lib/dpdLabels";

export const defaultGstRate = 0.18;

export type PricingParcelInput = {
  weightKg: string | number;
  lengthCm?: string | number;
  widthCm?: string | number;
  heightCm?: string | number;
};

export type ParcelChargeEstimate = {
  actualWeightKg: number;
  volumetricWeightKg: number;
  chargeableWeightKg: number;
  rate: CountryRateCard | null;
  baseAmount: number;
  exceedsMaxBoxKg: boolean;
};

function numeric(value: string | number | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

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

export function roundShipmentMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getParcelVolumetricWeight(parcel: PricingParcelInput, serviceType: ShipmentServiceType) {
  const lengthCm = numeric(parcel.lengthCm);
  const widthCm = numeric(parcel.widthCm);
  const heightCm = numeric(parcel.heightCm);
  if (!lengthCm || !widthCm || !heightCm) return 0;

  return (lengthCm * widthCm * heightCm) / getVolumetricDivisor(serviceType);
}

export function findRateForWeight(
  rates: CountryRateCard[],
  countryCode: string,
  serviceType: ShipmentServiceType,
  chargeableWeightKg: number
) {
  return rates.find((rate) =>
    rate.countryCode === countryCode
    && rate.service === serviceType
    && chargeableWeightKg >= rate.fromKg
    && chargeableWeightKg <= rate.toKg
  ) ?? null;
}

export function calculateShipmentEstimate(input: {
  parcels: PricingParcelInput[];
  rates: CountryRateCard[];
  countryCode: string;
  serviceType: ShipmentServiceType;
  // Omitted for drafts created before CSB selection existed; those price as
  // CSB-IV, matching the backend.
  csbType?: CsbType | null;
  gstRate?: number;
}) {
  const gstRate = input.gstRate ?? defaultGstRate;
  const csbType = normalizeCsbType(input.csbType);
  const parcels = input.parcels.map((parcel) => {
    const actualWeightKg = numeric(parcel.weightKg);
    const volumetricWeightKg = getParcelVolumetricWeight(parcel, input.serviceType);
    const chargeableWeightKg = Math.max(actualWeightKg, volumetricWeightKg);
    const rate = findRateForWeight(input.rates, input.countryCode, input.serviceType, chargeableWeightKg);
    const baseAmount = rate ? roundShipmentMoney(chargeableWeightKg * rate.chargesPerKg) : 0;

    return {
      actualWeightKg,
      volumetricWeightKg,
      chargeableWeightKg,
      rate,
      baseAmount,
      exceedsMaxBoxKg: Boolean(rate && chargeableWeightKg > rate.maxBoxKg)
    };
  });
  const freightAmount = roundShipmentMoney(parcels.reduce((total, parcel) => total + parcel.baseAmount, 0));
  const missingRate = parcels.some((parcel) => !parcel.rate && parcel.chargeableWeightKg > 0);
  // Charged once for the whole shipment regardless of parcel count or weight.
  // Suppressed when no rate applies so an unpriceable route never shows 1800 alone.
  const csbClearanceAmount = missingRate ? 0 : getCsbClearanceCharge(csbType);
  const baseAmount = roundShipmentMoney(freightAmount + csbClearanceAmount);
  const gstAmount = roundShipmentMoney(baseAmount * gstRate);

  return {
    parcels,
    // Freight only, before the CSB-V clearance charge.
    freightAmount,
    csbType,
    csbClearanceAmount,
    // Taxable base that GST is charged on: freight + CSB-V clearance charge.
    baseAmount,
    gstAmount,
    totalAmount: roundShipmentMoney(baseAmount + gstAmount),
    missingRate,
    exceedsMaxBoxKg: parcels.some((parcel) => parcel.exceedsMaxBoxKg)
  };
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(value);
}
