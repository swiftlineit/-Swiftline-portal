import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { allowedBranchIds, canAccessBranch } from "../middleware/branchAccess.middleware.js";
import { AuditLog } from "../models/auditLog.model.js";
import { FlightBuyingRate, flightRateRegionValues } from "../models/flightBuyingRate.model.js";
import { FlightCostAllocation } from "../models/flightCostAllocation.model.js";
import { FlightCostSheet, flightCostSheetStatusValues, type IFlightCostSheet } from "../models/flightCostSheet.model.js";
import { LogisticsVendor } from "../models/logisticsVendor.model.js";
import { OperationsManifest } from "../models/operationsManifest.model.js";
import {
  calculateFlightCostTotals,
  copyRateSnapshot,
  getGbpToInrRate,
  loadFlightOperationalFacts,
  markSheetReviewRequiredIfChanged,
  rebuildFlightAllocations,
  refreshSheetFactsAndTotals,
  saveFlightCostRevision
} from "../services/flightProfitability.service.js";
import { FlightCostSheetRevision } from "../models/flightCostSheetRevision.model.js";

type RequestUser = { _id: mongoose.Types.ObjectId; role: string };
function actor(request: Request) { return (request as Request & { user: RequestUser }).user; }
function reject(response: Response, status: number, message: string) { return response.status(status).json({ success: false, message }); }
function objectId(value: unknown) { return mongoose.Types.ObjectId.isValid(String(value ?? "")) ? new mongoose.Types.ObjectId(String(value)) : null; }

function branchFilter(request: Request) {
  const allowed = allowedBranchIds(request);
  const requested = typeof request.query.branchId === "string" ? request.query.branchId : "";
  if (requested) {
    if (!objectId(requested) || !canAccessBranch(request, requested)) throw new Error("Branch not found");
    return { branchId: new mongoose.Types.ObjectId(requested) };
  }
  if (allowed === null) return {};
  return { branchId: { $in: allowed.map(objectId).filter((id): id is mongoose.Types.ObjectId => Boolean(id)) } };
}

function serializeRate(rate: any) {
  const vendor = rate.vendorId && typeof rate.vendorId === "object" && "name" in rate.vendorId ? rate.vendorId : null;
  return {
    id: String(rate._id),
    vendor: vendor ? { id: String(vendor._id), name: vendor.name, code: vendor.code, status: vendor.status } : { id: String(rate.vendorId) },
    region: rate.region,
    airFreightRateMinorPerKg: rate.airFreightRateMinorPerKg,
    gstBasisPoints: rate.gstBasisPoints,
    eicfRateMinorPerKg: rate.eicfRateMinorPerKg,
    customsMinor: rate.customsMinor,
    transportationMinor: rate.transportationMinor,
    cflMinorPerBagGbp: rate.cflMinorPerBagGbp,
    dpdLabelMinorGbp: rate.dpdLabelMinorGbp,
    effectiveFrom: rate.effectiveFrom,
    effectiveTo: rate.effectiveTo ?? null,
    status: rate.status,
    createdAt: rate.createdAt,
    updatedAt: rate.updatedAt
  };
}

function serializeSheet(sheet: any) {
  const vendor = sheet.vendorId && typeof sheet.vendorId === "object" && "name" in sheet.vendorId ? sheet.vendorId : null;
  return {
    id: String(sheet._id),
    operationsManifestId: String(sheet.operationsManifestId),
    branchId: String(sheet.branchId),
    buyingRateId: String(sheet.buyingRateId?._id ?? sheet.buyingRateId),
    vendor: vendor ? { id: String(vendor._id), name: vendor.name, code: vendor.code } : { id: String(sheet.vendorId) },
    manifestNumber: sheet.manifestNumber,
    region: sheet.region,
    airlineName: sheet.airlineName,
    mawbNumber: sheet.mawbNumber,
    flightNumber: sheet.flightNumber,
    flightDate: sheet.flightDate,
    destinationCountryCode: sheet.destinationCountryCode,
    destinationCountryName: sheet.destinationCountryName,
    manifestWeightKg: sheet.manifestWeightKg,
    billedWeightKg: sheet.billedWeightKg,
    billedWeightOverrideReason: sheet.billedWeightOverrideReason,
    totalBags: sheet.totalBags,
    totalParcels: sheet.totalParcels,
    portalDpdLabels: sheet.portalDpdLabels,
    externalPaidLabels: sheet.externalPaidLabels,
    externalLabelReference: sheet.externalLabelReference,
    externalLabelReason: sheet.externalLabelReason,
    missingDpdLabels: sheet.missingDpdLabels,
    billableLabels: sheet.billableLabels,
    rateSnapshot: sheet.rateSnapshot,
    fxSnapshot: sheet.fxSnapshot,
    totals: sheet.totals,
    status: sheet.status,
    version: sheet.version,
    revision: sheet.revision,
    notes: sheet.notes,
    lastChangeReason: sheet.lastChangeReason,
    finalizedAt: sheet.finalizedAt ?? null,
    createdAt: sheet.createdAt,
    updatedAt: sheet.updatedAt
  };
}

