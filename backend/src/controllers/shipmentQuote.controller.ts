import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { ShipmentQuote, shipmentQuoteStatusValues } from "../models/shipmentQuote.model.js";
import {
  ShipmentQuoteError, calculateQuoteEstimate, changeShipmentQuoteStatus,
  convertShipmentQuoteToDraft, createShipmentDraftFromEstimate, createShipmentQuote, loadQuoteContext,
  publishShipmentQuote, resolveAdminQuoteContext, resolveClientQuoteContext,
  serializeShipmentQuote, type ShipmentQuoteRequestInput
} from "../services/shipmentQuote.service.js";

const parcelSchema = z.object({
  sequence: z.coerce.number().int().min(1),
  actualWeightKg: z.coerce.number().positive().max(10000),
  lengthCm: z.coerce.number().positive().max(10000),
  widthCm: z.coerce.number().positive().max(10000),
  heightCm: z.coerce.number().positive().max(10000)
});

const quoteRequestSchema = z.object({
  businessAccountId: z.string().trim().optional(),
  destinationCountryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  destinationCountryName: z.string().trim().min(2).max(80),
  shipmentType: z.enum(["DOCUMENTS", "PARCEL", "MERCHANDISE", "SAMPLES", "GIFTS", "RETURNS", "OTHER"]),
  serviceType: z.enum(["COURIER", "CARGO"]),
  goodsValueMinor: z.coerce.number().int().min(0).max(1_000_000_000),
  contents: z.string().trim().min(2).max(500),
  parcels: z.array(parcelSchema).min(1).max(100)
});

const publishSchema = z.object({
  freightMinor: z.coerce.number().int().min(0),
  fuelSurchargeMinor: z.coerce.number().int().min(0).default(0),
  taxableAddOnsMinor: z.coerce.number().int().min(0).default(0),
  validUntil: z.coerce.date(),
  customerNote: z.string().trim().max(1000).default(""),
  internalNote: z.string().trim().max(1000).default("")
});

function getUserId(request: Request) {
  const value = (request as Request & { user?: { _id?: unknown } }).user?._id;
  return value && mongoose.Types.ObjectId.isValid(String(value)) ? new mongoose.Types.ObjectId(String(value)) : null;
}

function handleQuoteError(error: unknown, response: Response): Response {
  if (error instanceof ShipmentQuoteError) {
    return response.status(error.statusCode).json({ success: false, message: error.message });
  }
  if (error instanceof z.ZodError) {
    return response.status(400).json({
      success: false,
      message: error.issues[0]?.message || "Correct the highlighted quote details and try again.",
      errors: error.flatten().fieldErrors
    });
  }
  throw error;
}

async function serializeWithContext(quote: InstanceType<typeof ShipmentQuote>, audience: "CLIENT" | "ADMIN" = "ADMIN") {
  const result = serializeShipmentQuote(quote, await loadQuoteContext(quote));
  return audience === "CLIENT" ? { ...result, internalNote: "" } : result;
}

export async function getClientQuoteContext(request: Request, response: Response) {
  try {
    const actor = getUserId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Sign in to continue." });
    const selected = typeof request.query.businessAccountId === "string" ? request.query.businessAccountId : undefined;
    return response.json({ success: true, context: await resolveClientQuoteContext(String(actor), selected) });
  } catch (error) {
    return handleQuoteError(error, response);
  }
}

export async function getAdminQuoteContext(_request: Request, response: Response) {
  const accounts = await BusinessAccount.find({ status: { $in: ["approved", "active"] }, assignedBranch: { $ne: null } })
    .populate("assignedBranch", "name code status address contact")
    .select("accountId company.companyName assignedBranch")
    .sort({ "company.companyName": 1 }).lean().exec();
  return response.json({
    success: true,
    accounts: accounts.flatMap((account) => {
      const branch = account.assignedBranch as unknown as {
        _id: unknown; name?: string; code?: string; status?: string;
        address?: { city?: string }; contact?: { email?: string; phone?: string };
      } | null;
      if (!branch || branch.status !== "ACTIVE") return [];
      return [{
        businessAccountId: String(account._id), accountId: account.accountId,
        companyName: account.company.companyName,
        branchId: String(branch._id), branchName: branch.name ?? "", branchCode: branch.code ?? "",
        originCity: branch.address?.city ?? "", branchContact: branch.contact ?? { email: "", phone: "" }
      }];
    })
  });
}

