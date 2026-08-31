import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog } from "../models/auditLog.model.js";
import { LogisticsVendor, logisticsVendorTypeValues } from "../models/logisticsVendor.model.js";
import { ShipmentProfitability, type ShipmentProfitabilityCost } from "../models/shipmentProfitability.model.js";
import {
  VendorCostRate,
  profitabilityCostComponentValues,
  vendorCostCalculationValues
} from "../models/vendorCostRate.model.js";
import { allowedBranchIds, canAccessBranch } from "../middleware/branchAccess.middleware.js";
import {
  applyVendorRates,
  calculateProfitabilityTotals,
  normalizeProfitabilityCosts,
  profitabilityCoverageMatch
} from "../services/shipmentProfitability.service.js";

const INDIA_OFFSET = "+05:30";
const DAY_MS = 86_400_000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

type RequestUser = { _id: mongoose.Types.ObjectId; role: string };
function user(request: Request) {
  return (request as Request & { user: RequestUser }).user;
}

function reject(response: Response, status: number, message: string) {
  return response.status(status).json({ success: false, message });
}

function objectId(value: string) {
  return mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(value) : null;
}

function indiaToday(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function dateRange(query: Request["query"], defaults: "MONTH" | "TODAY" = "MONTH") {
  const today = indiaToday();
  const fallbackFrom = defaults === "TODAY" ? today : `${today.slice(0, 7)}-01`;
  const from = typeof query.from === "string" ? query.from : fallbackFrom;
  const to = typeof query.to === "string" ? query.to : today;
  if (!datePattern.test(from) || !datePattern.test(to)) throw new Error("Select a valid reporting date range.");
  const fromDate = new Date(`${from}T00:00:00${INDIA_OFFSET}`);
  const toDate = new Date(`${to}T00:00:00${INDIA_OFFSET}`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
    throw new Error("Select a valid reporting date range.");
  }
  return { from, to, fromDate, toExclusive: new Date(toDate.getTime() + DAY_MS) };
}

function scopedMatch(request: Request, input: { includeDates?: boolean; defaults?: "MONTH" | "TODAY" } = {}) {
  const match: Record<string, unknown> = {};
  const allowed = allowedBranchIds(request);
  const requestedBranch = typeof request.query.branchId === "string" ? request.query.branchId : "";
  if (requestedBranch) {
    if (!objectId(requestedBranch) || !canAccessBranch(request, requestedBranch)) throw new Error("Branch not found");
    match.branchId = new mongoose.Types.ObjectId(requestedBranch);
  } else if (allowed !== null) {
    match.branchId = { $in: allowed.map(objectId).filter((id): id is mongoose.Types.ObjectId => Boolean(id)) };
  }
  const service = typeof request.query.service === "string" ? request.query.service.toUpperCase() : "";
  if (service && ["COURIER", "CARGO"].includes(service)) match.serviceType = service;
  if (input.includeDates !== false) {
    const range = dateRange(request.query, input.defaults);
    match.bookedAt = { $gte: range.fromDate, $lt: range.toExclusive };
    return { match, range };
  }
  return { match, range: null };
}

function serializeCost(cost: ShipmentProfitabilityCost) {
  return {
    component: cost.component,
    amountMinor: cost.amountMinor,
    state: cost.state,
    source: cost.source,
    vendorId: cost.vendorId ? String(cost.vendorId) : null,
    rateId: cost.rateId ? String(cost.rateId) : null,
    reference: cost.reference,
    note: cost.note,
    updatedAt: cost.updatedAt ?? null
  };
}

function serializeProfitability(row: InstanceType<typeof ShipmentProfitability>) {
  const vendor = row.primaryVendorId as unknown as { _id?: mongoose.Types.ObjectId; name?: string; code?: string } | null;
  const flightSheet = row.flightCostSheetId as unknown as {
    _id?: mongoose.Types.ObjectId;
    manifestNumber?: string;
    mawbNumber?: string;
    flightNumber?: string;
    flightDate?: string;
  } | null;
  return {
    id: String(row._id),
    shipmentDraftId: String(row.shipmentDraftId),
    branchId: String(row.branchId),
    businessAccountId: String(row.businessAccountId),
    primaryVendor: vendor && vendor.name
      ? { id: String(vendor._id), name: vendor.name, code: vendor.code ?? "" }
      : null,
    costSource: row.costSource ?? "LEGACY",
    flightCostSheetId: row.flightCostSheetId ? String(flightSheet?._id ?? row.flightCostSheetId) : null,
    operationsManifestId: row.operationsManifestId ? String(row.operationsManifestId) : null,
    flight: flightSheet?.manifestNumber ? {
      manifestNumber: flightSheet.manifestNumber,
      mawbNumber: flightSheet.mawbNumber ?? "",
      flightNumber: flightSheet.flightNumber ?? "",
      flightDate: flightSheet.flightDate ?? ""
    } : null,
    flightAllocation: row.flightAllocation ?? [],
    awb: row.awb,
    customerName: row.customerName,
    originCountryCode: row.originCountryCode,
    destinationCountryCode: row.destinationCountryCode,
    destinationCountryName: row.destinationCountryName,
    serviceType: row.serviceType,
    serviceCode: row.serviceCode,
    chargeableWeightKg: row.chargeableWeightKg,
    bookedAt: row.bookedAt,
    currency: row.currency,
    customerSellingAmountMinor: row.customerSellingAmountMinor,
    revenueAdjustmentMinor: row.revenueAdjustmentMinor,
    totalRevenueMinor: row.totalRevenueMinor,
    dutyTaxMinor: row.dutyTaxMinor,
    costs: row.costs.map((cost) => serializeCost(cost as ShipmentProfitabilityCost)),
    totalCostMinor: row.totalCostMinor,
    grossProfitMinor: row.grossProfitMinor,
    marginBasisPoints: row.marginBasisPoints ?? null,
    coverage: row.coverage,
    version: row.version,
    updatedAt: row.updatedAt
  };
}

export async function getProfitabilityOverview(request: Request, response: Response) {
  try {
    const { match } = scopedMatch(request, { includeDates: false });
    const todayRange = dateRange({}, "TODAY");
    const monthRange = dateRange({}, "MONTH");
    const todayMatch = { ...match, bookedAt: { $gte: todayRange.fromDate, $lt: todayRange.toExclusive } };
    const monthMatch = { ...match, bookedAt: { $gte: monthRange.fromDate, $lt: monthRange.toExclusive } };

    const branchMatch = (match.branchId !== undefined ? { branchId: match.branchId } : {}) as Record<string, unknown>;
    const [todayRows, monthlyTrend, lossMaking, customers, lanes, coverage, flightLossMaking, destinations, sheetsRequiringCompletion, monthlyProfit] = await Promise.all([
      ShipmentProfitability.aggregate<{ revenueMinor: number; costMinor: number; profitMinor: number }>([
        { $match: todayMatch },
        { $group: { _id: null, revenueMinor: { $sum: "$totalRevenueMinor" }, costMinor: { $sum: "$totalCostMinor" }, profitMinor: { $sum: "$grossProfitMinor" } } }
      ]).exec(),
      ShipmentProfitability.aggregate<{ date: string; revenueMinor: number; costMinor: number; profitMinor: number }>([
        { $match: monthMatch },
        { $group: { _id: { $dateToString: { date: "$bookedAt", format: "%Y-%m-%d", timezone: "Asia/Kolkata" } }, revenueMinor: { $sum: "$totalRevenueMinor" }, costMinor: { $sum: "$totalCostMinor" }, profitMinor: { $sum: "$grossProfitMinor" } } },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: "$_id", revenueMinor: 1, costMinor: 1, profitMinor: 1 } }
      ]).exec(),
      ShipmentProfitability.find({ ...monthMatch, grossProfitMinor: { $lt: 0 }, coverage: { $ne: "MISSING" } })
        .populate("primaryVendorId", "name code")
        .populate("flightCostSheetId", "manifestNumber mawbNumber flightNumber flightDate")
        .sort({ grossProfitMinor: 1 }).limit(5).exec(),
      ShipmentProfitability.aggregate<{ businessAccountId: string; customerName: string; shipments: number; revenueMinor: number; costMinor: number; profitMinor: number }>([
        { $match: monthMatch },
        { $group: { _id: "$businessAccountId", customerName: { $max: "$customerName" }, shipments: { $sum: 1 }, revenueMinor: { $sum: "$totalRevenueMinor" }, costMinor: { $sum: "$totalCostMinor" }, profitMinor: { $sum: "$grossProfitMinor" } } },
        { $sort: { profitMinor: -1 } }, { $limit: 5 },
        { $project: { _id: 0, businessAccountId: { $toString: "$_id" }, customerName: 1, shipments: 1, revenueMinor: 1, costMinor: 1, profitMinor: 1 } }
      ]).exec(),
      ShipmentProfitability.aggregate<{ originCountryCode: string; destinationCountryCode: string; destinationCountryName: string; serviceType: string; shipments: number; revenueMinor: number; costMinor: number; profitMinor: number }>([
        { $match: monthMatch },
        { $group: { _id: { originCountryCode: "$originCountryCode", destinationCountryCode: "$destinationCountryCode", serviceType: "$serviceType" }, destinationCountryName: { $max: "$destinationCountryName" }, shipments: { $sum: 1 }, revenueMinor: { $sum: "$totalRevenueMinor" }, costMinor: { $sum: "$totalCostMinor" }, profitMinor: { $sum: "$grossProfitMinor" } } },
        { $sort: { profitMinor: -1 } }, { $limit: 5 },
        { $project: { _id: 0, originCountryCode: "$_id.originCountryCode", destinationCountryCode: "$_id.destinationCountryCode", destinationCountryName: 1, serviceType: "$_id.serviceType", shipments: 1, revenueMinor: 1, costMinor: 1, profitMinor: 1 } }
      ]).exec(),
      ShipmentProfitability.aggregate<{ coverage: string; count: number }>([
        { $match: monthMatch }, { $group: { _id: "$coverage", count: { $sum: 1 } } },
        { $project: { _id: 0, coverage: "$_id", count: 1 } }
      ]).exec(),
      // Flight-level loss-making sheets
      (await import("../models/flightCostSheet.model.js")).FlightCostSheet.find({ ...branchMatch, status: { $ne: "CANCELLED" }, "totals.grossProfitMinor": { $lt: 0 } }).sort({ "totals.grossProfitMinor": 1 }).limit(5).lean().exec(),
      ShipmentProfitability.aggregate<{ destinationCountryCode: string; destinationCountryName: string; shipments: number; profitMinor: number }>([
        { $match: monthMatch },
        { $group: { _id: "$destinationCountryCode", destinationCountryName: { $max: "$destinationCountryName" }, shipments: { $sum: 1 }, profitMinor: { $sum: "$grossProfitMinor" } } },
        { $sort: { profitMinor: -1 } }, { $limit: 5 },
        { $project: { _id: 0, destinationCountryCode: "$_id", destinationCountryName: 1, shipments: 1, profitMinor: 1 } }
      ]).exec(),
      (await import("../models/flightCostSheet.model.js")).FlightCostSheet.find({ ...branchMatch, status: { $in: ["DRAFT", "REVIEW_REQUIRED"] } }).sort({ flightDate: 1 }).limit(10).select("manifestNumber mawbNumber flightNumber flightDate vendorId totals status branchId").populate("vendorId", "name code").lean().exec(),
      ShipmentProfitability.aggregate<{ profitMinor: number }>([{ $match: monthMatch }, { $group: { _id: null, profitMinor: { $sum: "$grossProfitMinor" } } }]).exec()
    ]);

    const today = todayRows[0] ?? { revenueMinor: 0, costMinor: 0, profitMinor: 0 };
    const monthlyProfitVal = monthlyProfit[0]?.profitMinor ?? 0;
    return response.status(200).json({
      success: true,
      currency: "INR",
      today: { ...today, marginBasisPoints: today.revenueMinor > 0 ? Math.round((today.profitMinor / today.revenueMinor) * 10000) : null },
      monthlyTrend,
      monthlyProfitMinor: monthlyProfitVal,
      lossMaking: lossMaking.map(serializeProfitability),
      lossMakingFlights: flightLossMaking.map((s: any) => ({
        id: String(s._id), manifestNumber: s.manifestNumber, mawbNumber: s.mawbNumber, flightNumber: s.flightNumber, flightDate: s.flightDate,
        vendor: s.vendorId && typeof s.vendorId === "object" && "name" in s.vendorId ? { id: String((s.vendorId as any)._id), name: (s.vendorId as any).name, code: (s.vendorId as any).code } : null,
        destinationCountryName: s.destinationCountryName, totalCostMinor: s.totals.totalCostMinor, totalRevenueMinor: s.totals.totalRevenueMinor, grossProfitMinor: s.totals.grossProfitMinor, marginBasisPoints: s.totals.marginBasisPoints, status: s.status
      })),
      mostProfitableCustomers: customers,
      mostProfitableLanes: lanes,
      mostProfitableDestinations: destinations,
      sheetsRequiringCompletion: sheetsRequiringCompletion.map((s: any) => ({
        id: String(s._id), manifestNumber: s.manifestNumber, mawbNumber: s.mawbNumber, flightNumber: s.flightNumber, flightDate: s.flightDate,
        vendor: s.vendorId && typeof s.vendorId === "object" && "name" in s.vendorId ? { id: String((s.vendorId as any)._id), name: (s.vendorId as any).name } : null,
        status: s.status, totalCostMinor: s.totals.totalCostMinor
      })),
      coverage
    });
  } catch (error) {
    return reject(response, error instanceof Error && error.message === "Branch not found" ? 404 : 400, error instanceof Error ? error.message : "Profitability could not be loaded.");
  }
}