const rateInput = z.object({
  vendorId: z.string().trim(),
  region: z.enum(flightRateRegionValues),
  airFreightRateMinorPerKg: z.number().int().min(0),
  gstBasisPoints: z.number().int().min(0).max(10_000).default(1_800),
  eicfRateMinorPerKg: z.number().int().min(0),
  customsMinor: z.number().int().min(0),
  transportationMinor: z.number().int().min(0),
  cflMinorPerBagGbp: z.number().int().min(0),
  dpdLabelMinorGbp: z.number().int().min(0),
  effectiveFrom: z.coerce.date(),
  effectiveTo: z.coerce.date().nullable().optional(),
  reason: z.string().trim().min(3).max(500)
}).refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
  message: "The end date must not be before the start date."
});

async function overlappingRate(data: z.infer<typeof rateInput>, excludeId?: mongoose.Types.ObjectId) {
  const vendorId = objectId(data.vendorId);
  if (!vendorId) return false;
  return FlightBuyingRate.exists({
    _id: excludeId ? { $ne: excludeId } : { $exists: true },
    vendorId,
    region: data.region,
    status: "ACTIVE",
    effectiveFrom: { $lte: data.effectiveTo ?? new Date("9999-12-31") },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: data.effectiveFrom } }]
  });
}

export async function listFlightBuyingRates(_request: Request, response: Response) {
  const rates = await FlightBuyingRate.find().populate("vendorId", "name code status").sort({ status: 1, region: 1, effectiveFrom: -1 }).exec();
  return response.status(200).json({ success: true, rates: rates.map(serializeRate) });
}

export async function createFlightBuyingRate(request: Request, response: Response) {
  const parsed = rateInput.safeParse(request.body);
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter a valid buying rate.");
  const vendorId = objectId(parsed.data.vendorId);
  if (!vendorId || !await LogisticsVendor.exists({ _id: vendorId, status: "ACTIVE" })) return reject(response, 400, "Select an active vendor.");
  if (await overlappingRate(parsed.data)) return reject(response, 409, "An active rate already covers this vendor, region and date.");
  const { reason, ...values } = parsed.data;
  const rate = await FlightBuyingRate.create({ ...values, vendorId, effectiveTo: values.effectiveTo ?? null, createdBy: actor(request)._id });
  await AuditLog.create({ action: "FLIGHT_BUYING_RATE_CREATED", entityType: "FLIGHT_BUYING_RATE", entityId: rate._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { vendorId, region: rate.region, reason } });
  await rate.populate("vendorId", "name code status");
  return response.status(201).json({ success: true, message: "Buying rate created.", rate: serializeRate(rate) });
}

