import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { allowedBranchIds, canAccessBranch } from "../middleware/branchAccess.middleware.js";
import { AuditLog } from "../models/auditLog.model.js";
import { FlightBuyingRate, flightRateRegionValues } from "../models/flightBuyingRate.model.js";
import { FlightCostAllocation } from "../models/flightCostAllocation.model.js";
import { FlightCostSheet, flightCostSheetStatusValues, type IFlightCostSheet } from "../models/flightCostSheet.model.js";
import { FlightLinehaul } from "../models/flightLinehaul.model.js";
import { LogisticsVendor } from "../models/logisticsVendor.model.js";
import { OperationsManifest } from "../models/operationsManifest.model.js";
import {
  calculateFlightCostTotals,
  copyRateSnapshot,
  getGbpToInrRate,
  isBilledWeightOverride,
  isFlightBuyingRateApplicable,
  loadFlightOperationalFacts,
  markSheetReviewRequiredIfChanged,
  rebuildFlightAllocations,
  refreshSheetFactsAndTotals,
  restoreLegacyProfitabilityForSheet,
  saveFlightCostRevision
} from "../services/flightProfitability.service.js";
import { FlightCostSheetRevision } from "../models/flightCostSheetRevision.model.js";

type RequestUser = { _id: mongoose.Types.ObjectId; role: string };
function actor(request: Request) { return (request as Request & { user: RequestUser }).user; }
function reject(response: Response, status: number, message: string) { return response.status(status).json({ success: false, message }); }
function objectId(value: unknown) { return mongoose.Types.ObjectId.isValid(String(value ?? "")) ? new mongoose.Types.ObjectId(String(value)) : null; }

class FlightRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function flightError(status: number, message: string): never {
  throw new FlightRequestError(status, message);
}

async function inFlightTransaction<T>(work: (session: mongoose.ClientSession) => Promise<T>) {
  const session = await mongoose.startSession();
  let result: T | undefined;
  try {
    await session.withTransaction(async () => {
      result = undefined;
      result = await work(session);
    });
    if (result === undefined) throw new Error("The flight-cost transaction did not complete.");
    return result;
  } finally {
    await session.endSession();
  }
}

function handleFlightError(response: Response, error: unknown) {
  if (error instanceof FlightRequestError) return reject(response, error.status, error.message);
  if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
    return reject(response, 409, "These flight costs changed while you were saving. Reload and try again.");
  }
  throw error;
}

async function createAuditLog(data: Parameters<typeof AuditLog.create>[0], session: mongoose.ClientSession) {
  await AuditLog.create([data], { session });
}

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

function rateAuditValues(rate: any) {
  return {
    vendorId: String(rate.vendorId?._id ?? rate.vendorId),
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
    status: rate.status
  };
}

function sheetAuditValues(sheet: IFlightCostSheet) {
  return {
    buyingRateId: String(sheet.buyingRateId),
    vendorId: String(sheet.vendorId),
    airlineName: sheet.airlineName,
    manifestWeightKg: sheet.manifestWeightKg,
    billedWeightKg: sheet.billedWeightKg,
    billedWeightOverrideReason: sheet.billedWeightOverrideReason,
    externalPaidLabels: sheet.externalPaidLabels,
    externalLabelReference: sheet.externalLabelReference,
    fxSnapshot: {
      gbpToInr: sheet.fxSnapshot.gbpToInr,
      provider: sheet.fxSnapshot.provider,
      providerUpdatedAt: sheet.fxSnapshot.providerUpdatedAt ?? null,
      fetchedAt: sheet.fxSnapshot.fetchedAt,
      isManual: sheet.fxSnapshot.isManual
    },
    notes: sheet.notes,
    status: sheet.status,
    revision: sheet.revision,
    version: sheet.version,
    totals: JSON.parse(JSON.stringify(sheet.totals))
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
  effectiveTo: z.coerce.date().nullable().optional()
}).refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, {
  message: "The end date must not be before the start date."
});

async function overlappingRate(data: z.infer<typeof rateInput>, excludeId?: mongoose.Types.ObjectId, session?: mongoose.ClientSession) {
  const vendorId = objectId(data.vendorId);
  if (!vendorId) return false;
  return FlightBuyingRate.exists({
    _id: excludeId ? { $ne: excludeId } : { $exists: true },
    vendorId,
    region: data.region,
    status: "ACTIVE",
    effectiveFrom: { $lte: data.effectiveTo ?? new Date("9999-12-31") },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: data.effectiveFrom } }]
  }).session(session ?? null);
}