export async function listShipmentProfitability(request: Request, response: Response) {
  try {
    const { match, range } = scopedMatch(request);
    const page = Math.max(1, Number(request.query.page) || 1);
    const limit = Math.min(100, Math.max(10, Number(request.query.limit) || 25));
    const search = typeof request.query.search === "string" ? request.query.search.trim() : "";
    const coverage = typeof request.query.coverage === "string" ? request.query.coverage.toUpperCase() : "";
    const result = typeof request.query.result === "string" ? request.query.result.toUpperCase() : "";
    Object.assign(match, profitabilityCoverageMatch(coverage));
    if (result === "PROFIT") match.grossProfitMinor = { $gte: 0 };
    if (result === "LOSS") match.grossProfitMinor = { $lt: 0 };
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      match.$or = [{ awb: { $regex: escaped, $options: "i" } }, { customerName: { $regex: escaped, $options: "i" } }, { destinationCountryName: { $regex: escaped, $options: "i" } }];
    }
    const sortFields: Record<string, string> = { bookedAt: "bookedAt", revenue: "totalRevenueMinor", cost: "totalCostMinor", profit: "grossProfitMinor", margin: "marginBasisPoints" };
    const sortBy = sortFields[String(request.query.sortBy ?? "bookedAt")] ?? "bookedAt";
    const sortDirection = request.query.sortDirection === "asc" ? 1 : -1;
    const [rows, total] = await Promise.all([
      ShipmentProfitability.find(match)
        .populate("primaryVendorId", "name code")
        .populate("flightCostSheetId", "manifestNumber mawbNumber flightNumber flightDate")
        .sort({ [sortBy]: sortDirection, _id: -1 }).skip((page - 1) * limit).limit(limit).exec(),
      ShipmentProfitability.countDocuments(match).exec()
    ]);
    return response.status(200).json({ success: true, currency: "INR", period: range, rows: rows.map(serializeProfitability), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    return reject(response, error instanceof Error && error.message === "Branch not found" ? 404 : 400, error instanceof Error ? error.message : "Profitability could not be loaded.");
  }
}

const manualCostSchema = z.object({
  component: z.enum(profitabilityCostComponentValues),
  amountMinor: z.number().int().min(0).nullable(),
  reference: z.string().trim().max(120).optional().default(""),
  note: z.string().trim().max(500).optional().default("")
});
const costUpdateSchema = z.object({
  expectedVersion: z.number().int().min(1),
  primaryVendorId: z.string().trim().nullable().optional(),
  costs: z.array(manualCostSchema).max(profitabilityCostComponentValues.length).default([]),
  reason: z.string().trim().min(3).max(500)
});

export async function updateShipmentProfitabilityCosts(request: Request, response: Response) {
  const id = objectId(String(request.params.shipmentDraftId ?? ""));
  if (!id) return reject(response, 404, "Shipment not found");
  const parsed = costUpdateSchema.safeParse(request.body);
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter valid shipment costs.");
  const profile = await ShipmentProfitability.findOne({ shipmentDraftId: id }).exec();
  if (!profile || !canAccessBranch(request, profile.branchId)) return reject(response, 404, "Shipment not found");
  if (profile.costSource === "FLIGHT_ALLOCATION") {
    return reject(response, 409, "This shipment receives costs from its flight cost sheet. Update the flight instead.");
  }
  if (profile.version !== parsed.data.expectedVersion) return reject(response, 409, "Shipment costs changed. Reload and review the latest values.");

  let vendorId = profile.primaryVendorId ?? null;
  if (parsed.data.primaryVendorId !== undefined) {
    vendorId = parsed.data.primaryVendorId ? objectId(parsed.data.primaryVendorId) : null;
    if (parsed.data.primaryVendorId && !vendorId) return reject(response, 400, "Select a valid vendor.");
    if (vendorId && !await LogisticsVendor.exists({ _id: vendorId, status: "ACTIVE" })) return reject(response, 400, "Select an active vendor.");
  }
  const actor = user(request)._id;
  const now = new Date();
  let costs = normalizeProfitabilityCosts(profile.costs as ShipmentProfitabilityCost[]);
  const changes = new Map(parsed.data.costs.map((cost) => [cost.component, cost]));
  costs = costs.map((cost) => {
    const change = changes.get(cost.component);
    if (!change) return cost;
    if (change.amountMinor === null) return { ...cost, amountMinor: 0, state: "MISSING" as const, source: "NONE" as const, vendorId: null, rateId: null, reference: "", note: "", updatedBy: actor, updatedAt: now };
    return { ...cost, amountMinor: change.amountMinor, state: "ACTUAL" as const, source: "MANUAL" as const, vendorId, rateId: null, reference: change.reference, note: change.note, updatedBy: actor, updatedAt: now };
  });
  if (vendorId) {
    costs = await applyVendorRates({ vendorId, bookedAt: profile.bookedAt, destinationCountryCode: profile.destinationCountryCode, serviceType: profile.serviceType, chargeableWeightKg: profile.chargeableWeightKg, costs });
  } else {
    costs = costs.map((cost) => cost.state === "ESTIMATED" ? { ...cost, amountMinor: 0, state: "MISSING" as const, source: "NONE" as const, vendorId: null, rateId: null } : cost);
  }
  const totals = calculateProfitabilityTotals({ totalRevenueMinor: profile.totalRevenueMinor, costs });
  const updated = await ShipmentProfitability.findOneAndUpdate(
    { _id: profile._id, version: parsed.data.expectedVersion },
    { $set: { primaryVendorId: vendorId, ...totals }, $inc: { version: 1 } },
    { returnDocument: "after", runValidators: true }
  ).populate("primaryVendorId", "name code").exec();
  if (!updated) return reject(response, 409, "Shipment costs changed. Reload and review the latest values.");
  await AuditLog.create({ action: "SHIPMENT_PROFITABILITY_COST_UPDATED", entityType: "SHIPMENT_PROFITABILITY", entityId: updated._id, performedBy: actor, performedAt: now, metadata: { shipmentDraftId: id, reason: parsed.data.reason, components: [...changes.keys()], primaryVendorId: vendorId } });
  return response.status(200).json({ success: true, message: "Shipment costs updated.", profitability: serializeProfitability(updated) });
}

const vendorSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9_-]+$/),
  type: z.enum(logisticsVendorTypeValues),
  integrationCode: z.enum(["", "ALS_DPD"]).optional().default("")
});