export async function updateFlightBuyingRate(request: Request, response: Response) {
  const rateId = objectId(request.params.rateId);
  const parsed = rateInput.safeParse(request.body);
  if (!rateId) return reject(response, 404, "Buying rate not found.");
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter a valid buying rate.");
  const vendorId = objectId(parsed.data.vendorId);
  if (!vendorId || !await LogisticsVendor.exists({ _id: vendorId, status: "ACTIVE" })) return reject(response, 400, "Select an active vendor.");
  if (await overlappingRate(parsed.data, rateId)) return reject(response, 409, "An active rate already covers this vendor, region and date.");
  const { reason, ...values } = parsed.data;
  const rate = await FlightBuyingRate.findOneAndUpdate(
    { _id: rateId, status: "ACTIVE" },
    { $set: { ...values, vendorId, effectiveTo: values.effectiveTo ?? null, updatedBy: actor(request)._id } },
    { returnDocument: "after", runValidators: true }
  ).populate("vendorId", "name code status").exec();
  if (!rate) return reject(response, 404, "Active buying rate not found.");
  await AuditLog.create({ action: "FLIGHT_BUYING_RATE_UPDATED", entityType: "FLIGHT_BUYING_RATE", entityId: rate._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { reason } });
  return response.status(200).json({ success: true, message: "Buying rate updated.", rate: serializeRate(rate) });
}

export async function deleteFlightBuyingRate(request: Request, response: Response) {
  const rateId = objectId(request.params.rateId);
  const parsed = z.object({ reason: z.string().trim().min(3).max(500) }).safeParse(request.body);
  if (!rateId) return reject(response, 404, "Buying rate not found.");
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter a deletion reason.");
  const rate = await FlightBuyingRate.findOneAndUpdate(
    { _id: rateId, status: "ACTIVE" },
    { $set: { status: "DELETED", deletedBy: actor(request)._id, deletedAt: new Date(), deletionReason: parsed.data.reason, updatedBy: actor(request)._id } },
    { returnDocument: "after", runValidators: true }
  ).populate("vendorId", "name code status").exec();
  if (!rate) return reject(response, 404, "Active buying rate not found.");
  await AuditLog.create({ action: "FLIGHT_BUYING_RATE_DELETED", entityType: "FLIGHT_BUYING_RATE", entityId: rate._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { reason: parsed.data.reason } });
  return response.status(200).json({ success: true, message: "Buying rate deleted.", rate: serializeRate(rate) });
}

export async function getExchangeRate(_request: Request, response: Response) {
  try {
    const rate = await getGbpToInrRate();
    return response.status(200).json({ success: true, rate });
  } catch (error) {
    return reject(response, 503, error instanceof Error ? error.message : "The GBP/INR rate is unavailable.");
  }
}

export async function listFlightManifestOptions(request: Request, response: Response) {
  try {
    const filter: Record<string, unknown> = { ...branchFilter(request), status: { $ne: "CANCELLED" } };
    const manifests = await OperationsManifest.find(filter).sort({ updatedAt: -1 }).limit(200).lean().exec();
    const sheets = await FlightCostSheet.find({ operationsManifestId: { $in: manifests.map((item) => item._id) } }).select("operationsManifestId status _id").lean().exec();
    const sheetByManifest = new Map(sheets.map((item) => [String(item.operationsManifestId), item]));
    return response.status(200).json({
      success: true,
      manifests: manifests.map((manifest) => {
        const sheet = sheetByManifest.get(String(manifest._id));
        return {
          id: String(manifest._id), manifestNumber: manifest.manifestNumber, branchId: String(manifest.branchId),
          header: manifest.header, status: manifest.status, totalBags: manifest.totalBags,
          totalParcels: manifest.totalPhysicalParcels, totalWeightKg: manifest.totalWeightKg,
          costSheet: sheet ? { id: String(sheet._id), status: sheet.status } : null
        };
      })
    });
  } catch (error) {
    return reject(response, error instanceof Error && error.message === "Branch not found" ? 404 : 400, error instanceof Error ? error.message : "Flight manifests could not be loaded.");
  }
}

export async function getFlightManifestPreview(request: Request, response: Response) {
  const manifestId = objectId(request.params.manifestId);
  if (!manifestId) return reject(response, 404, "Operations manifest not found.");
  const manifest = await OperationsManifest.findById(manifestId).exec();
  if (!manifest || !canAccessBranch(request, manifest.branchId)) return reject(response, 404, "Operations manifest not found.");
  const { facts } = await loadFlightOperationalFacts(manifestId, 0);
  return response.status(200).json({
    success: true,
    manifest: {
      id: String(manifest._id), manifestNumber: manifest.manifestNumber, branchId: String(manifest.branchId),
      header: manifest.header, status: manifest.status, ...facts
    }
  });
}

