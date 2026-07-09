import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog } from "../models/auditLog.model.js";
import {
  Branch,
  branchServiceValues,
  BranchStatus,
  shipmentCoverageValues,
  workingDayValues
} from "../models/branch.model.js";

const currencyValues = ["INR", "USD", "AED", "GBP", "EUR", "SGD", "CAD", "AUD", "SAR"] as const;
const countryCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Country code must be a two-letter ISO code");
const branchCodeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/, "Branch code must be 3-20 uppercase letters, numbers, or hyphens");

const branchPayloadSchema = z.object({
  name: z.string().trim().min(3).max(100),
  code: branchCodeSchema,
  openingDate: z.string().trim().optional().nullable(),
  description: z.string().trim().max(500).optional().default(""),
  address: z.object({
    countryCode: countryCodeSchema.optional().or(z.literal("")),
    countryName: z.string().trim().max(80).optional().default(""),
    city: z.string().trim().max(80).optional().default(""),
    postalCode: z.string().trim().max(20).optional().default(""),
    address: z.string().trim().max(500).optional().default("")
  }).optional().default({
    countryCode: "",
    countryName: "",
    city: "",
    postalCode: "",
    address: ""
  }),
  contact: z.object({
    email: z.string().trim().email().optional().or(z.literal("")),
    phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Phone must include country code, for example +919876543210").optional().or(z.literal(""))
  }).default({}),
  operations: z.object({
    supportedServices: z.array(z.enum(branchServiceValues)).default([]),
    shipmentCoverage: z.array(z.enum(shipmentCoverageValues)).default([]),
    operatingCountries: z.array(countryCodeSchema).default([]),
    workingDays: z.array(z.enum(workingDayValues)).default([])
  }).optional().default({
    supportedServices: [],
    shipmentCoverage: [],
    operatingCountries: [],
    workingDays: []
  }),
  baseCurrency: z.enum(currencyValues).optional().or(z.literal("")),
  status: z.enum(["DRAFT", "ACTIVE"])
});

type BranchPayload = z.infer<typeof branchPayloadSchema>;

function getAuthenticatedUserId(request: Request): mongoose.Types.ObjectId | null {
  const user = (request as Request & { user?: { _id?: unknown } }).user;
  const id = user?._id;

  return id && mongoose.Types.ObjectId.isValid(String(id))
    ? new mongoose.Types.ObjectId(String(id))
    : null;
}

function getActiveBranchValidationError(data: BranchPayload): string | null {
  if (!data.address.countryCode || !data.address.countryName) return "Country is required";
  if (!data.address.city) return "City is required";
  if (!data.address.postalCode) return "Postal code is required";
  if (!data.address.address) return "Address is required";
  if (!data.contact.email) return "Email is required";
  if (!data.contact.phone) return "Phone is required";
  if (!data.operations.supportedServices.length) return "Select at least one supported service";
  if (!data.operations.shipmentCoverage.length) return "Select at least one shipment coverage type";
  if (!data.baseCurrency) return "Base currency is required";
  if (!data.operations.workingDays.length) return "Select at least one working day";

  return null;
}

function normalizeBranchPayload(data: BranchPayload, userId: mongoose.Types.ObjectId, mode: "create" | "update" = "create") {
  const openingDate = data.openingDate ? new Date(data.openingDate) : null;
  const isDomesticOnly = data.operations.shipmentCoverage.length === 1 && data.operations.shipmentCoverage[0] === "DOMESTIC";
  const operatingCountries = data.operations.operatingCountries.length
    ? data.operations.operatingCountries
    : isDomesticOnly && data.address.countryCode
      ? [data.address.countryCode]
      : [];

  // Keep payload assembly explicit so draft-vs-active behavior is easy to audit.
  const payload = {
    name: data.name,
    code: data.code,
    openingDate: openingDate && Number.isFinite(openingDate.getTime()) ? openingDate : null,
    description: data.description ?? "",
    address: {
      countryCode: data.address.countryCode || "",
      countryName: data.address.countryName || "",
      city: data.address.city || "",
      postalCode: data.address.postalCode || "",
      address: data.address.address || ""
    },
    contact: {
      email: data.contact.email || "",
      phone: data.contact.phone || ""
    },
    operations: {
      supportedServices: data.operations.supportedServices,
      shipmentCoverage: data.operations.shipmentCoverage,
      operatingCountries,
      workingDays: data.operations.workingDays
    },
    baseCurrency: data.baseCurrency || "",
    status: data.status as BranchStatus,
    updatedBy: userId
  };

  return mode === "create" ? { ...payload, createdBy: userId } : payload;
}

