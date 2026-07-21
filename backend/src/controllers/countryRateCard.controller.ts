import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import {
  CountryRateCard,
  countryRateServiceValues
} from "../models/countryRateCard.model.js";

const countryRatePayloadSchema = z.object({
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
  const filters: Record<string, unknown> = {};

  if (countryCode) filters.countryCode = countryCode;
  if (service) filters.service = service;

  const rates = await CountryRateCard.find(filters)
    .sort({ countryName: 1, service: 1, fromKg: 1 })
    .lean()
    .exec();

  return response.status(200).json({ success: true, rates });
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

  return response.status(201).json({ success: true, rate });
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

  const overlappingRate = await findOverlappingRate(parsed.data, rateId);
  if (overlappingRate) {
    return response.status(409).json({
      success: false,
      message: getOverlapMessage(parsed.data)
    });
  }

  const rate = await CountryRateCard.findByIdAndUpdate(
    rateId,
    { ...parsed.data, updatedBy: userId },
    { new: true, runValidators: true }
  ).exec();

  if (!rate) return response.status(404).json({ success: false, message: "Country rate not found" });

  return response.status(200).json({ success: true, rate });
}

export async function deleteCountryRateCard(request: Request, response: Response): Promise<Response> {
  const rateId = getRateId(request);
  if (!rateId) return response.status(404).json({ success: false, message: "Country rate not found" });

  const rate = await CountryRateCard.findByIdAndDelete(rateId).exec();
  if (!rate) return response.status(404).json({ success: false, message: "Country rate not found" });

  return response.status(200).json({ success: true, message: "Country rate removed." });
}
