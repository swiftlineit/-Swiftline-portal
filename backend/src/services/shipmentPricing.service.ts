import mongoose from "mongoose";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { CountryRateCard } from "../models/countryRateCard.model.js";
import { rateCardBandValues, type RateCardBand } from "../models/countryRateCard.model.js";
import type { ShipmentServiceType } from "../models/shipmentDraft.model.js";
import { getCsbClearanceCharge, normalizeCsbType, type CsbType } from "./csbType.service.js";
import {
  emptyRouteCharges,
  getRouteCharges,
  isRemoteAreaPostcode,
  type RouteCharges
} from "./countryRouteCharge.service.js";
import { getDeclaredGoodsValue } from "./parcelItems.service.js";

export const defaultShipmentGstRate = 0.18;
export const shipmentTaxTreatmentValues = ["GST_APPLICABLE", "NO_GST"] as const;
export type ShipmentTaxTreatment = (typeof shipmentTaxTreatmentValues)[number];

export function resolveShipmentTaxSelection(input: {
  noGstEligible: boolean;
  forceGst?: boolean;
  frozenGstRate?: number;
}) {
  const gstForced = input.noGstEligible && Boolean(input.forceGst);
  const gstRate = input.frozenGstRate
    ?? (input.noGstEligible && !gstForced ? 0 : defaultShipmentGstRate);
  return {
    gstRate,
    taxTreatment: (gstRate === 0 ? "NO_GST" : "GST_APPLICABLE") as ShipmentTaxTreatment,
    gstForced
  };
}

export class RateCardRequiredError extends Error {
  constructor(
    message = "Shipment booking is paused for this account until a rate card is assigned. Please contact Swiftline support.",
    public readonly statusCode = 409,
    public readonly code = "RATE_CARD_REQUIRED"
  ) {
    super(message);
    this.name = "RateCardRequiredError";
  }
}

export class RateCardAccountNotFoundError extends RateCardRequiredError {
  constructor() {
    super("The business account required for pricing could not be found.", 404, "RATE_CARD_ACCOUNT_NOT_FOUND");
    this.name = "RateCardAccountNotFoundError";
  }
}

export class RateCardAssignmentMismatchError extends RateCardRequiredError {
  constructor() {
    super("The requested pricing context does not match the business account's assigned rate card.", 409, "RATE_CARD_ASSIGNMENT_MISMATCH");
    this.name = "RateCardAssignmentMismatchError";
  }
}

export class RateCardPricingContextError extends RateCardRequiredError {
  constructor() {
    super("A controlled rate card or business account is required for pricing.", 500, "RATE_CARD_PRICING_CONTEXT_REQUIRED");
    this.name = "RateCardPricingContextError";
  }
}

/**
 * The only parcel fields pricing reads.
 *
 * Declared structurally rather than derived from `ShipmentParcel` so the booking
 * form can price the boxes a customer is still typing, which carry weights and
 * dimensions but not yet the descriptions and HSN codes a stored parcel requires.
 * A stored `ShipmentParcel` satisfies it unchanged.
 */
type PricingParcelInput = {
  sequence?: number;
  weightKg?: number;
  lengthCm?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  // Read only for the declared goods value the insurance premium is based on.
  items?: Array<{ quantity?: unknown; unitRate?: unknown }> | null;
};

/**
 * How a line affects the total.
 *
 * CHARGE adds to the taxable base, DEDUCTION subtracts from it, TAX is calculated
 * on the base that results. The estimator panel styles and orders lines by this,
 * so a new charge type needs no UI work.
 */
export type ShipmentChargeLineKind = "CHARGE" | "TAX" | "DEDUCTION";

export const shipmentChargeLineCodes = [
  "FREIGHT",
  "FUEL_SURCHARGE",
  "REMOTE_AREA",
  "CUSTOMS_CLEARANCE",
  "HANDLING",
  "INSURANCE",
  "DISCOUNT",
  "GST"
] as const;
export type ShipmentChargeLineCode = (typeof shipmentChargeLineCodes)[number];