export async function listLogisticsVendors(_request: Request, response: Response) {
  const vendors = await LogisticsVendor.find().sort({ status: 1, name: 1 }).lean().exec();
  return response.status(200).json({ success: true, vendors });
}

export async function createLogisticsVendor(request: Request, response: Response) {
  const parsed = vendorSchema.safeParse(request.body);
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter valid vendor details.");
  try {
    const vendor = await LogisticsVendor.create({ ...parsed.data, code: parsed.data.code.toUpperCase(), createdBy: user(request)._id });
    await AuditLog.create({ action: "LOGISTICS_VENDOR_CREATED", entityType: "LOGISTICS_VENDOR", entityId: vendor._id, performedBy: user(request)._id, performedAt: new Date(), metadata: { code: vendor.code } });
    return response.status(201).json({ success: true, message: "Vendor created.", vendor });
  } catch (error) {
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) return reject(response, 409, "Vendor code or integration already exists.");
    throw error;
  }
}

const vendorStatusSchema = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]), reason: z.string().trim().min(3).max(500) });
export async function updateLogisticsVendorStatus(request: Request, response: Response) {
  const id = objectId(String(request.params.vendorId ?? ""));
  const parsed = vendorStatusSchema.safeParse(request.body);
  if (!id) return reject(response, 404, "Vendor not found");
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter a valid status.");
  const vendor = await LogisticsVendor.findByIdAndUpdate(id, { $set: { status: parsed.data.status, updatedBy: user(request)._id } }, { returnDocument: "after", runValidators: true }).exec();
  if (!vendor) return reject(response, 404, "Vendor not found");
  await AuditLog.create({ action: "LOGISTICS_VENDOR_UPDATED", entityType: "LOGISTICS_VENDOR", entityId: vendor._id, performedBy: user(request)._id, performedAt: new Date(), metadata: { status: vendor.status, reason: parsed.data.reason } });
  return response.status(200).json({ success: true, message: "Vendor updated.", vendor });
}

