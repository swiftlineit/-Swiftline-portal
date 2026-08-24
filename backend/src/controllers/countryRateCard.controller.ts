import path from "node:path";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import {
  CountryRateCard,
  countryRateServiceValues,
  rateCardBandValues
} from "../models/countryRateCard.model.js";
import {
  parseRateCardWorkbook,
  rateCardImportLimits,
  RateCardImportError
} from "../services/rateCardImport.service.js";
import { CountryRouteCharge } from "../models/countryRouteCharge.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { businessAccountBranchFilter } from "../middleware/businessAccountBranchAccess.middleware.js";
import { excludeSentinel } from "../services/individualCustomer.service.js";
import { AuditLog } from "../models/auditLog.model.js";
import {
  acquireRateCardRouteLock,
  RateCardRouteBusyError
} from "../services/rateCardMutationLock.service.js";

const countryRatePayloadSchema = z.object({
  band: z.enum(rateCardBandValues),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Country code must be a two-letter ISO code"),
  countryName: z.string().trim().min(2).max(80),
  service: z.enum(countryRateServiceValues),
  fromKg: z.coerce.number().nonnegative(),
  toKg: z.coerce.number().positive(),
  chargesPerKg: z.coerce.number().nonnegative(),
  maxBoxKg: z.coerce.number().positive()
}).refine((data) => data.toKg >= data.fromKg, {
  message: "To KG must be greater than or equal to From KG",
  path: ["toKg"]
});

// Surcharges, insurance and discount for a route (country + service). Stored once
// per route rather than per weight slab- see countryRouteCharge.model.ts.
const routeChargePayloadSchema = z.object({
  band: z.enum(rateCardBandValues),
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Country code must be a two-letter ISO code"),
  service: z.enum(countryRateServiceValues),
  fuelSurchargePercent: z.coerce.number().min(0).max(100),
  remoteAreaCharge: z.coerce.number().nonnegative(),
  // Accepted as a comma or newline separated list so an operator can paste a
  // block of postcodes straight in. Blanks and duplicates are dropped.
  remoteAreaPostcodes: z.union([z.string(), z.array(z.string())])
    .transform((value) => {
      const entries = Array.isArray(value) ? value : value.split(/[\n,]/);
      return [...new Set(
        entries
          .map((entry) => entry.trim().toUpperCase())
          .filter(Boolean)
      )];
    })
    .pipe(z.array(z.string().max(20, "Each postcode prefix must be 20 characters or fewer")).max(500)),
  handlingCharge: z.coerce.number().nonnegative(),
  insurancePercent: z.coerce.number().min(0).max(100),
  insuranceMinimum: z.coerce.number().nonnegative(),
  discountPercent: z.coerce.number().min(0).max(100)
}).refine((data) => data.remoteAreaCharge === 0 || data.remoteAreaPostcodes.length > 0, {
  // A remote area charge with nothing to match against can never apply, and
  // reads on the rate card screen as though it does.
  message: "Add at least one remote area postcode prefix, or set the remote area charge to zero.",
  path: ["remoteAreaPostcodes"]
});

function getAuthenticatedUserId(request: Request): mongoose.Types.ObjectId | null {
  const user = (request as Request & { user?: { _id?: unknown } }).user;
  const id = user?._id;

  return id && mongoose.Types.ObjectId.isValid(String(id))
    ? new mongoose.Types.ObjectId(String(id))
    : null;
}

function getRateId(request: Request) {
  const rateId = typeof request.params.id === "string" ? request.params.id : "";
  return mongoose.Types.ObjectId.isValid(rateId) ? rateId : "";
}

function getValidationErrors(error: z.ZodError) {
  return error.issues.map((issue) => issue.message);
}

async function findOverlappingRate(input: z.infer<typeof countryRatePayloadSchema>, excludeRateId?: string) {
  return CountryRateCard.findOne({
    band: input.band,
    countryCode: input.countryCode,
    service: input.service,
    ...(excludeRateId ? { _id: { $ne: excludeRateId } } : {}),
    fromKg: { $lte: input.toKg },
    toKg: { $gte: input.fromKg }
  }).lean().exec();
}

function getOverlapMessage(input: z.infer<typeof countryRatePayloadSchema>) {
  return `This ${input.countryName} ${input.service.toLowerCase()} slab overlaps an existing weight slab. Use non-overlapping ranges like 5.01-10, 10.01-20, 20.01-25.`;
}