export async function listFlightBuyingRates(_request: Request, response: Response) {
  const rates = await FlightBuyingRate.find().populate("vendorId", "name code status").sort({ status: 1, region: 1, effectiveFrom: -1 }).exec();
  return response.status(200).json({ success: true, rates: rates.map(serializeRate) });
}

export async function createFlightBuyingRate(request: Request, response: Response) {
  const parsed = rateInput.safeParse(request.body);
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter a valid buying rate.");
  const vendorId = objectId(parsed.data.vendorId);
  if (!vendorId) return reject(response, 400, "Select an active vendor.");
  try {
    const rateId = await inFlightTransaction(async (session) => {
      if (!await LogisticsVendor.exists({ _id: vendorId, status: "ACTIVE" }).session(session)) flightError(400, "Select an active vendor.");
      if (await overlappingRate(parsed.data, undefined, session)) flightError(409, "An active rate already covers this vendor, region and date.");
      const values = parsed.data;
      const [rate] = await FlightBuyingRate.create([{ ...values, vendorId, effectiveTo: values.effectiveTo ?? null, createdBy: actor(request)._id }], { session });
      if (!rate) throw new Error("The buying rate could not be created.");
      await createAuditLog({ action: "FLIGHT_BUYING_RATE_CREATED", entityType: "FLIGHT_BUYING_RATE", entityId: rate._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { values: rateAuditValues(rate) } }, session);
      return rate._id as mongoose.Types.ObjectId;
    });
    const rate = await FlightBuyingRate.findById(rateId).populate("vendorId", "name code status").exec();
    if (!rate) return reject(response, 500, "The buying rate was saved but could not be reloaded.");
    return response.status(201).json({ success: true, message: "Buying rate created.", rate: serializeRate(rate) });
  } catch (error) {
    return handleFlightError(response, error);
  }
}

export async function updateFlightBuyingRate(request: Request, response: Response) {
  const rateId = objectId(request.params.rateId);
  const parsed = rateInput.safeParse(request.body);
  if (!rateId) return reject(response, 404, "Buying rate not found.");
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter a valid buying rate.");
  const vendorId = objectId(parsed.data.vendorId);
  if (!vendorId) return reject(response, 400, "Select an active vendor.");
  try {
    await inFlightTransaction(async (session) => {
      if (!await LogisticsVendor.exists({ _id: vendorId, status: "ACTIVE" }).session(session)) flightError(400, "Select an active vendor.");
      if (await overlappingRate(parsed.data, rateId, session)) flightError(409, "An active rate already covers this vendor, region and date.");
      const values = parsed.data;
      const rate = await FlightBuyingRate.findOne({ _id: rateId, status: "ACTIVE" }).session(session).exec();
      if (!rate) flightError(404, "Active buying rate not found.");
      const before = rateAuditValues(rate);
      rate.set({ ...values, vendorId, effectiveTo: values.effectiveTo ?? null, updatedBy: actor(request)._id });
      await rate.save({ session });
      await createAuditLog({ action: "FLIGHT_BUYING_RATE_UPDATED", entityType: "FLIGHT_BUYING_RATE", entityId: rate._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { before, after: rateAuditValues(rate) } }, session);
      return true;
    });
    const rate = await FlightBuyingRate.findById(rateId).populate("vendorId", "name code status").exec();
    if (!rate) return reject(response, 404, "Active buying rate not found.");
    return response.status(200).json({ success: true, message: "Buying rate updated.", rate: serializeRate(rate) });
  } catch (error) {
    return handleFlightError(response, error);
  }
}