const rateSchema = z.object({
  vendorId: z.string().trim(),
  component: z.enum(profitabilityCostComponentValues),
  originCountryCode: z.string().trim().length(2).default("IN"),
  destinationCountryCode: z.string().trim().length(2),
  destinationCountryName: z.string().trim().min(2).max(80),
  service: z.enum(["COURIER", "CARGO"]),
  fromKg: z.number().min(0),
  toKg: z.number().min(0),
  calculation: z.enum(vendorCostCalculationValues),
  amountMinor: z.number().int().min(0),
  percentageBasisPoints: z.number().int().min(0).max(10000).default(0),
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().nullable().optional()
}).refine((value) => value.toKg >= value.fromKg, { message: "The ending weight must not be below the starting weight." })
  .refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, { message: "The end date must not be before the start date." })
  .refine((value) => value.calculation === "PERCENT_OF_FREIGHT" ? value.percentageBasisPoints > 0 : true, { message: "Enter the freight percentage." });

export async function listVendorCostRates(request: Request, response: Response) {
  const vendorId = typeof request.query.vendorId === "string" ? objectId(request.query.vendorId) : null;
  const filter = vendorId ? { vendorId } : {};
  const rates = await VendorCostRate.find(filter).populate("vendorId", "name code status").sort({ status: 1, destinationCountryName: 1, service: 1, fromKg: 1 }).exec();
  return response.status(200).json({ success: true, rates });
}