async function estimate(request: Request, response: Response, audience: "CLIENT" | "ADMIN") {
  try {
    const actor = getUserId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Sign in to continue." });
    const input = quoteRequestSchema.parse(request.body) as ShipmentQuoteRequestInput;
    const context = audience === "ADMIN"
      ? await resolveAdminQuoteContext(input.businessAccountId ?? "")
      : await resolveClientQuoteContext(String(actor), input.businessAccountId, true);
    return response.json({ success: true, context, estimate: await calculateQuoteEstimate(context, input) });
  } catch (error) {
    return handleQuoteError(error, response);
  }
}

export const estimateClientShipmentQuote = (request: Request, response: Response) => estimate(request, response, "CLIENT");
export const estimateAdminShipmentQuote = (request: Request, response: Response) => estimate(request, response, "ADMIN");

async function create(request: Request, response: Response, source: "CLIENT" | "ADMIN") {
  try {
    const actor = getUserId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Sign in to continue." });
    const input = quoteRequestSchema.parse(request.body) as ShipmentQuoteRequestInput;
    const context = source === "ADMIN"
      ? await resolveAdminQuoteContext(input.businessAccountId ?? "")
      : await resolveClientQuoteContext(String(actor), input.businessAccountId, true);
    const quote = await createShipmentQuote({ context, request: input, source, userId: actor });
    return response.status(201).json({ success: true, quote: await serializeWithContext(quote, source) });
  } catch (error) {
    return handleQuoteError(error, response);
  }
}

export const createClientShipmentQuote = (request: Request, response: Response) => create(request, response, "CLIENT");
export const createAdminShipmentQuote = (request: Request, response: Response) => create(request, response, "ADMIN");

async function createDraft(request: Request, response: Response, audience: "CLIENT" | "ADMIN") {
  try {
    const actor = getUserId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Sign in to continue." });
    const input = quoteRequestSchema.parse(request.body) as ShipmentQuoteRequestInput;
    const context = audience === "ADMIN"
      ? await resolveAdminQuoteContext(input.businessAccountId ?? "")
      : await resolveClientQuoteContext(String(actor), input.businessAccountId, true);
    const draft = await createShipmentDraftFromEstimate({ context, request: input, userId: actor });
    return response.status(201).json({ success: true, shipmentDraftId: String(draft._id) });
  } catch (error) {
    return handleQuoteError(error, response);
  }
}

export const createClientQuoteShipmentDraft = (request: Request, response: Response) => createDraft(request, response, "CLIENT");
export const createAdminQuoteShipmentDraft = (request: Request, response: Response) => createDraft(request, response, "ADMIN");

async function list(request: Request, response: Response, audience: "CLIENT" | "ADMIN") {
  try {
    const actor = getUserId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Sign in to continue." });
    const page = Math.max(1, Number(request.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(request.query.limit) || 20));
    const filters: Record<string, unknown> = {};
    if (audience === "CLIENT") {
      const selected = typeof request.query.businessAccountId === "string" ? request.query.businessAccountId : undefined;
      filters.businessAccountId = (await resolveClientQuoteContext(String(actor), selected)).businessAccountId;
    } else {
      if (typeof request.query.status === "string" && shipmentQuoteStatusValues.includes(request.query.status as never)) filters.status = request.query.status;
      if (typeof request.query.businessAccountId === "string" && mongoose.Types.ObjectId.isValid(request.query.businessAccountId)) {
        filters.businessAccountId = request.query.businessAccountId;
      }
    }
    const [quotes, total] = await Promise.all([
      ShipmentQuote.find(filters).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).exec(),
      ShipmentQuote.countDocuments(filters)
    ]);
    return response.json({
      success: true,
      quotes: await Promise.all(quotes.map((quote) => serializeWithContext(quote, audience))),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    });
  } catch (error) {
    return handleQuoteError(error, response);
  }
}