export async function deleteFlightBuyingRate(request: Request, response: Response) {
  const rateId = objectId(request.params.rateId);
  const parsed = z.object({ reason: z.string().trim().min(3).max(500) }).safeParse(request.body);
  if (!rateId) return reject(response, 404, "Buying rate not found.");
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter a deletion reason.");
  try {
    await inFlightTransaction(async (session) => {
      const rate = await FlightBuyingRate.findOneAndUpdate(
        { _id: rateId, status: "ACTIVE" },
        { $set: { status: "DELETED", deletedBy: actor(request)._id, deletedAt: new Date(), deletionReason: parsed.data.reason, updatedBy: actor(request)._id } },
        { returnDocument: "after", runValidators: true, session }
      ).exec();
      if (!rate) flightError(404, "Active buying rate not found.");
      await createAuditLog({ action: "FLIGHT_BUYING_RATE_DELETED", entityType: "FLIGHT_BUYING_RATE", entityId: rate._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { reason: parsed.data.reason } }, session);
      return true;
    });
    const rate = await FlightBuyingRate.findById(rateId).populate("vendorId", "name code status").exec();
    if (!rate) return reject(response, 404, "Buying rate not found.");
    return response.status(200).json({ success: true, message: "Buying rate deleted.", rate: serializeRate(rate) });
  } catch (error) {
    return handleFlightError(response, error);
  }
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
    // A cost sheet is the financial record for one air movement. Standalone
    // manifests have no flight owner, so offering them here would create a
    // sheet that cannot be reconciled to a flight later.
    const filter: Record<string, unknown> = {
      ...branchFilter(request),
      status: { $ne: "CANCELLED" },
      flightLinehaulId: { $type: "objectId" }
    };
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
  if (!manifest.flightLinehaulId) return reject(response, 409, "Attach this manifest to a flight before creating a cost sheet.");
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

/**
 * Operations needs a narrow view so it can clean up provisional sheets without
 * receiving the finance workspace's rates, vendor controls, or finalized
 * profitability history.
 */
export async function listFlightCostDrafts(request: Request, response: Response) {
  try {
    const filter: Record<string, unknown> = branchFilter(request);
    filter.status = "DRAFT";
    const sheets = await FlightCostSheet.find(filter)
      .sort({ flightDate: -1, updatedAt: -1 })
      .limit(250)
      .lean()
      .exec();
    return response.status(200).json({
      success: true,
      sheets: sheets.map((sheet: any) => ({
        id: String(sheet._id),
        manifestNumber: sheet.manifestNumber,
        mawbNumber: sheet.mawbNumber,
        airlineName: sheet.airlineName,
        flightNumber: sheet.flightNumber,
        flightDate: sheet.flightDate,
        destinationCountryName: sheet.destinationCountryName,
        billedWeightKg: sheet.billedWeightKg,
        totalParcels: sheet.totalParcels,
        totals: { totalCostMinor: sheet.totals?.totalCostMinor ?? 0 },
        status: sheet.status,
        updatedAt: sheet.updatedAt
      }))
    });
  } catch (error) {
    return reject(response, error instanceof Error && error.message === "Branch not found" ? 404 : 400, error instanceof Error ? error.message : "Flight cost drafts could not be loaded.");
  }
}

const fxInput = z.object({
  gbpToInr: z.number().positive(),
  provider: z.string().trim().min(2).max(80),
  providerUpdatedAt: z.coerce.date().nullable().optional(),
  fetchedAt: z.coerce.date(),
  isManual: z.boolean().default(false),
  manualReason: z.string().trim().max(500).default("")
});

const createSheetBase = z.object({
  operationsManifestId: z.string().trim(),
  buyingRateId: z.string().trim(),
  airlineName: z.string().trim().min(2).max(120),
  billedWeightKg: z.number().positive().optional(),
  billedWeightOverrideReason: z.string().trim().max(500).default(""),
  externalPaidLabels: z.number().int().min(0).default(0),
  externalLabelReference: z.string().trim().max(120).default(""),
  fxSnapshot: fxInput,
  notes: z.string().trim().max(1000).default("")
});

const createSheetInput = createSheetBase
  .refine((value) => !value.externalPaidLabels || value.externalLabelReference.length >= 2, { message: "Enter the external-label reference." });

const updateSheetBase = z.object({
  buyingRateId: z.string().trim(),
  airlineName: z.string().trim().min(2).max(120),
  billedWeightKg: z.number().positive().optional(),
  billedWeightOverrideReason: z.string().trim().max(500).default(""),
  externalPaidLabels: z.number().int().min(0).default(0),
  externalLabelReference: z.string().trim().max(120).default(""),
  fxSnapshot: fxInput,
  notes: z.string().trim().max(1000).default(""),
  expectedVersion: z.number().int().min(1)
});

const updateSheetInput = updateSheetBase
  .refine((value) => !value.externalPaidLabels || value.externalLabelReference.length >= 2, { message: "Enter the external-label reference." });

function ensureManifestHeader(manifest: InstanceType<typeof OperationsManifest>) {
  if (!manifest.header.mawbNumber || !manifest.header.flightNumber || !manifest.header.departureDate || !manifest.header.destinationCountryCode) {
    throw new Error("Complete the manifest MAWB, flight, date and destination before creating flight costs.");
  }
}

function ensureRateMatchesManifest(rate: InstanceType<typeof FlightBuyingRate>, manifest: InstanceType<typeof OperationsManifest>) {
  if (!isFlightBuyingRateApplicable(rate, manifest.header.destinationCountryCode, manifest.header.departureDate)) {
    flightError(409, "Select an active buying rate that matches the manifest destination and flight date.");
  }
}

export async function createFlightCostSheet(request: Request, response: Response) {
  const parsed = createSheetInput.safeParse(request.body);
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter valid flight costs.");
  const manifestId = objectId(parsed.data.operationsManifestId);
  const rateId = objectId(parsed.data.buyingRateId);
  if (!manifestId || !rateId) return reject(response, 404, "Manifest or buying rate not found.");
  try {
    const sheetId = await inFlightTransaction(async (session) => {
      const manifest = await OperationsManifest.findById(manifestId).session(session).exec();
      if (!manifest || !canAccessBranch(request, manifest.branchId)) flightError(404, "Operations manifest not found.");
      try { ensureManifestHeader(manifest); } catch (error) { flightError(409, (error as Error).message); }
      if (!manifest.flightLinehaulId) {
        flightError(409, "Attach this manifest to a flight before creating a cost sheet. One cost sheet belongs to one flight.");
      }
      const flight = await FlightLinehaul.findById(manifest.flightLinehaulId).session(session).exec();
      if (!flight || String(flight.branchId) !== String(manifest.branchId)) {
        flightError(409, "This manifest is attached to an unavailable flight. Reattach it to a valid flight before creating costs.");
      }
      const comparable = (value: string) => value.trim().replace(/-/g, "").toUpperCase();
      if (
        comparable(manifest.header.flightNumber) !== comparable(flight.flightNumber)
        || comparable(manifest.header.mawbNumber) !== comparable(flight.mawbNumber)
        || comparable(manifest.header.originIataCode) !== comparable(flight.originIataCode)
        || comparable(manifest.header.destinationIataCode) !== comparable(flight.destinationIataCode)
      ) {
        flightError(409, "Manifest flight number, MAWB, origin and destination must match the attached flight before costs can be created.");
      }
      const manifestsForFlight = await OperationsManifest.find({ flightLinehaulId: manifest.flightLinehaulId })
        .select("_id")
        .session(session)
        .lean()
        .exec();
      if (await FlightCostSheet.exists({ operationsManifestId: { $in: manifestsForFlight.map((item) => item._id) } }).session(session)) {
        flightError(409, "This flight already has a cost sheet. One cost sheet is allowed per flight.");
      }
      const rate = await FlightBuyingRate.findOne({ _id: rateId, status: "ACTIVE" }).session(session).exec();
      if (!rate) flightError(404, "Active buying rate not found.");
      ensureRateMatchesManifest(rate, manifest);
      const { facts } = await loadFlightOperationalFacts(manifestId, parsed.data.externalPaidLabels, session);
      const billedWeightKg = parsed.data.billedWeightKg ?? facts.manifestWeightKg;
      const weightOverridden = isBilledWeightOverride(billedWeightKg, facts.manifestWeightKg);
      if (weightOverridden && parsed.data.billedWeightOverrideReason.length < 3) {
        flightError(400, "Enter a reason when billed weight differs from manifest weight.");
      }
      const totals = calculateFlightCostTotals({ rate: copyRateSnapshot(rate), facts: { ...facts, billedWeightKg }, gbpToInr: parsed.data.fxSnapshot.gbpToInr });
      const [sheet] = await FlightCostSheet.create([{
        operationsManifestId: manifestId, flightLinehaulId: manifest.flightLinehaulId, branchId: manifest.branchId, buyingRateId: rate._id, vendorId: rate.vendorId,
        manifestNumber: manifest.manifestNumber, region: rate.region, airlineName: parsed.data.airlineName,
        mawbNumber: manifest.header.mawbNumber, flightNumber: manifest.header.flightNumber, flightDate: manifest.header.departureDate,
        destinationCountryCode: manifest.header.destinationCountryCode, destinationCountryName: manifest.header.destinationCountryName,
        manifestWeightKg: facts.manifestWeightKg, billedWeightKg,
        billedWeightOverrideReason: weightOverridden ? parsed.data.billedWeightOverrideReason : "",
        totalBags: facts.totalBags, totalParcels: facts.totalParcels, portalDpdLabels: facts.portalDpdLabels,
        externalPaidLabels: parsed.data.externalPaidLabels, externalLabelReference: parsed.data.externalLabelReference,
        externalLabelReason: "", billableLabels: facts.portalDpdLabels + parsed.data.externalPaidLabels,
        missingDpdLabels: Math.max(0, facts.totalParcels - facts.portalDpdLabels - parsed.data.externalPaidLabels),
        rateSnapshot: copyRateSnapshot(rate), fxSnapshot: { ...parsed.data.fxSnapshot, manualReason: "" }, totals, status: "DRAFT",
        version: 1, revision: 1, notes: parsed.data.notes, lastChangeReason: "Flight cost sheet created",
        createdBy: actor(request)._id, updatedBy: actor(request)._id
      }], { session });
      if (!sheet) throw new Error("The flight cost sheet could not be created.");
      await rebuildFlightAllocations(sheet, session);
      await createAuditLog({ action: "FLIGHT_COST_SHEET_CREATED", entityType: "FLIGHT_COST_SHEET", entityId: sheet._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { manifestId, rateId, values: sheetAuditValues(sheet) } }, session);
      return sheet._id as mongoose.Types.ObjectId;
    });
    const sheet = await FlightCostSheet.findById(sheetId).populate("vendorId", "name code status").exec();
    if (!sheet) return reject(response, 500, "The flight cost sheet was saved but could not be reloaded.");
    return response.status(201).json({ success: true, message: "Flight cost sheet created.", sheet: serializeSheet(sheet) });
  } catch (error) {
    return handleFlightError(response, error);
  }
}



export async function updateFlightCostSheet(request: Request, response: Response) {
  const sheetId = objectId(request.params.sheetId);
  const parsed = updateSheetInput.safeParse(request.body);
  if (!sheetId) return reject(response, 404, "Flight cost sheet not found.");
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter valid flight costs.");
  const rateId = objectId(parsed.data.buyingRateId);
  if (!rateId) return reject(response, 404, "Buying rate not found.");
  try {
    const saved = await inFlightTransaction(async (session) => {
      const sheet = await FlightCostSheet.findById(sheetId).session(session).exec();
      if (!sheet || !canAccessBranch(request, sheet.branchId)) flightError(404, "Flight cost sheet not found.");
      if (sheet.status === "CANCELLED") flightError(409, "Cancelled sheets cannot be edited.");
      if (sheet.version !== parsed.data.expectedVersion) flightError(409, "Flight costs changed. Reload and review the latest values.");
      const manifest = await OperationsManifest.findById(sheet.operationsManifestId).session(session).exec();
      if (!manifest) flightError(404, "Operations manifest not found.");
      const { facts } = await loadFlightOperationalFacts(sheet.operationsManifestId, parsed.data.externalPaidLabels, session);
      const billedWeightKg = parsed.data.billedWeightKg ?? facts.manifestWeightKg;
      const weightOverridden = isBilledWeightOverride(billedWeightKg, facts.manifestWeightKg);
      if (weightOverridden && parsed.data.billedWeightOverrideReason.length < 3) {
        flightError(400, "Enter a reason when billed weight differs from manifest weight.");
      }
      const before = sheetAuditValues(sheet);
      const changingRate = String(rateId) !== String(sheet.buyingRateId);
      if (changingRate) {
        const rate = await FlightBuyingRate.findOne({ _id: rateId, status: "ACTIVE" }).session(session).exec();
        if (!rate) flightError(404, "Active buying rate not found.");
        ensureRateMatchesManifest(rate, manifest);
        if (String(rate.vendorId) !== String(sheet.vendorId) && sheet.status === "FINALIZED") {
          flightError(409, "A finalized sheet cannot be moved to another vendor. Create an audited replacement instead.");
        }
        sheet.buyingRateId = rate._id as mongoose.Types.ObjectId;
        sheet.vendorId = rate.vendorId;
        sheet.region = rate.region;
        sheet.rateSnapshot = copyRateSnapshot(rate);
      }
      const snapshotRevision = await saveFlightCostRevision(sheet, actor(request)._id, "Snapshot before flight cost save", session);
      sheet.revision = snapshotRevision + 1;
      sheet.airlineName = parsed.data.airlineName;
      sheet.billedWeightKg = billedWeightKg;
      sheet.billedWeightOverrideReason = weightOverridden ? parsed.data.billedWeightOverrideReason : "";
      sheet.externalPaidLabels = parsed.data.externalPaidLabels;
      sheet.externalLabelReference = parsed.data.externalLabelReference;
      sheet.externalLabelReason = "";
      sheet.fxSnapshot = { ...parsed.data.fxSnapshot, manualReason: "" };
      sheet.notes = parsed.data.notes;
      sheet.lastChangeReason = sheet.status === "FINALIZED" ? "Flight cost amendment saved" : "Flight cost draft saved";
      sheet.updatedBy = actor(request)._id;
      sheet.version += 1;
      if (sheet.status === "REVIEW_REQUIRED") sheet.status = "DRAFT";
      await refreshSheetFactsAndTotals(sheet, { session, billedWeightKg: sheet.billedWeightKg });
      await rebuildFlightAllocations(sheet, session);
      await createAuditLog({ action: "FLIGHT_COST_SHEET_UPDATED", entityType: "FLIGHT_COST_SHEET", entityId: sheet._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { before, after: sheetAuditValues(sheet), revision: sheet.revision, rateChanged: changingRate } }, session);
      return { id: sheet._id as mongoose.Types.ObjectId, finalized: sheet.status === "FINALIZED" };
    });
    const sheet = await FlightCostSheet.findById(saved.id).populate("vendorId", "name code status").exec();
    if (!sheet) return reject(response, 500, "The flight cost sheet was saved but could not be reloaded.");
    return response.status(200).json({ success: true, message: saved.finalized ? "Flight cost amendment saved." : "Flight cost draft saved.", sheet: serializeSheet(sheet) });
  } catch (error) {
    return handleFlightError(response, error);
  }
}

export async function finalizeFlightCostSheet(request: Request, response: Response) {
  const sheetId = objectId(request.params.sheetId);
  const parsed = z.object({ expectedVersion: z.number().int().min(1) }).safeParse(request.body);
  if (!sheetId) return reject(response, 404, "Flight cost sheet not found.");
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "The flight cost version is invalid.");
  try {
    const savedId = await inFlightTransaction(async (session) => {
      const sheet = await FlightCostSheet.findById(sheetId).session(session).exec();
      if (!sheet || !canAccessBranch(request, sheet.branchId)) flightError(404, "Flight cost sheet not found.");
      if (sheet.status === "CANCELLED") flightError(409, "Cancelled sheets cannot be finalized.");
      if (sheet.status === "FINALIZED") flightError(409, "This flight cost sheet is already finalized.");
      if (sheet.status === "REVIEW_REQUIRED") flightError(409, "Review and save the changed manifest facts before finalizing.");
      if (sheet.version !== parsed.data.expectedVersion) flightError(409, "Flight costs changed. Reload and review the latest values.");
      const manifest = await OperationsManifest.findById(sheet.operationsManifestId).session(session).exec();
      if (!manifest || !["SEALED", "DISPATCHED"].includes(manifest.status)) flightError(409, "Seal or dispatch the manifest before finalizing flight costs.");
      const before = sheetAuditValues(sheet);
      const snapshotRevision = await saveFlightCostRevision(sheet, actor(request)._id, "Snapshot before finalization", session);
      sheet.revision = snapshotRevision + 1;
      sheet.status = "FINALIZED";
      sheet.version += 1;
      sheet.lastChangeReason = "Flight cost sheet finalized";
      sheet.finalizedBy = actor(request)._id;
      sheet.finalizedAt = new Date();
      sheet.updatedBy = actor(request)._id;
      await refreshSheetFactsAndTotals(sheet, { session });
      await rebuildFlightAllocations(sheet, session);
      await createAuditLog({ action: "FLIGHT_COST_SHEET_FINALIZED", entityType: "FLIGHT_COST_SHEET", entityId: sheet._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { before, after: sheetAuditValues(sheet), revision: sheet.revision } }, session);
      return sheet._id as mongoose.Types.ObjectId;
    });
    const sheet = await FlightCostSheet.findById(savedId).populate("vendorId", "name code status").exec();
    if (!sheet) return reject(response, 500, "The finalized flight cost sheet could not be reloaded.");
    return response.status(200).json({ success: true, message: "Flight cost sheet finalized.", sheet: serializeSheet(sheet) });
  } catch (error) {
    return handleFlightError(response, error);
  }
}