export async function listFlightCostSheets(request: Request, response: Response) {
  try {
    const filter: Record<string, unknown> = branchFilter(request);
    const status = String(request.query.status ?? "").toUpperCase();
    const vendorId = typeof request.query.vendorId === "string" ? request.query.vendorId.trim() : "";
    const from = typeof request.query.from === "string" ? request.query.from.trim() : "";
    const to = typeof request.query.to === "string" ? request.query.to.trim() : "";
    if (flightCostSheetStatusValues.includes(status as any)) filter.status = status;
    else if (status === "PROVISIONAL") filter.status = { $in: ["DRAFT", "REVIEW_REQUIRED"] };
    else if (status === "ACTUAL") filter.status = "FINALIZED";
    if (vendorId && objectId(vendorId)) filter.vendorId = new mongoose.Types.ObjectId(vendorId);
    if (from || to) {
      const dateFilter: Record<string, string> = {};
      if (from) dateFilter.$gte = from;
      if (to) dateFilter.$lte = to;
      filter.flightDate = dateFilter;
    }
    const sheets = await FlightCostSheet.find(filter).populate("vendorId", "name code status").sort({ flightDate: -1, updatedAt: -1 }).limit(250).exec();
    return response.status(200).json({ success: true, sheets: sheets.map(serializeSheet) });
  } catch (error) {
    return reject(response, error instanceof Error && error.message === "Branch not found" ? 404 : 400, error instanceof Error ? error.message : "Flight costs could not be loaded.");
  }
}

const fxInput = z.object({
  gbpToInr: z.number().positive(),
  provider: z.string().trim().min(2).max(80),
  providerUpdatedAt: z.coerce.date().nullable().optional(),
  fetchedAt: z.coerce.date(),
  isManual: z.boolean().default(false),
  manualReason: z.string().trim().max(500).default("")
}).refine((value) => !value.isManual || value.manualReason.length >= 3, { message: "Enter a reason for the manual exchange rate." });

const createSheetBase = z.object({
  operationsManifestId: z.string().trim(),
  buyingRateId: z.string().trim(),
  airlineName: z.string().trim().min(2).max(120),
  billedWeightKg: z.number().positive().optional(),
  billedWeightOverrideReason: z.string().trim().max(500).default(""),
  externalPaidLabels: z.number().int().min(0).default(0),
  externalLabelReference: z.string().trim().max(120).default(""),
  externalLabelReason: z.string().trim().max(500).default(""),
  fxSnapshot: fxInput,
  notes: z.string().trim().max(1000).default(""),
  reason: z.string().trim().min(3).max(500)
});

const createSheetInput = createSheetBase
  .refine((value) => !value.billedWeightKg || value.billedWeightOverrideReason.length >= 3, { message: "Enter a reason when overriding billed weight." })
  .refine((value) => !value.externalPaidLabels || (value.externalLabelReference.length >= 2 && value.externalLabelReason.length >= 3), { message: "Enter the external-label reference and reason." });

const updateSheetBase = z.object({
  buyingRateId: z.string().trim(),
  airlineName: z.string().trim().min(2).max(120),
  billedWeightKg: z.number().positive().optional(),
  billedWeightOverrideReason: z.string().trim().max(500).default(""),
  externalPaidLabels: z.number().int().min(0).default(0),
  externalLabelReference: z.string().trim().max(120).default(""),
  externalLabelReason: z.string().trim().max(500).default(""),
  fxSnapshot: fxInput,
  notes: z.string().trim().max(1000).default(""),
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.number().int().min(1)
});

const updateSheetInput = updateSheetBase
  .refine((value) => !value.billedWeightKg || value.billedWeightOverrideReason.length >= 3, { message: "Enter a reason when overriding billed weight." })
  .refine((value) => !value.externalPaidLabels || (value.externalLabelReference.length >= 2 && value.externalLabelReason.length >= 3), { message: "Enter the external-label reference and reason." });

function ensureManifestHeader(manifest: InstanceType<typeof OperationsManifest>) {
  if (!manifest.header.mawbNumber || !manifest.header.flightNumber || !manifest.header.departureDate || !manifest.header.destinationCountryCode) {
    throw new Error("Complete the manifest MAWB, flight, date and destination before creating flight costs.");
  }
}