export async function listCountryRateCards(request: Request, response: Response): Promise<Response> {
  const countryCode = typeof request.query.countryCode === "string" ? request.query.countryCode.toUpperCase() : "";
  const service = typeof request.query.service === "string" ? request.query.service.toUpperCase() : "";
  const band = typeof request.query.band === "string" ? request.query.band.toUpperCase() : "";
  const filters: Record<string, unknown> = {};

  if (countryCode) filters.countryCode = countryCode;
  if (service) filters.service = service;
  if (band && !rateCardBandValues.includes(band as (typeof rateCardBandValues)[number])) {
    return response.status(400).json({ success: false, message: "Select a valid rate-card band." });
  }
  if (band) filters.band = band;

  const rates = await CountryRateCard.find(filters)
    .sort({ countryName: 1, service: 1, fromKg: 1 })
    .lean()
    .exec();

  return response.status(200).json({ success: true, rates });
}

/** Assignment picker for admin and branch-scoped finance/operations users. */
export async function listRateCardAssignmentAccounts(request: Request, response: Response): Promise<Response> {
  const scope = await businessAccountBranchFilter(request);
  const filter = excludeSentinel(scope ?? {});
  const accounts = await BusinessAccount.find(filter)
    .select("accountId company.companyName assignedBranch rateCardBand status")
    .populate("assignedBranch", "name code status")
    .sort({ "company.companyName": 1 })
    .lean().exec();
  return response.status(200).json({ success: true, accounts });
}

export async function createCountryRateCard(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = countryRatePayloadSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      success: false,
      message: "Country rate is invalid.",
      errors: getValidationErrors(parsed.error)
    });
  }

  let releaseLock: (() => Promise<void>) | null = null;
  try {
    releaseLock = await acquireRateCardRouteLock(parsed.data);
    const overlappingRate = await findOverlappingRate(parsed.data);
    if (overlappingRate) {
      return response.status(409).json({
        success: false,
        message: getOverlapMessage(parsed.data)
      });
    }

    const rate = await CountryRateCard.create({
      ...parsed.data,
      createdBy: userId,
      updatedBy: userId
    });
    await AuditLog.create({
      action: "COUNTRY_RATE_CARD_CREATED",
      entityType: "COUNTRY_RATE_CARD",
      entityId: rate._id,
      performedBy: userId,
      performedAt: new Date(),
      metadata: { after: rate.toObject() }
    });

    return response.status(201).json({ success: true, rate });
  } catch (error) {
    if (error instanceof RateCardRouteBusyError) {
      return response.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    }
    throw error;
  } finally {
    if (releaseLock) await releaseLock().catch(() => undefined);
  }
}

export async function updateCountryRateCard(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const rateId = getRateId(request);
  if (!rateId) return response.status(404).json({ success: false, message: "Country rate not found" });

  const parsed = countryRatePayloadSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      success: false,
      message: "Country rate is invalid.",
      errors: getValidationErrors(parsed.error)
    });
  }

  const existingRate = await CountryRateCard.findById(rateId).exec();
  if (!existingRate) return response.status(404).json({ success: false, message: "Country rate not found" });
  if (existingRate.band !== parsed.data.band) {
    return response.status(409).json({
      success: false,
      code: "RATE_CARD_BAND_IMMUTABLE",
      message: "A saved rate cannot be moved to another band. Create a new rate in that band instead."
    });
  }

  let releaseLock: (() => Promise<void>) | null = null;
  try {
    releaseLock = await acquireRateCardRouteLock(parsed.data);
    const overlappingRate = await findOverlappingRate(parsed.data, rateId);
    if (overlappingRate) {
      return response.status(409).json({
        success: false,
        message: getOverlapMessage(parsed.data)
      });
    }

    const before = existingRate.toObject();
    Object.assign(existingRate, parsed.data, { updatedBy: userId });
    await existingRate.save();
    await AuditLog.create({
      action: "COUNTRY_RATE_CARD_UPDATED",
      entityType: "COUNTRY_RATE_CARD",
      entityId: existingRate._id,
      performedBy: userId,
      performedAt: new Date(),
      metadata: { before, after: existingRate.toObject() }
    });

    return response.status(200).json({ success: true, rate: existingRate });
  } catch (error) {
    if (error instanceof RateCardRouteBusyError) {
      return response.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    }
    throw error;
  } finally {
    if (releaseLock) await releaseLock().catch(() => undefined);
  }
}

