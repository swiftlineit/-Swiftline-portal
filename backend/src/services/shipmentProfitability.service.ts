import mongoose from "mongoose";
import { CancellationFeeInvoice } from "../models/cancellationFeeInvoice.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { LogisticsVendor } from "../models/logisticsVendor.model.js";
import {
  ShipmentProfitability,
  type IShipmentProfitability,
  type ProfitabilityCoverage,
  type ShipmentProfitabilityCost
} from "../models/shipmentProfitability.model.js";
import { ShipmentCreditNote } from "../models/shipmentCreditNote.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import {
  VendorCostRate,
  profitabilityCostComponentValues,
  type IVendorCostRate,
  type ProfitabilityCostComponent
} from "../models/vendorCostRate.model.js";
import { readShipmentBookingSnapshot } from "./shipmentBookingSnapshot.service.js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function resolveProfitabilityAwb(...candidates: unknown[]) {
  return candidates.map(stringValue).find(Boolean) ?? "AWB Pending";
}

export function blankProfitabilityCosts(): ShipmentProfitabilityCost[] {
  return profitabilityCostComponentValues.map((component) => ({
    component,
    amountMinor: 0,
    state: "MISSING",
    source: "NONE",
    vendorId: null,
    rateId: null,
    reference: "",
    note: "",
    updatedBy: null,
    updatedAt: null
  }));
}

export function normalizeProfitabilityCosts(costs: readonly ShipmentProfitabilityCost[] | undefined) {
  const byComponent = new Map((costs ?? []).map((cost) => [cost.component, cost]));
  return blankProfitabilityCosts().map((blank) => {
    const cost = byComponent.get(blank.component);
    if (!cost) return blank;
    return {
      component: blank.component,
      amountMinor: cost.amountMinor,
      state: cost.state,
      source: cost.source,
      vendorId: cost.vendorId ?? null,
      rateId: cost.rateId ?? null,
      reference: cost.reference ?? "",
      note: cost.note ?? "",
      updatedBy: cost.updatedBy ?? null,
      updatedAt: cost.updatedAt ?? null
    };
  });
}

export function calculateProfitabilityTotals(input: {
  totalRevenueMinor: number;
  costs: readonly ShipmentProfitabilityCost[];
}) {
  const costs = normalizeProfitabilityCosts(input.costs);
  const present = costs.filter((cost) => cost.state !== "MISSING");
  const missingCount = costs.length - present.length;
  const totalCostMinor = present.reduce((sum, cost) => sum + Math.max(0, Math.round(cost.amountMinor)), 0);
  const grossProfitMinor = Math.round(input.totalRevenueMinor) - totalCostMinor;
  const marginBasisPoints = input.totalRevenueMinor > 0
    ? Math.round((grossProfitMinor / input.totalRevenueMinor) * 10_000)
    : null;
  let coverage: ProfitabilityCoverage;
  if (!present.length) coverage = "MISSING";
  else if (missingCount) coverage = "PARTIAL";
  else if (present.some((cost) => cost.state === "ESTIMATED")) coverage = "ESTIMATED";
  else coverage = "ACTUAL";

  return { costs, totalCostMinor, grossProfitMinor, marginBasisPoints, coverage };
}