export async function createFlightCostSheet(request: Request, response: Response) {
  const parsed = createSheetInput.safeParse(request.body);
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter valid flight costs.");
  const manifestId = objectId(parsed.data.operationsManifestId);
  const rateId = objectId(parsed.data.buyingRateId);
  if (!manifestId || !rateId) return reject(response, 404, "Manifest or buying rate not found.");
  const manifest = await OperationsManifest.findById(manifestId).exec();
  if (!manifest || !canAccessBranch(request, manifest.branchId)) return reject(response, 404, "Operations manifest not found.");
  try { ensureManifestHeader(manifest); } catch (error) { return reject(response, 409, (error as Error).message); }
  if (await FlightCostSheet.exists({ operationsManifestId: manifestId })) return reject(response, 409, "This manifest already has a flight cost sheet.");
  const rate = await FlightBuyingRate.findOne({ _id: rateId, status: "ACTIVE" }).exec();
  if (!rate) return reject(response, 404, "Active buying rate not found.");
  const { facts } = await loadFlightOperationalFacts(manifestId, parsed.data.externalPaidLabels);
  const billedWeightKg = parsed.data.billedWeightKg ?? facts.manifestWeightKg;
  const now = new Date();
  const totals = calculateFlightCostTotals({ rate: copyRateSnapshot(rate), facts: { ...facts, billedWeightKg }, gbpToInr: parsed.data.fxSnapshot.gbpToInr });
  try {
    const sheet = await FlightCostSheet.create({
      operationsManifestId: manifestId, branchId: manifest.branchId, buyingRateId: rate._id, vendorId: rate.vendorId,
      manifestNumber: manifest.manifestNumber, region: rate.region, airlineName: parsed.data.airlineName,
      mawbNumber: manifest.header.mawbNumber, flightNumber: manifest.header.flightNumber, flightDate: manifest.header.departureDate,
      destinationCountryCode: manifest.header.destinationCountryCode, destinationCountryName: manifest.header.destinationCountryName,
      manifestWeightKg: facts.manifestWeightKg, billedWeightKg, billedWeightOverrideReason: parsed.data.billedWeightOverrideReason,
      totalBags: facts.totalBags, totalParcels: facts.totalParcels, portalDpdLabels: facts.portalDpdLabels,
      externalPaidLabels: parsed.data.externalPaidLabels, externalLabelReference: parsed.data.externalLabelReference,
      externalLabelReason: parsed.data.externalLabelReason, billableLabels: facts.portalDpdLabels + parsed.data.externalPaidLabels,
      missingDpdLabels: Math.max(0, facts.totalParcels - facts.portalDpdLabels - parsed.data.externalPaidLabels),
      rateSnapshot: copyRateSnapshot(rate), fxSnapshot: parsed.data.fxSnapshot, totals, status: "DRAFT",
      version: 1, revision: 1, notes: parsed.data.notes, lastChangeReason: parsed.data.reason,
      createdBy: actor(request)._id, updatedBy: actor(request)._id
    });
    await rebuildFlightAllocations(sheet);
    await AuditLog.create({ action: "FLIGHT_COST_SHEET_CREATED", entityType: "FLIGHT_COST_SHEET", entityId: sheet._id, performedBy: actor(request)._id, performedAt: now, metadata: { manifestId, rateId, reason: parsed.data.reason } });
    await sheet.populate("vendorId", "name code status");
    return response.status(201).json({ success: true, message: "Flight cost sheet created.", sheet: serializeSheet(sheet) });
  } catch (error) {
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) return reject(response, 409, "This manifest already has a flight cost sheet.");
    throw error;
  }
}



