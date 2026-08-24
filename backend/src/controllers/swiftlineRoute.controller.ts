import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog } from "../models/auditLog.model.js";
import { CountryRateCard, countryRateServiceValues } from "../models/countryRateCard.model.js";
import {
  SwiftlineRoute,
  routeTransitBasisValues,
  trackingProfileValues
} from "../models/swiftlineRoute.model.js";
import { defaultOriginCountryCode } from "../services/swiftlineRoute.service.js";

/** A destination that has published rates, whether or not a lane exists. */
type RateCardCoverage = { countryCode: string; countryName: string; service: string };

const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Country code must be a two-letter ISO code");

const routePayloadSchema = z.object({
  // Defaulted rather than required: the form does not ask for it while India is
  // the only gateway, but the field is accepted so a second one needs no change.
  originCountryCode: countryCodeSchema.default(defaultOriginCountryCode),
  destinationCountryCode: countryCodeSchema,
  destinationCountryName: z.string().trim().min(2).max(80),
  // Ordered transit stops. Blanks are dropped rather than rejected so a form
  // row left empty is simply not a stop.
  viaCountryCodes: z.array(countryCodeSchema.or(z.literal("")))
    .max(4, "A route may pass through at most four countries.")
    .optional()
    .default([])
    .transform((values) => values.filter(Boolean)),
  service: z.enum(countryRateServiceValues),
  transitDaysMin: z.coerce.number().int().min(1).max(120),
  transitDaysMax: z.coerce.number().int().min(1).max(120),
  transitBasis: z.enum(routeTransitBasisValues).default("BUSINESS_DAYS"),
  trackingProfile: z.enum(trackingProfileValues).default("AUTO"),
  originHubName: z.string().trim().min(2).max(120).default("Delhi Hub"),
  serviceable: z.coerce.boolean().default(true),
  cutOffTime: z
    .string()
    .trim()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Cut-off time must be a 24-hour time such as 16:30.")
    .or(z.literal(""))
    .default(""),
  restrictions: z.string().trim().max(1000).default(""),
  notes: z.string().trim().max(1000).default("")
}).refine((data) => data.transitDaysMax >= data.transitDaysMin, {
  message: "Maximum transit days must be greater than or equal to minimum transit days.",
  path: ["transitDaysMax"]
}).refine((data) => data.originCountryCode !== data.destinationCountryCode, {
  // A lane to its own origin has no transit time to quote and would sit in the
  // list looking like a real destination.
  message: "Origin and destination must be different countries.",
  path: ["destinationCountryCode"]
}).refine((data) => new Set(data.viaCountryCodes).size === data.viaCountryCodes.length, {
  message: "Each transit country may only appear once.",
  path: ["viaCountryCodes"]
}).refine(
  (data) => !data.viaCountryCodes.some(
    (code) => code === data.originCountryCode || code === data.destinationCountryCode
  ),
  {
    message: "A transit country cannot also be the origin or the destination.",
    path: ["viaCountryCodes"]
  }
);

function getAuthenticatedUserId(request: Request): mongoose.Types.ObjectId | null {
  const user = (request as Request & { user?: { _id?: unknown } }).user;
  const id = user?._id;

  return id && mongoose.Types.ObjectId.isValid(String(id))
    ? new mongoose.Types.ObjectId(String(id))
    : null;
}

function getValidationErrors(error: z.ZodError) {
  return error.issues.map((issue) => issue.message);
}

function getRouteId(request: Request) {
  const routeId = typeof request.params.routeId === "string" ? request.params.routeId : "";
  return mongoose.Types.ObjectId.isValid(routeId) ? routeId : "";
}

/**
 * Every configured lane, newest destinations grouped together.
 *
 * The whole list is returned unpaginated on purpose: a route per destination
 * country per service tops out in the low hundreds, and the admin screen filters
 * and sorts across all of them at once.
 */