function comparableProfitability(value: {
  dpdShipmentId: unknown; shipmentInvoiceId: unknown; businessAccountId: unknown; branchId: unknown; primaryVendorId?: unknown;
  awb: string; customerName: string; originCountryCode: string; destinationCountryCode: string; destinationCountryName: string;
  serviceType: string; serviceCode: string; chargeableWeightKg: number; bookedAt: Date; customerSellingAmountMinor: number;
  revenueAdjustmentMinor: number; totalRevenueMinor: number; dutyTaxMinor: number; costs: readonly ShipmentProfitabilityCost[];
  totalCostMinor: number; grossProfitMinor: number; marginBasisPoints?: number | null; coverage: string;
}) {
  return JSON.stringify({
    dpdShipmentId: String(value.dpdShipmentId), shipmentInvoiceId: String(value.shipmentInvoiceId), businessAccountId: String(value.businessAccountId), branchId: String(value.branchId), primaryVendorId: value.primaryVendorId ? String(value.primaryVendorId) : null,
    awb: value.awb, customerName: value.customerName, originCountryCode: value.originCountryCode, destinationCountryCode: value.destinationCountryCode, destinationCountryName: value.destinationCountryName,
    serviceType: value.serviceType, serviceCode: value.serviceCode, chargeableWeightKg: value.chargeableWeightKg, bookedAt: new Date(value.bookedAt).toISOString(),
    customerSellingAmountMinor: value.customerSellingAmountMinor, revenueAdjustmentMinor: value.revenueAdjustmentMinor, totalRevenueMinor: value.totalRevenueMinor, dutyTaxMinor: value.dutyTaxMinor,
    costs: normalizeProfitabilityCosts(value.costs).map((cost) => ({ component: cost.component, amountMinor: cost.amountMinor, state: cost.state, source: cost.source, vendorId: cost.vendorId ? String(cost.vendorId) : null, rateId: cost.rateId ? String(cost.rateId) : null, reference: cost.reference, note: cost.note })),
    totalCostMinor: value.totalCostMinor, grossProfitMinor: value.grossProfitMinor, marginBasisPoints: value.marginBasisPoints ?? null, coverage: value.coverage
  });
}

export function calculateVendorRateAmount(
  rate: Pick<IVendorCostRate, "calculation" | "amountMinor" | "percentageBasisPoints">,
  chargeableWeightKg: number,
  freightMinor: number
) {
  if (rate.calculation === "FLAT") return rate.amountMinor;
  if (rate.calculation === "PER_KG") return Math.round(rate.amountMinor * chargeableWeightKg);
  return Math.round((freightMinor * rate.percentageBasisPoints) / 10_000);
}

export async function applyVendorRates(input: {
  vendorId: mongoose.Types.ObjectId;
  bookedAt: Date;
  destinationCountryCode: string;
  serviceType: "COURIER" | "CARGO";
  chargeableWeightKg: number;
  costs: ShipmentProfitabilityCost[];
}) {
  const rates = await VendorCostRate.find({
    vendorId: input.vendorId,
    status: "ACTIVE",
    originCountryCode: "IN",
    destinationCountryCode: input.destinationCountryCode,
    service: input.serviceType,
    fromKg: { $lte: input.chargeableWeightKg },
    toKg: { $gte: input.chargeableWeightKg },
    effectiveFrom: { $lte: input.bookedAt },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: input.bookedAt } }]
  }).sort({ effectiveFrom: -1, createdAt: -1 }).exec();

  const selected = new Map<ProfitabilityCostComponent, IVendorCostRate>();
  for (const rate of rates) {
    if (!selected.has(rate.component)) selected.set(rate.component, rate);
  }

  let freightMinor = input.costs.find((cost) => cost.component === "FREIGHT_BUYING" && cost.state === "ACTUAL")?.amountMinor ?? 0;
  const freightRate = selected.get("FREIGHT_BUYING");
  if (!freightMinor && freightRate) freightMinor = calculateVendorRateAmount(freightRate, input.chargeableWeightKg, 0);

  return input.costs.map((cost) => {
    if (cost.state === "ACTUAL") return cost;
    const rate = selected.get(cost.component);
    if (!rate) {
      return cost.source === "VENDOR_RATE"
        ? { ...cost, amountMinor: 0, state: "MISSING" as const, source: "NONE" as const, vendorId: null, rateId: null }
        : cost;
    }
    return {
      ...cost,
      amountMinor: calculateVendorRateAmount(rate, input.chargeableWeightKg, freightMinor),
      state: "ESTIMATED" as const,
      source: "VENDOR_RATE" as const,
      vendorId: input.vendorId,
      rateId: rate._id as mongoose.Types.ObjectId,
      reference: "",
      note: "",
      updatedBy: rate.updatedBy ?? rate.createdBy,
      updatedAt: rate.updatedAt
    };
  });
}

