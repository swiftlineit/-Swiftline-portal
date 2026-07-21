import mongoose from "mongoose";
import { CountryRateCard } from "../models/countryRateCard.model.js";
import type { ShipmentParcel, ShipmentServiceType } from "../models/shipmentDraft.model.js";

export const defaultShipmentGstRate = 0.18;

type PricingParcelInput = Partial<Omit<ShipmentParcel, "lengthCm" | "widthCm" | "heightCm">> & {
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
};

export type ShipmentPricingEstimate = {
  parcels: Array<{
    sequence: number;
    actualWeightKg: number;
    volumetricWeightKg: number;
    chargeableWeightKg: number;
    rateCardId: string | null;
    rateFromKg: number | null;
    rateToKg: number | null;
    chargesPerKg: number | null;
    maxBoxKg: number | null;
    baseAmount: number;
    exceedsMaxBoxKg: boolean;
  }>;
  baseAmount: number;
  gstAmount: number;
  totalAmount: number;
  missingRate: boolean;
  exceedsMaxBoxKg: boolean;
  gstRate: number;
};

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getVolumetricDivisor(serviceType: ShipmentServiceType) {
  return serviceType === "CARGO" ? 6000 : 5000;
}

export function roundShipmentMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateParcelVolumetricWeight(parcel: PricingParcelInput, serviceType: ShipmentServiceType) {
  const lengthCm = numeric(parcel.lengthCm);
  const widthCm = numeric(parcel.widthCm);
  const heightCm = numeric(parcel.heightCm);

  if (!lengthCm || !widthCm || !heightCm) return 0;
  return (lengthCm * widthCm * heightCm) / getVolumetricDivisor(serviceType);
}

export async function calculateShipmentPricingEstimate(input: {
  countryCode: string;
  serviceType: ShipmentServiceType;
  parcels: PricingParcelInput[];
  gstRate?: number;
  session?: mongoose.ClientSession;
}): Promise<ShipmentPricingEstimate> {
  const countryCode = input.countryCode.trim().toUpperCase();
  const gstRate = input.gstRate ?? defaultShipmentGstRate;
  const rateQuery = CountryRateCard.find({
    countryCode,
    service: input.serviceType
  }).sort({ fromKg: 1 }).lean();
  if (input.session) rateQuery.session(input.session);
  const rates = await rateQuery.exec();

  const parcels = input.parcels.map((parcel, index) => {
    const actualWeightKg = numeric(parcel.weightKg);
    const volumetricWeightKg = calculateParcelVolumetricWeight(parcel, input.serviceType);
    const chargeableWeightKg = Math.max(actualWeightKg, volumetricWeightKg);
    const exactRate = rates.find((candidate) =>
      chargeableWeightKg >= candidate.fromKg
      && chargeableWeightKg <= candidate.toKg
    );
    // Overweight boxes retain an estimate using the final slab while remaining visibly over limit.
    const highestRate = rates.at(-1);
    const rate = exactRate ?? (highestRate && chargeableWeightKg > highestRate.toKg ? highestRate : undefined);
    const baseAmount = rate ? roundShipmentMoney(chargeableWeightKg * rate.chargesPerKg) : 0;

    return {
      sequence: numeric(parcel.sequence) || index + 1,
      actualWeightKg,
      volumetricWeightKg,
      chargeableWeightKg,
      rateCardId: rate ? String(rate._id) : null,
      rateFromKg: rate?.fromKg ?? null,
      rateToKg: rate?.toKg ?? null,
      chargesPerKg: rate?.chargesPerKg ?? null,
      maxBoxKg: rate?.maxBoxKg ?? null,
      baseAmount,
      exceedsMaxBoxKg: Boolean(rate && chargeableWeightKg > rate.maxBoxKg)
    };
  });
  const baseAmount = roundShipmentMoney(parcels.reduce((total, parcel) => total + parcel.baseAmount, 0));
  const gstAmount = roundShipmentMoney(baseAmount * gstRate);

  return {
    parcels,
    baseAmount,
    gstAmount,
    totalAmount: roundShipmentMoney(baseAmount + gstAmount),
    missingRate: parcels.some((parcel) => parcel.chargesPerKg === null && parcel.chargeableWeightKg > 0),
    exceedsMaxBoxKg: parcels.some((parcel) => parcel.exceedsMaxBoxKg),
    gstRate
  };
}