export async function updateFlightCostSheet(request: Request, response: Response) {
  const sheetId = objectId(request.params.sheetId);
  const parsed = updateSheetInput.safeParse(request.body);
  if (!sheetId) return reject(response, 404, "Flight cost sheet not found.");
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter valid flight costs.");
  const sheet = await FlightCostSheet.findById(sheetId).exec();
  if (!sheet || !canAccessBranch(request, sheet.branchId)) return reject(response, 404, "Flight cost sheet not found.");
  if (sheet.status === "CANCELLED") return reject(response, 409, "Cancelled sheets cannot be edited.");
  if (sheet.version !== parsed.data.expectedVersion) return reject(response, 409, "Flight costs changed. Reload and review the latest values.");
  const rateId = objectId(parsed.data.buyingRateId);
  const rate = rateId ? await FlightBuyingRate.findOne({ _id: rateId, ...(String(rateId) === String(sheet.buyingRateId) ? {} : { status: "ACTIVE" }) }).exec() : null;
  if (!rate) return reject(response, 404, "Active buying rate not found.");
  if (String(rate.vendorId) !== String(sheet.vendorId) && sheet.status === "FINALIZED") {
    return reject(response, 409, "A finalized sheet cannot be moved to another vendor. Create an audited replacement instead.");
  }
  await saveFlightCostRevision(sheet, actor(request)._id, sheet.lastChangeReason || "Pre-amend snapshot");
  sheet.buyingRateId = rate._id as mongoose.Types.ObjectId;
  sheet.vendorId = rate.vendorId;
  sheet.region = rate.region;
  sheet.airlineName = parsed.data.airlineName;
  sheet.billedWeightKg = parsed.data.billedWeightKg ?? sheet.manifestWeightKg;
  sheet.billedWeightOverrideReason = parsed.data.billedWeightOverrideReason;
  sheet.externalPaidLabels = parsed.data.externalPaidLabels;
  sheet.externalLabelReference = parsed.data.externalLabelReference;
  sheet.externalLabelReason = parsed.data.externalLabelReason;
  sheet.rateSnapshot = copyRateSnapshot(rate);
  sheet.fxSnapshot = parsed.data.fxSnapshot;
  sheet.notes = parsed.data.notes;
  sheet.lastChangeReason = parsed.data.reason;
  sheet.updatedBy = actor(request)._id;
  sheet.version += 1;
  if (sheet.status === "FINALIZED" || sheet.status === "REVIEW_REQUIRED") sheet.revision += 1;
  if (sheet.status === "REVIEW_REQUIRED") sheet.status = "DRAFT";
  await refreshSheetFactsAndTotals(sheet, { billedWeightKg: sheet.billedWeightKg });
  await rebuildFlightAllocations(sheet);
  await AuditLog.create({ action: "FLIGHT_COST_SHEET_UPDATED", entityType: "FLIGHT_COST_SHEET", entityId: sheet._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { reason: parsed.data.reason, revision: sheet.revision } });
  await sheet.populate("vendorId", "name code status");
  return response.status(200).json({ success: true, message: sheet.status === "FINALIZED" ? "Flight cost amendment saved." : "Flight cost draft saved.", sheet: serializeSheet(sheet) });
}

export async function finalizeFlightCostSheet(request: Request, response: Response) {
  const sheetId = objectId(request.params.sheetId);
  const parsed = z.object({ expectedVersion: z.number().int().min(1), reason: z.string().trim().min(3).max(500) }).safeParse(request.body);
  if (!sheetId) return reject(response, 404, "Flight cost sheet not found.");
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter a finalization reason.");
  const sheet = await FlightCostSheet.findById(sheetId).exec();
  if (!sheet || !canAccessBranch(request, sheet.branchId)) return reject(response, 404, "Flight cost sheet not found.");
  if (sheet.status === "CANCELLED") return reject(response, 409, "Cancelled sheets cannot be finalized.");
  if (sheet.version !== parsed.data.expectedVersion) return reject(response, 409, "Flight costs changed. Reload and review the latest values.");
  const manifest = await OperationsManifest.findById(sheet.operationsManifestId).exec();
  if (!manifest || !["SEALED", "DISPATCHED"].includes(manifest.status)) return reject(response, 409, "Seal or dispatch the manifest before finalizing flight costs.");
  await saveFlightCostRevision(sheet, actor(request)._id, sheet.lastChangeReason || "Pre-finalize snapshot");
  sheet.status = "FINALIZED";
  sheet.version += 1;
  sheet.lastChangeReason = parsed.data.reason;
  sheet.finalizedBy = actor(request)._id;
  sheet.finalizedAt = new Date();
  sheet.updatedBy = actor(request)._id;
  await refreshSheetFactsAndTotals(sheet);
  await rebuildFlightAllocations(sheet);
  await AuditLog.create({ action: "FLIGHT_COST_SHEET_FINALIZED", entityType: "FLIGHT_COST_SHEET", entityId: sheet._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { reason: parsed.data.reason, revision: sheet.revision } });
  await sheet.populate("vendorId", "name code status");
  return response.status(200).json({ success: true, message: "Flight cost sheet finalized.", sheet: serializeSheet(sheet) });
}