export async function syncShipmentProfitability(
  shipmentDraftId: mongoose.Types.ObjectId,
  options: { session?: mongoose.ClientSession } = {}
): Promise<IShipmentProfitability | null> {
  const session = options.session;
  const invoiceQuery = ShipmentInvoice.findOne({ shipmentDraftId });
  const bookingQuery = DpdShipment.findOne({ shipmentDraftId });
  const draftQuery = ShipmentDraft.findById(shipmentDraftId);
  const creditQuery = ShipmentCreditNote.find({ shipmentDraftId });
  const feeQuery = CancellationFeeInvoice.find({ shipmentDraftId });
  if (session) {
    invoiceQuery.session(session);
    bookingQuery.session(session);
    draftQuery.session(session);
    creditQuery.session(session);
    feeQuery.session(session);
  }
  const [invoice, booking, draft, creditNotes, feeInvoices] = await Promise.all([
    invoiceQuery.exec(), bookingQuery.exec(), draftQuery.exec(), creditQuery.exec(), feeQuery.exec()
  ]);
  if (!invoice || invoice.status !== "ISSUED" || !booking || !draft) return null;

  const bookingSnapshot = readShipmentBookingSnapshot(booking.currentShipmentSnapshot)
    ?? readShipmentBookingSnapshot(booking.bookingSnapshot);
  const pricing = record(invoice.pricingSnapshot);
  const invoiceShipment = record(invoice.shipment);
  const parcels = Array.isArray(pricing.parcels) ? pricing.parcels.map(record) : [];
  const chargeableWeightKg = Number(parcels.reduce(
    (sum, parcel) => sum + numberValue(parcel.chargeableWeightKg),
    0
  ).toFixed(3));
  const customer = record(invoice.customer);
  const consignee = record(bookingSnapshot?.consignee ?? draft.consigneeEnteredAddress);
  const creditTaxableMinor = creditNotes.reduce((sum, note) => sum + note.taxableValueMinor, 0);
  const creditTaxMinor = creditNotes.reduce((sum, note) => sum + note.totalTaxAmountMinor, 0);
  const feeTaxableMinor = feeInvoices.reduce((sum, fee) => sum + fee.taxableValueMinor, 0);
  const feeTaxMinor = feeInvoices.reduce((sum, fee) => sum + fee.totalTaxAmountMinor, 0);
  const customerSellingAmountMinor = invoice.taxableValueMinor;
  const revenueAdjustmentMinor = feeTaxableMinor - creditTaxableMinor;
  const totalRevenueMinor = customerSellingAmountMinor + revenueAdjustmentMinor;
  const dutyTaxMinor = invoice.totalTaxAmountMinor - creditTaxMinor + feeTaxMinor;

  const existingQuery = ShipmentProfitability.findOne({ shipmentDraftId });
  if (session) existingQuery.session(session);
  const existing = await existingQuery.exec();
  let primaryVendorId = existing?.primaryVendorId ?? null;
  if (!primaryVendorId && booking.dpdShipmentId) {
    const vendorQuery = LogisticsVendor.findOne({ integrationCode: "ALS_DPD", status: "ACTIVE" }).select("_id");
    if (session) vendorQuery.session(session);
    primaryVendorId = (await vendorQuery.exec())?._id ?? null;
  }

  let costs = normalizeProfitabilityCosts(existing?.costs as ShipmentProfitabilityCost[] | undefined);
  if (primaryVendorId) {
    costs = await applyVendorRates({
      vendorId: primaryVendorId,
      bookedAt: bookingSnapshot ? new Date(bookingSnapshot.bookedAt) : booking.createdAt,
      destinationCountryCode: stringValue(consignee.countryCode).toUpperCase(),
      serviceType: (bookingSnapshot?.service.type ?? draft.serviceType) as "COURIER" | "CARGO",
      chargeableWeightKg,
      costs
    });
  }
  const totals = calculateProfitabilityTotals({ totalRevenueMinor, costs });
  const coreValues = {
    shipmentDraftId,
    dpdShipmentId: booking._id,
    shipmentInvoiceId: invoice._id,
    businessAccountId: invoice.businessAccountId,
    branchId: invoice.branchId,
    primaryVendorId,
    awb: resolveProfitabilityAwb(
      bookingSnapshot?.tracking.swiftlineTrackingNumber,
      booking.swiftlineTrackingNumber,
      invoiceShipment.shipmentReference
    ),
    customerName: stringValue(customer.companyName) || stringValue(customer.contactName) || "Individual customer",
    originCountryCode: "IN",
    destinationCountryCode: stringValue(consignee.countryCode).toUpperCase(),
    destinationCountryName: stringValue(consignee.countryName) || stringValue(consignee.countryCode),
    serviceType: (bookingSnapshot?.service.type ?? draft.serviceType) as "COURIER" | "CARGO",
    serviceCode: bookingSnapshot?.service.code ?? draft.serviceCode ?? booking.serviceCode,
    chargeableWeightKg,
    bookedAt: bookingSnapshot ? new Date(bookingSnapshot.bookedAt) : booking.createdAt,
    currency: "INR" as const,
    customerSellingAmountMinor,
    revenueAdjustmentMinor,
    totalRevenueMinor,
    dutyTaxMinor,
    ...totals
  };

  if (existing) {
    if (comparableProfitability(existing as unknown as Parameters<typeof comparableProfitability>[0]) === comparableProfitability(coreValues)) return existing;
    const values = { ...coreValues, version: existing.version + 1, revenueSyncedAt: new Date() };
    existing.set(values);
    await existing.save({ session });
    return existing;
  }
  const [created] = await ShipmentProfitability.create([{ ...coreValues, version: 1, revenueSyncedAt: new Date() }], { session });
  if (!created) throw new Error("Shipment profitability could not be created.");
  return created;
}