export async function createVendorCostRate(request: Request, response: Response) {
  const parsed = rateSchema.safeParse(request.body);
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter a valid buying rate.");
  const vendorId = objectId(parsed.data.vendorId);
  if (!vendorId || !await LogisticsVendor.exists({ _id: vendorId, status: "ACTIVE" })) return reject(response, 400, "Select an active vendor.");
  const data = { ...parsed.data, vendorId, originCountryCode: parsed.data.originCountryCode.toUpperCase(), destinationCountryCode: parsed.data.destinationCountryCode.toUpperCase(), effectiveTo: parsed.data.effectiveTo ?? null };
  const dateOverlap: Record<string, unknown>[] = [{ effectiveTo: null }, { effectiveTo: { $gte: data.effectiveFrom } }];
  const overlap = await VendorCostRate.exists({ vendorId, component: data.component, originCountryCode: data.originCountryCode, destinationCountryCode: data.destinationCountryCode, service: data.service, status: "ACTIVE", fromKg: { $lte: data.toKg }, toKg: { $gte: data.fromKg }, effectiveFrom: { $lte: data.effectiveTo ?? new Date("9999-12-31") }, $or: dateOverlap });
  if (overlap) return reject(response, 409, "An active buying rate already covers this vendor, lane, service, weight, and date.");
  const rate = await VendorCostRate.create({ ...data, amountMinor: data.calculation === "PERCENT_OF_FREIGHT" ? 0 : data.amountMinor, createdBy: user(request)._id });
  await AuditLog.create({ action: "VENDOR_COST_RATE_CREATED", entityType: "VENDOR_COST_RATE", entityId: rate._id, performedBy: user(request)._id, performedAt: new Date(), metadata: { vendorId, component: rate.component, destinationCountryCode: rate.destinationCountryCode, service: rate.service } });
  return response.status(201).json({ success: true, message: "Buying rate created.", rate });
}

const retireRateSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export async function retireVendorCostRate(request: Request, response: Response) {
  const id = objectId(String(request.params.rateId ?? ""));
  const parsed = retireRateSchema.safeParse(request.body);
  if (!id) return reject(response, 404, "Buying rate not found");
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter a reason.");
  const rate = await VendorCostRate.findOneAndUpdate({ _id: id, status: "ACTIVE" }, { $set: { status: "RETIRED", effectiveTo: new Date(), updatedBy: user(request)._id } }, { returnDocument: "after", runValidators: true }).exec();
  if (!rate) return reject(response, 404, "Active buying rate not found");
  await AuditLog.create({ action: "VENDOR_COST_RATE_RETIRED", entityType: "VENDOR_COST_RATE", entityId: rate._id, performedBy: user(request)._id, performedAt: new Date(), metadata: { reason: parsed.data.reason } });
  return response.status(200).json({ success: true, message: "Buying rate retired.", rate });
}