export async function deleteCountryRateCard(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const rateId = getRateId(request);
  if (!rateId) return response.status(404).json({ success: false, message: "Country rate not found" });

  const rate = await CountryRateCard.findById(rateId).exec();
  if (!rate) return response.status(404).json({ success: false, message: "Country rate not found" });

  const assignedAccountCount = await BusinessAccount.countDocuments({
    accountKind: { $ne: "INDIVIDUAL_SENTINEL" },
    rateCardBand: rate.band
  }).exec();
  if (assignedAccountCount > 0 && request.query.confirmAssignedImpact !== "true") {
    return response.status(409).json({
      success: false,
      code: "RATE_CARD_DELETE_CONFIRMATION_REQUIRED",
      assignedAccountCount,
      message: `This band is assigned to ${assignedAccountCount} business account(s). Confirm deletion to continue.`
    });
  }

  let releaseLock: (() => Promise<void>) | null = null;
  try {
    releaseLock = await acquireRateCardRouteLock(rate);
    const before = rate.toObject();
    const deleted = await CountryRateCard.findOneAndDelete({ _id: rate._id }).exec();
    if (!deleted) return response.status(404).json({ success: false, message: "Country rate not found" });
    await AuditLog.create({
      action: "COUNTRY_RATE_CARD_DELETED",
      entityType: "COUNTRY_RATE_CARD",
      entityId: rate._id,
      performedBy: userId,
      performedAt: new Date(),
      metadata: { before, assignedAccountCount }
    });

    return response.status(200).json({ success: true, message: "Country rate removed." });
  } catch (error) {
    if (error instanceof RateCardRouteBusyError) {
      return response.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    }
    throw error;
  } finally {
    if (releaseLock) await releaseLock().catch(() => undefined);
  }
}

/**
 * Every configured route charge. Routes without a document are simply absent-
 * the rate card screen renders them as an empty, zero-charge form, which is what
 * the pricing engine treats them as.
 */
export async function listCountryRouteCharges(request: Request, response: Response): Promise<Response> {
  const band = typeof request.query.band === "string" ? request.query.band.toUpperCase() : "";
  const filters: Record<string, unknown> = {};
  if (band && !rateCardBandValues.includes(band as (typeof rateCardBandValues)[number])) {
    return response.status(400).json({ success: false, message: "Select a valid rate-card band." });
  }
  if (band) filters.band = band;
  const routeCharges = await CountryRouteCharge.find(filters)
    .sort({ countryCode: 1, service: 1 })
    .lean()
    .exec();

  return response.status(200).json({ success: true, routeCharges });
}

/**
 * Creates or replaces the configuration for one route.
 *
 * An upsert rather than separate create/update endpoints because the route key is
 * the identity here: an admin edits "United Kingdom / Courier", not a document id,
 * and saving twice must not produce two rows the pricing engine has to choose
 * between.
 */
export async function saveCountryRouteCharge(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = routeChargePayloadSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      success: false,
      message: "Route charges are invalid.",
      errors: getValidationErrors(parsed.error)
    });
  }

  let releaseLock: (() => Promise<void>) | null = null;
  try {
    releaseLock = await acquireRateCardRouteLock(parsed.data);
    const { band, countryCode, service, ...charges } = parsed.data;
    const before = await CountryRouteCharge.findOne({ band, countryCode, service }).lean().exec();
    const routeCharge = await CountryRouteCharge.findOneAndUpdate(
      { band, countryCode, service },
      {
        $set: { ...charges, updatedBy: userId },
        $setOnInsert: { band, countryCode, service, createdBy: userId }
      },
      { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).exec();
    if (!routeCharge) throw new Error("Route charge could not be saved.");
    await AuditLog.create({
      action: "COUNTRY_ROUTE_CHARGE_SAVED",
      entityType: "COUNTRY_ROUTE_CHARGE",
      entityId: routeCharge._id,
      performedBy: userId,
      performedAt: new Date(),
      metadata: { before, after: routeCharge.toObject() }
    });

    return response.status(200).json({ success: true, routeCharge });
  } catch (error) {
    if (error instanceof RateCardRouteBusyError) {
      return response.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    }
    throw error;
  } finally {
    if (releaseLock) await releaseLock().catch(() => undefined);
  }
}

/* -------------------------------------------------------------------------
 * Importing a rate list workbook
 * ---------------------------------------------------------------------- */