export type ShipmentChargeLine = {
  code: ShipmentChargeLineCode;
  label: string;
  kind: ShipmentChargeLineKind;
  /** Rupees. Always positive — `kind` carries the sign. */
  amount: number;
  amountMinor: number;
  /** How the amount was derived, shown under the line so a customer can check it. */
  basis: string;
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
  // Freight only: the sum of the per-parcel rate card amounts.
  freightAmount: number;
  // Percentage of freight, per the route configuration.
  fuelSurchargeAmount: number;
  // Flat charge applied only when the consignee postcode is a configured remote area.
  remoteAreaAmount: number;
  remoteAreaApplied: boolean;
  // Flat CSB-V clearance charge, applied once for the whole shipment. Zero for CSB-IV.
  csbType: CsbType;
  csbClearanceAmount: number;
  // Flat charge applied once per shipment.
  handlingAmount: number;
  // Premium for optional transit cover, charged only when the customer opts in.
  insuranceAmount: number;
  insuranceApplied: boolean;
  // What the insurance premium is calculated from: quantity x unit rate across all items.
  declaredGoodsValue: number;
  // Route-level discount taken off the pre-tax subtotal. Positive; it is subtracted.
  discountAmount: number;
  /**
   * Taxable base that GST is charged on: every charge above, less the discount.
   *
   * On a route with no surcharge configuration this is freight + CSB-V clearance,
   * which is exactly what it meant before route charges existed. Stored pricing
   * snapshots and the invoice keep reading it unchanged.
   */
  baseAmount: number;
  gstAmount: number;
  totalAmount: number;
  missingRate: boolean;
  exceedsMaxBoxKg: boolean;
  gstRate: number;
  /** Frozen commercial treatment used for this estimate and any resulting booking. */
  taxTreatment?: ShipmentTaxTreatment;
  /** Whether the account was approved for no-GST billing when this price was calculated. */
  noGstEligible?: boolean;
  /** True when an eligible account explicitly elected to pay GST for this shipment. */
  gstForced?: boolean;
  /** Account GST-billing version used to calculate the price. */
  gstBillingVersion?: number;
  /** Every non-zero component in presentation order, including GST. */
  lines: ShipmentChargeLine[];
  /**
   * Identifies the configuration this estimate was priced against, so the price
   * lock can tell that rates or surcharges moved underneath a customer.
   */
  pricingBasis: {
    // Optional only for stored/test snapshots created before bands existed. Every
    // newly calculated estimate always writes it.
    rateCardBand?: RateCardBand;
    rateCardIds: string[];
    routeChargesUpdatedAt: Date | null;
    taxTreatment?: ShipmentTaxTreatment;
    gstBillingVersion?: number;
    gstBillingEffectiveFrom?: Date | null;
  };
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

function toMinor(amount: number) {
  return Math.round(amount * 100);
}

function percentageOf(amount: number, percent: number) {
  return roundShipmentMoney(amount * (percent / 100));
}

/**
 * The charges an invoice lists below its per-box freight rows: surcharges,
 * clearance, handling, insurance and any discount.
 *
 * Freight is already itemised per box and GST is totalled separately, so both are
 * excluded — listing them again would double them on the invoice.
 *
 * Reads a stored snapshot rather than a live estimate, because an invoice must
 * always print the charges it was raised with. Snapshots taken before route
 * charges existed carry no `lines`; their flat CSB-V clearance charge is rebuilt
 * from the stored amount so those invoices print exactly as they were issued.
 */
export function getShipmentLevelInvoiceLines(pricingSnapshot: unknown): ShipmentChargeLine[] {
  const snapshot = (pricingSnapshot ?? {}) as {
    lines?: ShipmentChargeLine[];
    csbClearanceAmount?: number;
  };

  if (Array.isArray(snapshot.lines) && snapshot.lines.length) {
    return snapshot.lines.filter((line) => line.code !== "FREIGHT" && line.code !== "GST");
  }

  const csbClearanceAmount = numeric(snapshot.csbClearanceAmount);
  if (csbClearanceAmount <= 0) return [];

  return [{
    code: "CUSTOMS_CLEARANCE",
    label: "CSB-V Clearance Charge",
    kind: "CHARGE",
    amount: csbClearanceAmount,
    amountMinor: toMinor(csbClearanceAmount),
    basis: "Flat charge for the CSB-V customs route, once per shipment"
  }];
}

export function calculateParcelVolumetricWeight(parcel: PricingParcelInput, serviceType: ShipmentServiceType) {
  const lengthCm = numeric(parcel.lengthCm);
  const widthCm = numeric(parcel.widthCm);
  const heightCm = numeric(parcel.heightCm);

  if (!lengthCm || !widthCm || !heightCm) return 0;
  return (lengthCm * widthCm * heightCm) / getVolumetricDivisor(serviceType);
}

export type ShipmentPricingInput = {
  /** Business account whose commercial band must be used. */
  businessAccountId?: string | mongoose.Types.ObjectId | null;
  /** Controlled internal preview band, or an expected assignment assertion. */
  rateCardBand?: RateCardBand | null;
  countryCode: string;
  serviceType: ShipmentServiceType;
  parcels: PricingParcelInput[];
  // Omitted for shipments booked before CSB selection existed; those price as
  // CSB-IV so no historical amount ever changes.
  csbType?: CsbType | null;
  /** Consignee postcode, used to decide whether the remote area charge applies. */
  destinationPostcode?: string | null;
  /** Whether the customer bought transit cover for this shipment. */
  insuranceOptIn?: boolean;
  /**
   * Declared value of the goods, used as the insurance basis. Derived from the
   * parcel items when omitted; pass it explicitly only where the parcels handed in
   * carry no item lines.
   */
  declaredGoodsValue?: number;
  gstRate?: number;
  /** One-way booking override: approved no-GST accounts can still elect GST. */
  forceGst?: boolean;
  /**
   * Pre-loaded route configuration. Supplied by callers that price several
   * shipments in a row, or that must price against the exact configuration a
   * customer was shown rather than whatever is current.
   */
  routeCharges?: RouteCharges;
  session?: mongoose.ClientSession;
};

/**
 * The parts of a shipment draft that pricing reads.
 *
 * Structural rather than the Mongoose document type, because the amendment flow
 * prices proposed drafts that exist only as plain snapshots. `insuranceOptIn` is
 * optional so a snapshot taken before insurance existed prices as uninsured
 * rather than failing to compile.
 */
type PricingDraftSource = {
  businessAccountId: string | mongoose.Types.ObjectId;
  consigneeEnteredAddress: { countryCode: string; postcode?: string };
  serviceType: ShipmentServiceType;
  parcelList: PricingParcelInput[];
  csbType?: CsbType | null;
  insuranceOptIn?: boolean;
  forceGst?: boolean;
};

/**
 * Everything pricing needs from a stored draft.
 *
 * Every caller that prices a draft goes through this, so a new pricing input can
 * never be added to the engine and silently forgotten at one call site — which
 * would let a shipment be invoiced for a different amount than it was booked at.
 */
export function buildPricingInputFromDraft(draft: PricingDraftSource): ShipmentPricingInput {
  return {
    businessAccountId: draft.businessAccountId,
    countryCode: draft.consigneeEnteredAddress.countryCode,
    serviceType: draft.serviceType,
    parcels: draft.parcelList,
    csbType: draft.csbType,
    destinationPostcode: draft.consigneeEnteredAddress.postcode,
    insuranceOptIn: draft.insuranceOptIn,
    forceGst: draft.forceGst,
    declaredGoodsValue: getDeclaredGoodsValue(draft.parcelList)
  };
}

type AccountPricingContext = {
  rateCardBand: RateCardBand;
  noGstEligible: boolean;
  gstBillingVersion: number;
  gstBillingEffectiveFrom: Date | null;
};

async function resolveAccountPricingContext(input: Pick<ShipmentPricingInput, "businessAccountId" | "rateCardBand" | "session">): Promise<AccountPricingContext> {
  const explicitBand = input.rateCardBand && rateCardBandValues.includes(input.rateCardBand)
    ? input.rateCardBand
    : null;
  if (!input.businessAccountId) {
    if (explicitBand) return {
      rateCardBand: explicitBand,
      noGstEligible: false,
      gstBillingVersion: 1,
      gstBillingEffectiveFrom: null
    };
    throw new RateCardPricingContextError();
  }

  const accountId = String(input.businessAccountId);
  if (!mongoose.Types.ObjectId.isValid(accountId)) throw new RateCardAccountNotFoundError();
  const query = BusinessAccount.findById(accountId).select("rateCardBand accountKind gstBilling").lean();
  if (input.session) query.session(input.session);
  const account = await query.exec();

  // Counter shipments use the system sentinel and deliberately preserve the
  // legacy tariff, including before the backfill has run in a fresh dev DB.
  if (!account) throw new RateCardAccountNotFoundError();
  if (account.accountKind === "INDIVIDUAL_SENTINEL") return {
    rateCardBand: "BAND_A",
    noGstEligible: false,
    gstBillingVersion: account.gstBilling?.version ?? 1,
    gstBillingEffectiveFrom: null
  };
  if (!account.rateCardBand) throw new RateCardRequiredError();
  if (explicitBand && explicitBand !== account.rateCardBand) throw new RateCardAssignmentMismatchError();
  return {
    rateCardBand: account.rateCardBand,
    noGstEligible: account.gstBilling?.requestedTreatment === "NO_GST"
      && account.gstBilling?.status === "APPROVED"
      && Boolean(account.gstBilling?.effectiveFrom)
      && !account.gstBilling?.effectiveUntil,
    gstBillingVersion: account.gstBilling?.version ?? 1,
    gstBillingEffectiveFrom: account.gstBilling?.effectiveFrom ?? null
  };
}

export async function resolveRateCardBand(input: Pick<ShipmentPricingInput, "businessAccountId" | "rateCardBand" | "session">): Promise<RateCardBand> {
  return (await resolveAccountPricingContext(input)).rateCardBand;
}

export async function calculateShipmentPricingEstimate(
  input: ShipmentPricingInput
): Promise<ShipmentPricingEstimate> {
  const countryCode = input.countryCode.trim().toUpperCase();
  const accountContext = await resolveAccountPricingContext(input);
  const rateCardBand = accountContext.rateCardBand;
  // `gstRate` is an internal frozen-pricing input used by amendments and quote
  // publication. Public draft endpoints never accept it.
  const { gstRate, taxTreatment, gstForced } = resolveShipmentTaxSelection({
    noGstEligible: accountContext.noGstEligible,
    forceGst: input.forceGst,
    frozenGstRate: input.gstRate
  });
  const csbType = normalizeCsbType(input.csbType);
  const rateQuery = CountryRateCard.find({
    band: rateCardBand,
    countryCode,
    service: input.serviceType
  }).sort({ fromKg: 1 }).lean();
  if (input.session) rateQuery.session(input.session);
  const rates = await rateQuery.exec();

  const routeCharges = input.routeCharges ?? (
    countryCode
      ? await getRouteCharges({ countryCode, service: input.serviceType, band: rateCardBand, session: input.session })
      : emptyRouteCharges
  );

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
  const freightAmount = roundShipmentMoney(parcels.reduce((total, parcel) => total + parcel.baseAmount, 0));
  const missingRate = parcels.some((parcel) => parcel.chargesPerKg === null && parcel.chargeableWeightKg > 0);

  const breakdown = calculateChargeBreakdown({
    freightAmount,
    missingRate,
    parcelCount: parcels.length,
    chargeableWeightTotal: roundShipmentMoney(
      parcels.reduce((total, parcel) => total + parcel.chargeableWeightKg, 0)
    ),
    csbType,
    destinationPostcode: input.destinationPostcode,
    insuranceOptIn: Boolean(input.insuranceOptIn),
    declaredGoodsValue: roundShipmentMoney(
      input.declaredGoodsValue ?? getDeclaredGoodsValue(input.parcels)
    ),
    routeCharges,
    gstRate
  });

  return {
    parcels,
    ...breakdown,
    missingRate,
    exceedsMaxBoxKg: parcels.some((parcel) => parcel.exceedsMaxBoxKg),
    gstRate,
    taxTreatment,
    noGstEligible: accountContext.noGstEligible,
    gstForced,
    gstBillingVersion: accountContext.gstBillingVersion,
    pricingBasis: {
      rateCardBand,
      rateCardIds: [...new Set(parcels.map((parcel) => parcel.rateCardId).filter((id): id is string => Boolean(id)))],
      routeChargesUpdatedAt: routeCharges.updatedAt,
      taxTreatment,
      gstBillingVersion: accountContext.gstBillingVersion,
      gstBillingEffectiveFrom: accountContext.gstBillingEffectiveFrom
    }
  };
}

/**
 * Every charge component above freight, in the fixed order they are applied.
 *
 * Deliberately pure: it takes the freight it was handed and the configuration to
 * apply, touches no database, and is the single place the order of operations
 * lives. That order is load-bearing — the discount comes off the subtotal of all
 * charges, and GST is charged on what remains — so it is unit tested directly in
 * `shipmentCostEstimator.test.ts` rather than only through a booking.
 */
export function calculateChargeBreakdown(input: {
  freightAmount: number;
  missingRate: boolean;
  parcelCount: number;
  chargeableWeightTotal: number;
  csbType: CsbType;
  destinationPostcode?: string | null;
  insuranceOptIn: boolean;
  declaredGoodsValue: number;
  routeCharges: RouteCharges;
  gstRate: number;
}) {
  const { freightAmount, routeCharges, gstRate, csbType, declaredGoodsValue } = input;

  // Every add-on is suppressed when no rate applies, so an unpriceable route never
  // quotes a surcharge or a clearance charge on freight it could not calculate.
  const priceable = !input.missingRate;
  const csbClearanceAmount = priceable ? getCsbClearanceCharge(csbType) : 0;
  const fuelSurchargeAmount = priceable
    ? percentageOf(freightAmount, routeCharges.fuelSurchargePercent)
    : 0;
  const remoteAreaApplied = priceable
    && routeCharges.remoteAreaCharge > 0
    && isRemoteAreaPostcode(input.destinationPostcode, routeCharges.remoteAreaPostcodes);
  const remoteAreaAmount = remoteAreaApplied ? roundShipmentMoney(routeCharges.remoteAreaCharge) : 0;
  const handlingAmount = priceable ? roundShipmentMoney(routeCharges.handlingCharge) : 0;

  // Shipment insurance is switched off portal-wide while the product is
  // unfinished, so nothing new is ever priced with cover. The premium is still
  // computed because it feeds the rate-card display of what cover *would* cost,
  // but `insuranceApplied` is forced false and the amount is always zero.
  //
  // Historical bookings are untouched: this only affects pricing calculated from
  // now on. Reactivating is a matter of restoring the opt-in below — the fields,
  // the route-charge configuration, and the response shape all still exist.
  const insurancePremium = Math.max(
    percentageOf(declaredGoodsValue, routeCharges.insurancePercent),
    routeCharges.insuranceMinimum
  );
  const insuranceApplied = false;
  const insuranceAmount = 0;

  const chargesSubtotal = roundShipmentMoney(
    freightAmount
    + fuelSurchargeAmount
    + remoteAreaAmount
    + csbClearanceAmount
    + handlingAmount
    + insuranceAmount
  );
  // Applied to the whole pre-tax subtotal, not to freight alone, so the percentage
  // an operator configures is the percentage the customer actually saves. Capped at
  // the subtotal so a 100% discount cannot produce a negative taxable base.
  const discountAmount = priceable
    ? Math.min(percentageOf(chargesSubtotal, routeCharges.discountPercent), chargesSubtotal)
    : 0;

  const baseAmount = roundShipmentMoney(chargesSubtotal - discountAmount);
  const gstAmount = roundShipmentMoney(baseAmount * gstRate);
  const totalAmount = roundShipmentMoney(baseAmount + gstAmount);

  const lines: ShipmentChargeLine[] = [];
  const addLine = (
    code: ShipmentChargeLineCode,
    label: string,
    kind: ShipmentChargeLineKind,
    amount: number,
    basis: string
  ) => {
    // Zero-value components are left out entirely rather than rendered as "0.00":
    // a charge the customer is not paying should not appear on their estimate.
    if (amount <= 0) return;
    lines.push({ code, label, kind, amount, amountMinor: toMinor(amount), basis });
  };

  addLine(
    "FREIGHT",
    "Base freight",
    "CHARGE",
    freightAmount,
    `${input.chargeableWeightTotal.toFixed(2)} kg chargeable across ${input.parcelCount} ${input.parcelCount === 1 ? "box" : "boxes"}`
  );
  addLine(
    "FUEL_SURCHARGE",
    "Fuel surcharge",
    "CHARGE",
    fuelSurchargeAmount,
    `${routeCharges.fuelSurchargePercent}% of base freight`
  );
  addLine(
    "REMOTE_AREA",
    "Remote area surcharge",
    "CHARGE",
    remoteAreaAmount,
    "Destination postcode is served as a remote area"
  );
  addLine(
    "CUSTOMS_CLEARANCE",
    "Customs clearance (CSB-V)",
    "CHARGE",
    csbClearanceAmount,
    "Flat charge for the CSB-V customs route, once per shipment"
  );
  addLine(
    "HANDLING",
    "Handling charges",
    "CHARGE",
    handlingAmount,
    "Flat charge, once per shipment"
  );
  addLine(
    "INSURANCE",
    "Insurance",
    "CHARGE",
    insuranceAmount,
    routeCharges.insurancePercent > 0
      ? `${routeCharges.insurancePercent}% of ${declaredGoodsValue.toFixed(2)} declared value`
      : "Flat transit cover premium"
  );
  addLine(
    "DISCOUNT",
    "Discount",
    "DEDUCTION",
    discountAmount,
    `${routeCharges.discountPercent}% off charges before GST`
  );
  addLine(
    "GST",
    `GST ${Math.round(gstRate * 100)}%`,
    "TAX",
    gstAmount,
    "Charged on all taxable charges after discount"
  );

  return {
    freightAmount,
    fuelSurchargeAmount,
    remoteAreaAmount,
    remoteAreaApplied,
    csbType,
    csbClearanceAmount,
    handlingAmount,
    insuranceAmount,
    insuranceApplied,
    declaredGoodsValue,
    discountAmount,
    baseAmount,
    gstAmount,
    totalAmount,
    lines
  };
}