export async function updateExternalLabels(request: Request, response: Response) {
  const sheetId = objectId(request.params.sheetId);
  const parsed = z.object({
    expectedVersion: z.number().int().min(1), externalPaidLabels: z.number().int().min(0),
    reference: z.string().trim().min(2).max(120)
  }).safeParse(request.body);
  if (!sheetId) return reject(response, 404, "Flight cost sheet not found.");
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter valid external-label details.");
  try {
    const savedId = await inFlightTransaction(async (session) => {
      const sheet = await FlightCostSheet.findById(sheetId).session(session).exec();
      if (!sheet || !canAccessBranch(request, sheet.branchId)) flightError(404, "Flight cost sheet not found.");
      if (sheet.status === "CANCELLED") flightError(409, "Cancelled sheets cannot be updated.");
      if (sheet.version !== parsed.data.expectedVersion) flightError(409, "Label counts changed. Reload and review the latest values.");
      const before = sheetAuditValues(sheet);
      const snapshotRevision = await saveFlightCostRevision(sheet, actor(request)._id, "Snapshot before external label update", session);
      sheet.revision = snapshotRevision + 1;
      sheet.externalPaidLabels = parsed.data.externalPaidLabels;
      sheet.externalLabelReference = parsed.data.reference;
      sheet.externalLabelReason = "";
      sheet.lastChangeReason = "External paid labels updated";
      sheet.updatedBy = actor(request)._id;
      sheet.version += 1;
      if (sheet.status === "REVIEW_REQUIRED") sheet.status = "DRAFT";
      await refreshSheetFactsAndTotals(sheet, { session });
      await rebuildFlightAllocations(sheet, session);
      await createAuditLog({ action: "FLIGHT_COST_LABELS_RECONCILED", entityType: "FLIGHT_COST_SHEET", entityId: sheet._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { before, after: sheetAuditValues(sheet), revision: sheet.revision } }, session);
      return sheet._id as mongoose.Types.ObjectId;
    });
    const sheet = await FlightCostSheet.findById(savedId).populate("vendorId", "name code status").exec();
    if (!sheet) return reject(response, 500, "The flight cost sheet was saved but could not be reloaded.");
    return response.status(200).json({ success: true, message: "External labels updated.", sheet: serializeSheet(sheet) });
  } catch (error) {
    return handleFlightError(response, error);
  }
}