export async function updateExternalLabels(request: Request, response: Response) {
  const sheetId = objectId(request.params.sheetId);
  const parsed = z.object({
    expectedVersion: z.number().int().min(1), externalPaidLabels: z.number().int().min(0),
    reference: z.string().trim().min(2).max(120), reason: z.string().trim().min(3).max(500)
  }).safeParse(request.body);
  if (!sheetId) return reject(response, 404, "Flight cost sheet not found.");
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter valid external-label details.");
  const sheet = await FlightCostSheet.findById(sheetId).exec();
  if (!sheet || !canAccessBranch(request, sheet.branchId)) return reject(response, 404, "Flight cost sheet not found.");
  if (sheet.status === "CANCELLED") return reject(response, 409, "Cancelled sheets cannot be updated.");
  if (sheet.version !== parsed.data.expectedVersion) return reject(response, 409, "Label counts changed. Reload and review the latest values.");
  await saveFlightCostRevision(sheet, actor(request)._id, sheet.lastChangeReason || "Pre-label snapshot");
  sheet.externalPaidLabels = parsed.data.externalPaidLabels;
  sheet.externalLabelReference = parsed.data.reference;
  sheet.externalLabelReason = parsed.data.reason;
  sheet.lastChangeReason = parsed.data.reason;
  sheet.updatedBy = actor(request)._id;
  sheet.version += 1;
  if (sheet.status === "FINALIZED" || sheet.status === "REVIEW_REQUIRED") sheet.revision += 1;
  if (sheet.status === "REVIEW_REQUIRED") sheet.status = "DRAFT";
  await refreshSheetFactsAndTotals(sheet);
  await rebuildFlightAllocations(sheet);
  await AuditLog.create({ action: "FLIGHT_COST_LABELS_RECONCILED", entityType: "FLIGHT_COST_SHEET", entityId: sheet._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { externalPaidLabels: parsed.data.externalPaidLabels, reference: parsed.data.reference, reason: parsed.data.reason } });
  await sheet.populate("vendorId", "name code status");
  return response.status(200).json({ success: true, message: "External labels updated.", sheet: serializeSheet(sheet) });
}

export async function cancelFlightCostSheet(request: Request, response: Response) {
  const sheetId = objectId(request.params.sheetId);
  const parsed = z.object({ expectedVersion: z.number().int().min(1), reason: z.string().trim().min(3).max(500) }).safeParse(request.body);
  if (!sheetId) return reject(response, 404, "Flight cost sheet not found.");
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter a cancellation reason.");
  const sheet = await FlightCostSheet.findById(sheetId).exec();
  if (!sheet || !canAccessBranch(request, sheet.branchId)) return reject(response, 404, "Flight cost sheet not found.");
  if (sheet.status === "FINALIZED") return reject(response, 409, "Finalized sheets cannot be cancelled. Amend with a corrective revision instead.");
  if (sheet.status === "CANCELLED") return reject(response, 409, "Sheet is already cancelled.");
  if (sheet.version !== parsed.data.expectedVersion) return reject(response, 409, "Flight costs changed. Reload and review the latest values.");
  await saveFlightCostRevision(sheet, actor(request)._id, sheet.lastChangeReason || "Pre-cancel snapshot");
  sheet.status = "CANCELLED";
  sheet.version += 1;
  sheet.lastChangeReason = parsed.data.reason;
  sheet.updatedBy = actor(request)._id;
  await sheet.save();
  await AuditLog.create({ action: "FLIGHT_COST_SHEET_CANCELLED" as any, entityType: "FLIGHT_COST_SHEET", entityId: sheet._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { reason: parsed.data.reason } });
  await sheet.populate("vendorId", "name code status");
  return response.status(200).json({ success: true, message: "Flight cost sheet cancelled.", sheet: serializeSheet(sheet) });
}