const importSlabSchema = z.object({
  fromKg: z.coerce.number().nonnegative(),
  toKg: z.coerce.number().positive(),
  chargesPerKg: z.coerce.number().nonnegative(),
  maxBoxKg: z.coerce.number().positive()
}).refine((slab) => slab.toKg >= slab.fromKg, {
  message: "To KG must be greater than or equal to From KG",
  path: ["toKg"]
});

const importRouteSchema = z.object({
  countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Country code must be a two-letter ISO code"),
  countryName: z.string().trim().min(2).max(80),
  slabs: z.array(importSlabSchema).min(1).max(rateCardImportLimits.maxWeightRows)
}).superRefine((route, context) => {
  // Overlap is checked here, in memory, rather than with a query per slab as
  // the manual create path does. The slabs arrive as a complete set for the
  // route and every one of them is about to replace what is stored, so the
  // only arrangement that matters is their arrangement against each other.
  const ordered = [...route.slabs].sort((a, b) => a.fromKg - b.fromKg);
  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index];
    const previous = ordered[index - 1];
    if (!current || !previous) continue;

    if (current.fromKg <= previous.toKg) {
      context.addIssue({
        code: "custom",
        path: ["slabs"],
        message: `${route.countryName}: the ${current.fromKg}-${current.toKg} kg slab overlaps ${previous.fromKg}-${previous.toKg} kg.`
      });
      return;
    }
  }
});

const importPayloadSchema = z.object({
  band: z.enum(rateCardBandValues),
  services: z.array(z.enum(countryRateServiceValues)).min(1, "Choose at least one service."),
  routes: z.array(importRouteSchema).min(1, "There is nothing to import."),
  // Set by the review screen once the operator has seen which destinations lose
  // their current rates. Re-checked below against the database, so a stale
  // review cannot let a replacement through unseen.
  confirmReplace: z.boolean().optional().default(false),
  fileName: z.string().trim().max(255).optional()
}).superRefine((payload, context) => {
  const services = new Set(payload.services);
  if (services.size !== payload.services.length) {
    context.addIssue({ code: "custom", path: ["services"], message: "Each service can only be imported once." });
  }

  const codes = new Set(payload.routes.map((route) => route.countryCode));
  if (codes.size !== payload.routes.length) {
    context.addIssue({ code: "custom", path: ["routes"], message: "The same destination appears more than once." });
  }

  const total = payload.routes.reduce((running, route) => running + route.slabs.length, 0) * services.size;
  if (total > rateCardImportLimits.maxSlabs) {
    context.addIssue({
      code: "custom",
      path: ["routes"],
      message: `This import would write ${total} rate rows, more than the ${rateCardImportLimits.maxSlabs} allowed at once.`
    });
  }
});

function getUploadExtension(originalName: string) {
  const extension = path.extname(originalName).toLowerCase();
  return extension === ".csv" || extension === ".xls" || extension === ".xlsx" ? extension : null;
}

/**
 * Reads an uploaded rate list and hands back its grid. Writes nothing.
 *
 * Country names are returned exactly as the workbook spells them: matching them
 * to ISO codes happens in the browser, against the same catalogue the country
 * picker uses, and the operator confirms the result before anything is stored.
 */
export async function previewRateCardImport(request: Request, response: Response): Promise<Response> {
  const file = (request as Request & { file?: Express.Multer.File }).file;
  if (!file) return response.status(400).json({ success: false, message: "Attach a rate list to import." });

  const extension = getUploadExtension(file.originalname);
  if (!extension) {
    return response.status(400).json({ success: false, message: "Only .csv, .xls and .xlsx rate lists are supported." });
  }

  try {
    const parsed = await parseRateCardWorkbook(file.buffer, extension);
    return response.status(200).json({ success: true, fileName: file.originalname, ...parsed });
  } catch (error) {
    if (error instanceof RateCardImportError) {
      return response.status(400).json({ success: false, message: error.message });
    }

    // A workbook ExcelJS cannot open is a bad upload, not a server fault.
    return response.status(400).json({
      success: false,
      message: "The file could not be read as a spreadsheet. Re-save it as .xlsx and try again."
    });
  }
}

/**
 * Writes the reviewed rate list.
 *
 * Replace-per-route: for every destination in the payload the stored slabs are
 * deleted and the imported ones inserted. Merging is not an option- the model
 * forbids overlapping slabs, and a hand-tuned 5.01-10 overlaps an incoming
 * 5.01-6, so a merge would have to either reject the import or leave the route
 * holding two prices for the same weight. Destinations absent from the file are
 * never touched.
 */