export async function cancelFlightCostSheet(request: Request, response: Response) {
  const sheetId = objectId(request.params.sheetId);
  const parsed = z.object({ expectedVersion: z.number().int().min(1), reason: z.string().trim().min(3).max(500) }).safeParse(request.body);
  if (!sheetId) return reject(response, 404, "Flight cost sheet not found.");
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter a cancellation reason.");
  try {
    const savedId = await inFlightTransaction(async (session) => {
      const sheet = await FlightCostSheet.findById(sheetId).session(session).exec();
      if (!sheet || !canAccessBranch(request, sheet.branchId)) flightError(404, "Flight cost sheet not found.");
      if (sheet.status === "FINALIZED") flightError(409, "Finalized sheets cannot be cancelled. Amend with a corrective revision instead.");
      if (sheet.status === "CANCELLED") flightError(409, "Sheet is already cancelled.");
      if (sheet.version !== parsed.data.expectedVersion) flightError(409, "Flight costs changed. Reload and review the latest values.");
      const snapshotRevision = await saveFlightCostRevision(sheet, actor(request)._id, sheet.lastChangeReason || "Pre-cancel snapshot", session);
      sheet.revision = snapshotRevision + 1;
      sheet.status = "CANCELLED";
      sheet.version += 1;
      sheet.lastChangeReason = parsed.data.reason;
      sheet.updatedBy = actor(request)._id;
      await sheet.save({ session });
      await restoreLegacyProfitabilityForSheet(sheet, session);
      await createAuditLog({ action: "FLIGHT_COST_SHEET_CANCELLED", entityType: "FLIGHT_COST_SHEET", entityId: sheet._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { reason: parsed.data.reason, revision: sheet.revision } }, session);
      return sheet._id as mongoose.Types.ObjectId;
    });
    const sheet = await FlightCostSheet.findById(savedId).populate("vendorId", "name code status").exec();
    if (!sheet) return reject(response, 500, "The cancelled flight cost sheet could not be reloaded.");
    return response.status(200).json({ success: true, message: "Flight cost sheet cancelled and shipment margins restored.", sheet: serializeSheet(sheet) });
  } catch (error) {
    return handleFlightError(response, error);
  }
}