export async function reviewFlightCostSheet(request: Request, response: Response) {
  const sheetId = objectId(request.params.sheetId);
  const parsed = z.object({ expectedVersion: z.number().int().min(1), reason: z.string().trim().min(3).max(500) }).safeParse(request.body);
  if (!sheetId) return reject(response, 404, "Flight cost sheet not found.");
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter a review reason.");
  const sheet = await FlightCostSheet.findById(sheetId).exec();
  if (!sheet || !canAccessBranch(request, sheet.branchId)) return reject(response, 404, "Flight cost sheet not found.");
  if (sheet.version !== parsed.data.expectedVersion) return reject(response, 409, "Flight costs changed. Reload and review the latest values.");
  await saveFlightCostRevision(sheet, actor(request)._id, sheet.lastChangeReason || "Pre-review snapshot");
  sheet.status = "REVIEW_REQUIRED";
  sheet.version += 1;
  sheet.lastChangeReason = parsed.data.reason;
  sheet.updatedBy = actor(request)._id;
  await refreshSheetFactsAndTotals(sheet);
  await rebuildFlightAllocations(sheet);
  await AuditLog.create({ action: "FLIGHT_COST_SHEET_REVIEW_REQUIRED" as any, entityType: "FLIGHT_COST_SHEET", entityId: sheet._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { reason: parsed.data.reason } });
  await sheet.populate("vendorId", "name code status");
  return response.status(200).json({ success: true, message: "Sheet marked for review.", sheet: serializeSheet(sheet) });
}

export async function listFlightCostRevisions(request: Request, response: Response) {
  const sheetId = objectId(request.params.sheetId);
  if (!sheetId) return reject(response, 404, "Flight cost sheet not found.");
  const sheet = await FlightCostSheet.findById(sheetId).exec();
  if (!sheet || !canAccessBranch(request, sheet.branchId)) return reject(response, 404, "Flight cost sheet not found.");
  const revisions = await FlightCostSheetRevision.find({ flightCostSheetId: sheet._id }).sort({ revision: -1, createdAt: -1 }).lean().exec();
  return response.status(200).json({ success: true, revisions: revisions.map((r: any) => ({ ...r, id: String(r._id), flightCostSheetId: String(r.flightCostSheetId) })) });
}

export async function triggerManifestReviewCheck(request: Request, response: Response) {
  const manifestId = objectId(request.params.manifestId);
  if (!manifestId) return reject(response, 404, "Operations manifest not found.");
  const manifest = await OperationsManifest.findById(manifestId).exec();
  if (!manifest || !canAccessBranch(request, manifest.branchId)) return reject(response, 404, "Operations manifest not found.");
  const sheet = await markSheetReviewRequiredIfChanged(manifestId, "Manifest facts changed after packing");
  if (!sheet) return response.status(200).json({ success: true, message: "No flight cost sheet to review.", reviewed: false });
  await AuditLog.create({ action: "FLIGHT_COST_SHEET_REVIEW_REQUIRED" as any, entityType: "FLIGHT_COST_SHEET", entityId: sheet._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { manifestId, auto: true } });
  return response.status(200).json({ success: true, message: "Sheet marked review required.", reviewed: true, sheet: serializeSheet(sheet) });
}

export async function getFlightCostSheet(request: Request, response: Response) {
  const sheetId = objectId(request.params.sheetId);
  if (!sheetId) return reject(response, 404, "Flight cost sheet not found.");
  const sheet = await FlightCostSheet.findById(sheetId).populate("vendorId", "name code status").exec();
  if (!sheet || !canAccessBranch(request, sheet.branchId)) return reject(response, 404, "Flight cost sheet not found.");
  const allocations = await FlightCostAllocation.find({ flightCostSheetId: sheet._id }).sort({ awb: 1 }).lean().exec();
  return response.status(200).json({ success: true, sheet: serializeSheet(sheet), allocations: allocations.map((item) => ({ ...item, id: String(item._id), shipmentDraftId: String(item.shipmentDraftId) })) });
}