export const listClientShipmentQuotes = (request: Request, response: Response) => list(request, response, "CLIENT");
export const listAdminShipmentQuotes = (request: Request, response: Response) => list(request, response, "ADMIN");

async function authorizedQuote(request: Request, audience: "CLIENT" | "ADMIN", requireRequestPermission = false) {
  const quoteId = String(request.params.quoteId ?? "");
  if (!mongoose.Types.ObjectId.isValid(quoteId)) throw new ShipmentQuoteError("Quote not found.", 404);
  const quote = await ShipmentQuote.findById(quoteId).exec();
  if (!quote) throw new ShipmentQuoteError("Quote not found.", 404);
  if (audience === "CLIENT") {
    const actor = getUserId(request);
    if (!actor) throw new ShipmentQuoteError("Sign in to continue.", 401);
    const context = await resolveClientQuoteContext(String(actor), String(quote.businessAccountId), requireRequestPermission);
    if (String(context.businessAccountId) !== String(quote.businessAccountId)) throw new ShipmentQuoteError("Quote not found.", 404);
  }
  return quote;
}

async function getOne(request: Request, response: Response, audience: "CLIENT" | "ADMIN") {
  try {
    return response.json({ success: true, quote: await serializeWithContext(await authorizedQuote(request, audience), audience) });
  } catch (error) {
    return handleQuoteError(error, response);
  }
}

export const getClientShipmentQuote = (request: Request, response: Response) => getOne(request, response, "CLIENT");
export const getAdminShipmentQuote = (request: Request, response: Response) => getOne(request, response, "ADMIN");

export async function updateAdminShipmentQuoteStatus(request: Request, response: Response) {
  try {
    const actor = getUserId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Sign in to continue." });
    const status = z.enum(["UNDER_REVIEW", "DECLINED"]).parse(request.body.status);
    const note = z.string().trim().max(500).optional().parse(request.body.note);
    const quote = await changeShipmentQuoteStatus({ quote: await authorizedQuote(request, "ADMIN"), status, note, userId: actor });
    return response.json({ success: true, quote: await serializeWithContext(quote) });
  } catch (error) {
    return handleQuoteError(error, response);
  }
}

export async function publishAdminShipmentQuote(request: Request, response: Response) {
  try {
    const actor = getUserId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Sign in to continue." });
    const input = publishSchema.parse(request.body);
    const quote = await publishShipmentQuote({ quote: await authorizedQuote(request, "ADMIN"), userId: actor, ...input });
    return response.json({ success: true, quote: await serializeWithContext(quote) });
  } catch (error) {
    return handleQuoteError(error, response);
  }
}

async function convert(request: Request, response: Response, audience: "CLIENT" | "ADMIN") {
  try {
    const actor = getUserId(request);
    if (!actor) return response.status(401).json({ success: false, message: "Sign in to continue." });
    const quote = await authorizedQuote(request, audience, audience === "CLIENT");
    const draft = await convertShipmentQuoteToDraft({ quote, userId: actor });
    if (!draft) throw new ShipmentQuoteError("Shipment draft could not be created. Please try again.", 500);
    return response.status(201).json({ success: true, shipmentDraftId: String(draft._id) });
  } catch (error) {
    return handleQuoteError(error, response);
  }
}

export const convertClientShipmentQuote = (request: Request, response: Response) => convert(request, response, "CLIENT");
export const convertAdminShipmentQuote = (request: Request, response: Response) => convert(request, response, "ADMIN");