export async function deleteDraftFlightCostSheet(request: Request, response: Response) {
  const sheetId = objectId(request.params.sheetId);
  if (!sheetId) return reject(response, 404, "Flight cost sheet not found.");

  try {
    await inFlightTransaction(async (session) => {
      const sheet = await FlightCostSheet.findById(sheetId).session(session).exec();
      if (!sheet || !canAccessBranch(request, sheet.branchId)) flightError(404, "Flight cost sheet not found.");
      if (sheet.status !== "DRAFT") {
        flightError(409, "Only draft flight cost sheets can be deleted. Finalized, review-required, and cancelled sheets must be retained for audit.");
      }

      const before = sheetAuditValues(sheet);
      await restoreLegacyProfitabilityForSheet(sheet, session);
      await FlightCostSheetRevision.deleteMany({ flightCostSheetId: sheet._id }).session(session).exec();
      const deleted = await FlightCostSheet.deleteOne({ _id: sheet._id }).session(session).exec();
      if (deleted.deletedCount !== 1) flightError(404, "Flight cost sheet not found.");

      await createAuditLog({
        action: "FLIGHT_COST_SHEET_DRAFT_DELETED",
        entityType: "FLIGHT_COST_SHEET",
        entityId: sheet._id,
        performedBy: actor(request)._id,
        performedAt: new Date(),
        metadata: {
          manifestId: String(sheet.operationsManifestId),
          flightLinehaulId: sheet.flightLinehaulId ? String(sheet.flightLinehaulId) : null,
          before
        }
      }, session);
    });

    return response.status(200).json({
      success: true,
      message: "Draft flight cost sheet deleted. Provisional shipment allocations were removed and legacy profitability was restored."
    });
  } catch (error) {
    return handleFlightError(response, error);
  }
}