async function createBranchAuditLog(branchId: mongoose.Types.ObjectId, data: BranchPayload, userId: mongoose.Types.ObjectId) {
  await AuditLog.create({
    action: data.status === "ACTIVE" ? "BRANCH_CREATED" : "BRANCH_DRAFT_CREATED",
    entityType: "BRANCH",
    entityId: branchId,
    performedBy: userId,
    performedAt: new Date(),
    metadata: {
      branchName: data.name,
      branchCode: data.code,
      status: data.status
    }
  });
}

async function createBranchUpdateAuditLog(branchId: mongoose.Types.ObjectId, data: BranchPayload, userId: mongoose.Types.ObjectId) {
  await AuditLog.create({
    action: "BRANCH_UPDATED",
    entityType: "BRANCH",
    entityId: branchId,
    performedBy: userId,
    performedAt: new Date(),
    metadata: {
      branchName: data.name,
      branchCode: data.code,
      status: data.status
    }
  });
}

export async function validateBranchCode(request: Request, response: Response): Promise<Response> {
  const code = typeof request.query.code === "string" ? request.query.code.trim().toUpperCase() : "";
  const parsed = branchCodeSchema.safeParse(code);

  if (!parsed.success) {
    return response.status(200).json({ success: true, exists: false, valid: false });
  }

  const excludeBranchId = typeof request.query.excludeBranchId === "string" ? request.query.excludeBranchId : "";
  const filters: Record<string, unknown> = { code: parsed.data };

  if (excludeBranchId && mongoose.Types.ObjectId.isValid(excludeBranchId)) {
    filters._id = { $ne: new mongoose.Types.ObjectId(excludeBranchId) };
  }

  const exists = await Branch.exists(filters);
  return response.status(200).json({ success: true, exists: Boolean(exists), valid: true });
}

export async function listBranches(request: Request, response: Response): Promise<Response> {
  const { search, status } = request.query;
  const filters: Record<string, unknown> = {};

  if (typeof status === "string" && status) filters.status = status;
  if (typeof search === "string" && search.trim()) {
    const pattern = new RegExp(search.trim(), "i");
    filters.$or = [{ name: pattern }, { code: pattern }, { "address.city": pattern }, { "contact.email": pattern }];
  }

  const branches = await Branch.find(filters).sort({ createdAt: -1 }).lean().exec();
  return response.status(200).json({ success: true, branches });
}

export async function createBranch(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = branchPayloadSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, errors: parsed.error.format() });

  const activeValidationError = parsed.data.status === "ACTIVE" ? getActiveBranchValidationError(parsed.data) : null;
  if (activeValidationError) return response.status(400).json({ success: false, message: activeValidationError });

  const duplicate = await Branch.exists({ code: parsed.data.code });
  if (duplicate) return response.status(409).json({ success: false, message: "Branch code already exists" });

  const branch = await Branch.create(normalizeBranchPayload(parsed.data, userId));
  await createBranchAuditLog(branch._id as mongoose.Types.ObjectId, parsed.data, userId);

  return response.status(201).json({ success: true, branch });
}

export async function updateBranch(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const branchId = typeof request.params.branchId === "string" ? request.params.branchId : "";
  if (!branchId || !mongoose.Types.ObjectId.isValid(branchId)) {
    return response.status(404).json({ success: false, message: "Branch not found" });
  }

  const parsed = branchPayloadSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, errors: parsed.error.format() });

  const activeValidationError = parsed.data.status === "ACTIVE" ? getActiveBranchValidationError(parsed.data) : null;
  if (activeValidationError) return response.status(400).json({ success: false, message: activeValidationError });

  const duplicate = await Branch.exists({
    code: parsed.data.code,
    _id: { $ne: new mongoose.Types.ObjectId(branchId) }
  });
  if (duplicate) return response.status(409).json({ success: false, message: "Branch code already exists" });

  const branch = await Branch.findByIdAndUpdate(
    branchId,
    normalizeBranchPayload(parsed.data, userId, "update"),
    { new: true, runValidators: true }
  ).exec();
  if (!branch) return response.status(404).json({ success: false, message: "Branch not found" });

  await createBranchUpdateAuditLog(branch._id as mongoose.Types.ObjectId, parsed.data, userId);

  return response.status(200).json({ success: true, branch });
}

export async function getBranch(request: Request, response: Response): Promise<Response> {
  const branchId = typeof request.params.branchId === "string" ? request.params.branchId : "";

  if (!branchId || !mongoose.Types.ObjectId.isValid(branchId)) {
    return response.status(404).json({ success: false, message: "Branch not found" });
  }

  const branch = await Branch.findById(branchId).populate("createdBy", "email name").lean().exec();
  if (!branch) return response.status(404).json({ success: false, message: "Branch not found" });

  return response.status(200).json({ success: true, branch });
}