export async function commitRateCardImport(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = importPayloadSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      success: false,
      message: "This import is invalid.",
      errors: getValidationErrors(parsed.error)
    });
  }

  const { band, services, routes, confirmReplace, fileName } = parsed.data;
  const routeByCode = new Map(routes.map((route) => [route.countryCode, route]));

  const existing = await CountryRateCard.find({
    band,
    countryCode: { $in: [...routeByCode.keys()] },
    service: { $in: services }
  }).select("countryCode service").lean().exec();

  const existingCounts = new Map<string, number>();
  for (const rate of existing) {
    const key = `${rate.countryCode}:${rate.service}`;
    existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
  }

  if (existingCounts.size && !confirmReplace) {
    const replacements = [...existingCounts.entries()].map(([key, count]) => {
      const separator = key.indexOf(":");
      const countryCode = key.slice(0, separator);
      const service = key.slice(separator + 1);
      return {
        countryCode,
        countryName: routeByCode.get(countryCode)?.countryName ?? countryCode,
        service,
        existingSlabs: count,
        incomingSlabs: routeByCode.get(countryCode)?.slabs.length ?? 0
      };
    });

    const countries = new Set(replacements.map((entry) => entry.countryCode)).size;
    return response.status(409).json({
      success: false,
      code: "RATE_CARD_IMPORT_REPLACE_UNCONFIRMED",
      replacements,
      message: `${countries} destination${countries === 1 ? "" : "s"} on this band already have rates. Confirm the replacement to continue.`
    });
  }

  const targets = routes.flatMap((route) => services.map((service) => ({ route, service })));
  const releases: Array<() => Promise<void>> = [];
  const session = await mongoose.startSession();
  let summary: Array<{ countryCode: string; countryName: string; service: string; added: number; removed: number }> = [];

  try {
    // Every route is locked before anything is written, so a half-finished
    // import cannot race an operator editing one of the same destinations by
    // hand. One lock per route rather than the manual path one lock per slab.
    for (const { route, service } of targets) {
      releases.push(await acquireRateCardRouteLock({ band, countryCode: route.countryCode, service }));
    }

    await session.withTransaction(async () => {
      // Reset inside the callback: withTransaction re-runs it on a transient
      // error, and totals carried over from the abandoned attempt would double.
      summary = [];

      for (const { route, service } of targets) {
        const removal = await CountryRateCard.deleteMany({
          band,
          countryCode: route.countryCode,
          service
        }).session(session).exec();

        const documents = route.slabs.map((slab) => ({
          band,
          countryCode: route.countryCode,
          countryName: route.countryName,
          service,
          fromKg: slab.fromKg,
          toKg: slab.toKg,
          chargesPerKg: slab.chargesPerKg,
          maxBoxKg: slab.maxBoxKg,
          createdBy: userId,
          updatedBy: userId
        }));

        const created = await CountryRateCard.insertMany(documents, { session, ordered: true });

        // One entry per route rather than one per import, because an audit
        // entry is keyed to an entity and an import spans hundreds. This is the
        // same granularity as a route charge save, and it makes "what happened
        // to Belgium Courier" answerable.
        await AuditLog.create([{
          action: "COUNTRY_RATE_CARD_IMPORTED",
          entityType: "COUNTRY_RATE_CARD",
          entityId: created[0]?._id,
          performedBy: userId,
          performedAt: new Date(),
          metadata: {
            fileName: fileName ?? null,
            band,
            service,
            countryCode: route.countryCode,
            countryName: route.countryName,
            added: documents.length,
            removed: removal.deletedCount ?? 0,
            slabs: route.slabs
          }
        }], { session });

        summary.push({
          countryCode: route.countryCode,
          countryName: route.countryName,
          service,
          added: documents.length,
          removed: removal.deletedCount ?? 0
        });
      }
    });

    const slabsWritten = summary.reduce((running, entry) => running + entry.added, 0);
    const slabsRemoved = summary.reduce((running, entry) => running + entry.removed, 0);

    return response.status(200).json({
      success: true,
      band,
      services,
      routesWritten: routes.length,
      slabsWritten,
      slabsRemoved,
      summary
    });
  } catch (error) {
    if (error instanceof RateCardRouteBusyError) {
      return response.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    }
    throw error;
  } finally {
    await session.endSession();
    await Promise.all(releases.map((release) => release().catch(() => undefined)));
  }
}