export async function reviewFlightCostSheet(request: Request, response: Response) {
  const sheetId = objectId(request.params.sheetId);
  const parsed = z.object({ expectedVersion: z.number().int().min(1), reason: z.string().trim().min(3).max(500) }).safeParse(request.body);
  if (!sheetId) return reject(response, 404, "Flight cost sheet not found.");
  if (!parsed.success) return reject(response, 400, parsed.error.issues[0]?.message ?? "Enter a review reason.");
  try {
    const savedId = await inFlightTransaction(async (session) => {
      const sheet = await FlightCostSheet.findById(sheetId).session(session).exec();
      if (!sheet || !canAccessBranch(request, sheet.branchId)) flightError(404, "Flight cost sheet not found.");
      if (sheet.status === "CANCELLED") flightError(409, "Cancelled sheets cannot be reviewed.");
      if (sheet.version !== parsed.data.expectedVersion) flightError(409, "Flight costs changed. Reload and review the latest values.");
      const snapshotRevision = await saveFlightCostRevision(sheet, actor(request)._id, sheet.lastChangeReason || "Pre-review snapshot", session);
      sheet.revision = snapshotRevision + 1;
      sheet.status = "REVIEW_REQUIRED";
      sheet.version += 1;
      sheet.lastChangeReason = parsed.data.reason;
      sheet.updatedBy = actor(request)._id;
      await refreshSheetFactsAndTotals(sheet, { session });
      await rebuildFlightAllocations(sheet, session);
      await createAuditLog({ action: "FLIGHT_COST_SHEET_REVIEW_REQUIRED", entityType: "FLIGHT_COST_SHEET", entityId: sheet._id, performedBy: actor(request)._id, performedAt: new Date(), metadata: { reason: parsed.data.reason, revision: sheet.revision } }, session);
      return sheet._id as mongoose.Types.ObjectId;
    });
    const sheet = await FlightCostSheet.findById(savedId).populate("vendorId", "name code status").exec();
    if (!sheet) return reject(response, 500, "The flight cost sheet was saved but could not be reloaded.");
    return response.status(200).json({ success: true, message: "Sheet marked for review.", sheet: serializeSheet(sheet) });
  } catch (error) {
    return handleFlightError(response, error);
  }
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
  if (!sheet) return response.status(200).json({ success: true, message: "No review was required.", reviewed: false });
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