export async function listSwiftlineRoutes(request: Request, response: Response): Promise<Response> {
  const service = typeof request.query.service === "string" ? request.query.service.toUpperCase() : "";
  if (service && !countryRateServiceValues.includes(service as (typeof countryRateServiceValues)[number])) {
    return response.status(400).json({ success: false, message: "Select a valid service." });
  }

  const search = typeof request.query.search === "string" ? request.query.search.trim() : "";
  const filters: Record<string, unknown> = {};
  if (service) filters.service = service;
  if (search) {
    // Matches either the country name as typed or its ISO code, so "GB" and
    // "United Kingdom" both find the same lane.
    const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filters.$or = [{ destinationCountryName: pattern }, { destinationCountryCode: pattern }];
  }

  // Coverage is every destination that has published rates, whether or not a
  // lane exists for it. The screen diffs the two to show which destinations are
  // priced but unroutable- a gap that costs a transit estimate and leaves the
  // customer tracking page on generic copy, and that neither list shows alone.
  const [routes, coverage] = await Promise.all([
    SwiftlineRoute.find(filters)
      .sort({ destinationCountryName: 1, service: 1 })
      .lean()
      .exec(),
    CountryRateCard.aggregate<RateCardCoverage>([
      {
        $group: {
          _id: { countryCode: "$countryCode", service: "$service" },
          countryName: { $first: "$countryName" }
        }
      },
      {
        $project: {
          _id: 0,
          countryCode: "$_id.countryCode",
          service: "$_id.service",
          countryName: 1
        }
      },
      { $sort: { countryName: 1, service: 1 } }
    ]).exec()
  ]);

  return response.status(200).json({ success: true, routes, coverage });
}

/**
 * Creates or replaces one lane.
 *
 * An upsert keyed on origin + destination + service, matching how route charges
 * are saved: the operator edits "United Kingdom / Courier", not a document id,
 * and saving twice must not leave two rows for an estimate to choose between.
 */
export async function saveSwiftlineRoute(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = routePayloadSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      success: false,
      message: "Route details are invalid.",
      errors: getValidationErrors(parsed.error)
    });
  }

  const { originCountryCode, destinationCountryCode, service, ...details } = parsed.data;
  const lane = { originCountryCode, destinationCountryCode, service };

  const before = await SwiftlineRoute.findOne(lane).lean().exec();
  const route = await SwiftlineRoute.findOneAndUpdate(
    lane,
    {
      $set: { ...details, updatedBy: userId },
      $setOnInsert: { ...lane, createdBy: userId }
    },
    { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).exec();

  if (!route) {
    return response.status(500).json({ success: false, message: "Route could not be saved." });
  }

  await AuditLog.create({
    action: before ? "SWIFTLINE_ROUTE_UPDATED" : "SWIFTLINE_ROUTE_CREATED",
    entityType: "SWIFTLINE_ROUTE",
    entityId: route._id,
    performedBy: userId,
    performedAt: new Date(),
    metadata: { before, after: route.toObject() }
  });

  return response.status(200).json({
    success: true,
    message: before ? "Route updated." : "Route added.",
    route
  });
}

/**
 * Removes a lane outright.
 *
 * Closing a lane is what `serviceable: false` is for and is almost always the
 * right action- it keeps the transit times for when the lane reopens. Deletion
 * exists for lanes added by mistake.
 */
export async function deleteSwiftlineRoute(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const routeId = getRouteId(request);
  if (!routeId) return response.status(400).json({ success: false, message: "Select a valid route." });

  const route = await SwiftlineRoute.findByIdAndDelete(routeId).lean().exec();
  if (!route) return response.status(404).json({ success: false, message: "Route was not found." });

  await AuditLog.create({
    action: "SWIFTLINE_ROUTE_DELETED",
    entityType: "SWIFTLINE_ROUTE",
    entityId: route._id,
    performedBy: userId,
    performedAt: new Date(),
    metadata: { before: route }
  });

  return response.status(200).json({ success: true, message: "Route removed." });
}

/* -------------------------------------------------------------------------
 * Opening many lanes at once
 * ---------------------------------------------------------------------- */

/**
 * One set of route details applied to many destinations.
 *
 * A rate list opens thirty destinations at a time, and every one of them needs
 * a lane before it can quote a transit time or show its real hub on the
 * customer tracking page. Entering those one at a time is the same twelve
 * fields typed thirty times, and the fields that actually differ per lane -
 * restrictions, transit stops - are the ones an operator wants to revisit
 * afterwards anyway.
 *
 * The details are validated per expanded lane through `routePayloadSchema`, the
 * same schema the single-route form posts to, so bulk and single writes cannot
 * drift apart or disagree about what a valid lane is.
 */