export async function syncProfitabilityRange(input: {
  from?: Date;
  toExclusive?: Date;
  apply: boolean;
}) {
  const issuedAt: Record<string, Date> = {};
  if (input.from) issuedAt.$gte = input.from;
  if (input.toExclusive) issuedAt.$lt = input.toExclusive;
  const filter: Record<string, unknown> = { status: "ISSUED" };
  if (Object.keys(issuedAt).length) filter.issuedAt = issuedAt;
  const invoices = await ShipmentInvoice.find(filter).select("shipmentDraftId invoiceNumber").sort({ issuedAt: 1 }).lean().exec();
  if (!input.apply) return { scanned: invoices.length, synchronized: 0, skipped: 0, failed: 0, issues: [] };
  let synchronized = 0;
  let skipped = 0;
  let failed = 0;
  const issues: Array<{ invoiceNumber: string; shipmentDraftId: string; reason: string }> = [];
  for (const invoice of invoices) {
    try {
      if (await syncShipmentProfitability(invoice.shipmentDraftId)) {
        synchronized += 1;
      } else {
        skipped += 1;
        issues.push({
          invoiceNumber: invoice.invoiceNumber,
          shipmentDraftId: String(invoice.shipmentDraftId),
          reason: "The issued invoice is missing its booking or shipment draft."
        });
      }
    } catch (error) {
      failed += 1;
      issues.push({
        invoiceNumber: invoice.invoiceNumber,
        shipmentDraftId: String(invoice.shipmentDraftId),
        reason: error instanceof Error ? error.message : "Unknown synchronization error."
      });
    }
  }
  return { scanned: invoices.length, synchronized, skipped, failed, issues };
}