const bulkRoutePayloadSchema = z.object({
  destinations: z.array(z.object({
    countryCode: countryCodeSchema,
    countryName: z.string().trim().min(2).max(80)
  })).min(1, "Choose at least one destination.").max(300),
  services: z.array(z.enum(countryRateServiceValues)).min(1, "Choose at least one service."),
  details: z.object({
    viaCountryCodes: z.array(countryCodeSchema.or(z.literal(""))).max(4).optional().default([]),
    transitDaysMin: z.coerce.number().int().min(1).max(120),
    transitDaysMax: z.coerce.number().int().min(1).max(120),
    transitBasis: z.enum(routeTransitBasisValues).default("BUSINESS_DAYS"),
    trackingProfile: z.enum(trackingProfileValues).default("AUTO"),
    originHubName: z.string().trim().min(2).max(120).default("Delhi Hub"),
    serviceable: z.coerce.boolean().default(true),
    cutOffTime: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/).or(z.literal("")).default(""),
    restrictions: z.string().trim().max(1000).default(""),
    notes: z.string().trim().max(1000).default("")
  }),
  // Off by default, so the common case- filling in the lanes that do not exist
  // yet- can never overwrite transit times somebody tuned by hand.
  overwriteExisting: z.boolean().optional().default(false)
}).superRefine((payload, context) => {
  const codes = new Set(payload.destinations.map((destination) => destination.countryCode));
  if (codes.size !== payload.destinations.length) {
    context.addIssue({ code: "custom", path: ["destinations"], message: "The same destination appears more than once." });
  }

  const services = new Set(payload.services);
  if (services.size !== payload.services.length) {
    context.addIssue({ code: "custom", path: ["services"], message: "Each service can only be chosen once." });
  }
});

export async function bulkSaveSwiftlineRoutes(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = bulkRoutePayloadSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      success: false,
      message: "These route details are invalid.",
      errors: getValidationErrors(parsed.error)
    });
  }

  const { destinations, services, details, overwriteExisting } = parsed.data;

  // Every lane is validated before any of them is written, so a payload with one
  // bad entry is rejected whole rather than applied halfway.
  const lanes: Array<z.infer<typeof routePayloadSchema>> = [];
  for (const destination of destinations) {
    for (const service of services) {
      const lane = routePayloadSchema.safeParse({
        ...details,
        destinationCountryCode: destination.countryCode,
        destinationCountryName: destination.countryName,
        service
      });

      if (!lane.success) {
        return response.status(400).json({
          success: false,
          message: `${destination.countryName} could not be routed.`,
          errors: getValidationErrors(lane.error)
        });
      }

      lanes.push(lane.data);
    }
  }

  const existing = await SwiftlineRoute.find({
    originCountryCode: defaultOriginCountryCode,
    destinationCountryCode: { $in: destinations.map((destination) => destination.countryCode) },
    service: { $in: services }
  }).select("destinationCountryCode service").lean().exec();

  const existingKeys = new Set(existing.map((route) => `${route.destinationCountryCode}:${route.service}`));

  const created: Array<{ countryCode: string; countryName: string; service: string }> = [];
  const updated: Array<{ countryCode: string; countryName: string; service: string }> = [];
  const skipped: Array<{ countryCode: string; countryName: string; service: string }> = [];

  for (const lane of lanes) {
    const { originCountryCode, destinationCountryCode, service, ...rest } = lane;
    const key = `${destinationCountryCode}:${service}`;
    const summary = {
      countryCode: destinationCountryCode,
      countryName: lane.destinationCountryName,
      service
    };

    if (existingKeys.has(key) && !overwriteExisting) {
      skipped.push(summary);
      continue;
    }

    const laneKey = { originCountryCode, destinationCountryCode, service };
    // findOneAndUpdate per lane rather than bulkWrite: the model's
    // `pre("findOneAndUpdate")` hook is what checks transit ordering and that a
    // stop is not also an endpoint, and bulkWrite bypasses document middleware
    // entirely. A few dozen round trips on an admin action is a fair price for
    // not writing an incoherent lane.
    const route = await SwiftlineRoute.findOneAndUpdate(
      laneKey,
      {
        $set: { ...rest, updatedBy: userId },
        $setOnInsert: { ...laneKey, createdBy: userId }
      },
      { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).exec();

    if (!route) {
      return response.status(500).json({ success: false, message: `${summary.countryName} could not be saved.` });
    }

    const wasExisting = existingKeys.has(key);
    if (wasExisting) updated.push(summary);
    else created.push(summary);

    await AuditLog.create({
      action: wasExisting ? "SWIFTLINE_ROUTE_UPDATED" : "SWIFTLINE_ROUTE_CREATED",
      entityType: "SWIFTLINE_ROUTE",
      entityId: route._id,
      performedBy: userId,
      performedAt: new Date(),
      metadata: { after: route.toObject(), bulk: true }
    });
  }

  return response.status(200).json({
    success: true,
    message: `${created.length} lane${created.length === 1 ? "" : "s"} added`
      + (updated.length ? `, ${updated.length} updated` : "")
      + (skipped.length ? `, ${skipped.length} left as they were` : "")
      + ".",
    created,
    updated,
    skipped
  });
}
