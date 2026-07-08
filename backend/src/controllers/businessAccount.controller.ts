import type { Request, Response } from "express";
import path from "path";
import mongoose from "mongoose";
import { z } from "zod";
import {
  BusinessAccount,
  businessAccountStatuses,
  businessKycCheckStatuses,
  BusinessKycCheckKey,
  BusinessKycCheckStatus,
  BusinessKycOverallStatus,
  BusinessAccountStatus,
  DocumentType,
  IBusinessDocument,
  IBusinessKycReview,
  ShipmentType
} from "../models/businessAccount.model.js";

const shipmentTypeSchema = z.enum(["domestic", "international"]);
const documentTypeSchema = z.enum(["gstCertificate", "panCard", "iecCertificate"]);
const businessAccountStatusSchema = z.enum(businessAccountStatuses);
const businessKycCheckKeySchema = z.enum(["contactDetails", "companyDetails", "gstCertificate", "panCard", "iecCertificate"]);
const businessKycCheckStatusSchema = z.enum(businessKycCheckStatuses);

const businessAccountBodySchema = z.object({
  contact: z.object({
    firstName: z.string().trim().min(2).max(80),
    lastName: z.string().trim().min(1).max(80),
    email: z.string().trim().email().toLowerCase(),
    countryCode: z.string().trim().min(1).max(8),
    mobileNumber: z.string().trim().regex(/^\d{6,15}$/, "Mobile number must contain 6 to 15 digits"),
    department: z.string().trim().min(1).max(80),
    shipmentTypes: z.array(shipmentTypeSchema).min(1)
  }),
  company: z.object({
    registrationCountry: z.string().trim().min(1).max(80),
    registrationId: z.string().trim().regex(/^[a-zA-Z0-9-_/ ]{2,50}$/, "Registration ID must contain valid letters and numbers"),
    companyName: z.string().trim().min(2).max(160),
    registeredAddress: z.string().trim().min(5).max(500),
    city: z.string().trim().min(1).max(80),
    stateOrProvince: z.string().trim().min(1).max(80),
    postalCode: z.string().trim().min(3).max(20),
    operatingCountries: z.array(z.string().trim().min(1).max(80)).min(1),
    website: z.string().trim().url().optional().or(z.literal("")).or(z.null()),
    industry: z.string().trim().min(1).max(100),
    monthlyShipmentVolume: z.string().trim().min(1).max(80),
    requestedCreditCurrency: z.string().trim().min(3).max(3).default("INR"),
    requestedCreditLimit: z.coerce.number().nonnegative().optional().nullable()
  })
});

type BusinessAccountBody = z.infer<typeof businessAccountBodySchema>;

const businessKycReviewBodySchema = z.object({
  checks: z.partialRecord(
    businessKycCheckKeySchema,
    z.object({
      status: businessKycCheckStatusSchema,
      note: z.string().trim().max(50).optional().nullable()
    })
  ).optional(),
  finalDecision: z.enum(["rejected"]).nullable().optional(),
  startReview: z.boolean().optional()
}).superRefine((data, context) => {
  for (const [key, check] of Object.entries(data.checks ?? {}) as [BusinessKycCheckKey, { status: BusinessKycCheckStatus; note?: string | null }][]) {
    if (check.status === "information_required" && !check.note?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["checks", key, "note"],
        message: "Reason is required and must be 50 characters or less"
      });
    }

  }
});

type BusinessKycReviewBody = z.infer<typeof businessKycReviewBodySchema>;

const statusActionMessages: Record<BusinessAccountStatus, string> = {
  draft: "Business account moved to draft.",
  pending_review: "Business account submitted for review.",
  approved: "Business account approved.",
  rejected: "Business account rejected.",
  more_info_needed: "Business account marked as needing more information.",
  credit_limit_approved: "Credit limit approved.",
  credit_limit_not_approved: "Credit limit not approved.",
  deposit_required: "Deposit required.",
  deposit_received: "Deposit received.",
  active: "Business account activated.",
  suspended: "Business account suspended.",
  branch_assigned: "Branch assignment marked.",
  agreement_generated: "Agreement generation marked.",
  ledger_viewed: "Ledger review marked."
};

function getAuthenticatedUserId(request: Request): mongoose.Types.ObjectId | null {
  const user = (request as Request & { user?: { _id?: unknown } }).user;
  const id = user?._id;

  if (!id || !mongoose.Types.ObjectId.isValid(String(id))) {
    return null;
  }

  return new mongoose.Types.ObjectId(String(id));
}

function parseJsonField(value: unknown): unknown {
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseBusinessAccountBody(request: Request) {
  const body = request.body as Record<string, unknown>;

  return businessAccountBodySchema.safeParse({
    contact: parseJsonField(body.contact),
    company: parseJsonField(body.company)
  });
}

function getUploadedFiles(request: Request): Partial<Record<DocumentType, Express.Multer.File>> {
  const files = request.files as Partial<Record<DocumentType, Express.Multer.File[]>> | undefined;

  return {
    gstCertificate: files?.gstCertificate?.[0],
    panCard: files?.panCard?.[0],
    iecCertificate: files?.iecCertificate?.[0]
  };
}

function toBusinessDocument(type: DocumentType, file: Express.Multer.File): IBusinessDocument {
  return {
    type,
    originalName: file.originalname,
    storedName: file.filename,
    mimeType: file.mimetype,
    size: file.size,
    path: file.path,
    uploadedAt: new Date()
  };
}

function buildAccountPayload(data: BusinessAccountBody) {
  return {
    contact: data.contact,
    company: {
      registrationCountry: data.company.registrationCountry,
      registrationId: data.company.registrationId,
      companyName: data.company.companyName,
      registeredAddress: data.company.registeredAddress,
      city: data.company.city,
      stateOrProvince: data.company.stateOrProvince,
      postalCode: data.company.postalCode,
      operatingCountries: data.company.operatingCountries,
      website: data.company.website || null,
      industry: data.company.industry,
      monthlyShipmentVolume: data.company.monthlyShipmentVolume,
      requestedCreditLimit: {
        currency: data.company.requestedCreditCurrency,
        amount: data.company.requestedCreditLimit ?? null
      }
    }
  };
}

async function generateAccountId(): Promise<string> {
  const year = new Date().getFullYear();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const sequence = Math.floor(100000 + Math.random() * 900000);
    const accountId = `BA-${year}-${sequence}`;
    const existing = await BusinessAccount.exists({ accountId });

    if (!existing) return accountId;
  }

  throw new Error("Unable to generate a unique business account ID");
}

async function hasDuplicateBusinessIdentity(
  data: BusinessAccountBody,
  accountIdToExclude?: string
): Promise<string | null> {
  const duplicate = await BusinessAccount.findOne({
    _id: accountIdToExclude ? { $ne: accountIdToExclude } : { $exists: true },
    $or: [
      { "contact.email": data.contact.email },
      { "contact.mobileNumber": data.contact.mobileNumber },
      { "company.registrationId": data.company.registrationId }
    ]
  })
    .select("contact.email contact.mobileNumber company.registrationId")
    .lean()
    .exec();

  if (!duplicate) return null;

  if (duplicate.contact.email === data.contact.email) return "Email address already exists";
  if (duplicate.contact.mobileNumber === data.contact.mobileNumber) return "Mobile number already exists";
  return "Company registration ID already exists";
}

function getDocumentRequirementError(
  shipmentTypes: ShipmentType[],
  documents: Partial<Record<DocumentType, IBusinessDocument>>
): string | null {
  if (!documents.gstCertificate) return "GST Certificate is required";
  if (!documents.panCard) return "PAN Card Copy is required";

  // IEC is a trade-compliance document, so domestic-only accounts must not be blocked by it.
  if (shipmentTypes.includes("international") && !documents.iecCertificate) {
    return "IEC Certificate is required for international shipment accounts";
  }

  return null;
}

function getRequiredKycCheckKeys(
  shipmentTypes: ShipmentType[],
  documents: Partial<Record<DocumentType, IBusinessDocument>>
): BusinessKycCheckKey[] {
  const keys: BusinessKycCheckKey[] = ["contactDetails", "companyDetails", "gstCertificate", "panCard"];

  if (shipmentTypes.includes("international") || documents.iecCertificate) {
    keys.push("iecCertificate");
  }

  return keys;
}

function getMissingRequiredDocuments(
  shipmentTypes: ShipmentType[],
  documents: Partial<Record<DocumentType, IBusinessDocument>>
) {
  const missing: DocumentType[] = [];

  if (!documents.gstCertificate) missing.push("gstCertificate");
  if (!documents.panCard) missing.push("panCard");
  if (shipmentTypes.includes("international") && !documents.iecCertificate) missing.push("iecCertificate");

  return missing;
}

function getDefaultKycReview(): IBusinessKycReview {
  return {
    overallStatus: "documents_pending",
    checks: {},
    finalDecision: null,
    reviewStartedAt: null,
    reviewedAt: null,
    reviewedBy: null
  };
}

function deriveKycOverallStatus(
  shipmentTypes: ShipmentType[],
  documents: Partial<Record<DocumentType, IBusinessDocument>>,
  review: IBusinessKycReview
): BusinessKycOverallStatus {
  const missingDocuments = getMissingRequiredDocuments(shipmentTypes, documents);
  if (missingDocuments.length) return "documents_pending";
  if (review.finalDecision === "rejected") return "rejected";

  const requiredKeys = getRequiredKycCheckKeys(shipmentTypes, documents);
  const statuses = requiredKeys.map((key) => review.checks?.[key]?.status ?? "not_started");
  const infoRequiredStatuses: BusinessKycCheckStatus[] = ["information_required"];

  if (statuses.some((status) => status === "reject")) {
    return "rejected";
  }

  if (statuses.some((status) => infoRequiredStatuses.includes(status))) {
    return "additional_information_required";
  }

  if (statuses.every((status) => status === "verified")) {
    return "verified";
  }

  if (!review.reviewStartedAt && statuses.every((status) => status === "not_started")) {
    return "submitted";
  }

  return "under_review";
}

function normalizeKycCheckStatus(status: string): BusinessKycCheckStatus {
  if (status === "failed") return "reject";
  if (status === "replacement_required" || status === "mismatched" || status === "unclear") return "information_required";
  if (businessKycCheckStatuses.includes(status as BusinessKycCheckStatus)) {
    return status as BusinessKycCheckStatus;
  }

  return "not_started";
}

function getSanitizedKycReview(currentReview?: IBusinessKycReview): IBusinessKycReview {
  const review: IBusinessKycReview = {
    ...getDefaultKycReview(),
    finalDecision: currentReview?.finalDecision ?? null,
    reviewStartedAt: currentReview?.reviewStartedAt ?? null,
    reviewedAt: currentReview?.reviewedAt ?? null,
    reviewedBy: currentReview?.reviewedBy ?? null,
    checks: {}
  };

  for (const [key, check] of Object.entries(currentReview?.checks ?? {}) as [BusinessKycCheckKey, { status?: string; note?: string | null; reviewedAt?: Date | null } | null | undefined][]) {
    if (!businessKycCheckKeySchema.safeParse(key).success || !check) continue;

    review.checks[key] = {
      status: normalizeKycCheckStatus(check.status ?? "not_started"),
      note: check.note ? check.note.slice(0, 50) : null,
      reviewedAt: check.reviewedAt ?? null
    };
  }

  return review;
}

function applyKycReviewUpdate(
  currentReview: IBusinessKycReview | undefined,
  data: BusinessKycReviewBody,
  userId: mongoose.Types.ObjectId
) {
  const now = new Date();
  const nextReview = getSanitizedKycReview(currentReview);

  if (data.startReview && !nextReview.reviewStartedAt) {
    nextReview.reviewStartedAt = now;
  }

  let hasNonRejectCheckUpdate = false;

  for (const [key, check] of Object.entries(data.checks ?? {}) as [BusinessKycCheckKey, { status: BusinessKycCheckStatus; note?: string | null }][]) {
    if (check.status !== "not_started" && !nextReview.reviewStartedAt) {
      nextReview.reviewStartedAt = now;
    }

    if (check.status !== "reject") {
      hasNonRejectCheckUpdate = true;
    }

    nextReview.checks[key] = {
      status: check.status,
      note: check.note || null,
      reviewedAt: check.status === "not_started" ? null : now
    };
  }

  if ("finalDecision" in data) {
    nextReview.finalDecision = data.finalDecision ?? null;
    if (data.finalDecision === "rejected" && !nextReview.reviewStartedAt) {
      nextReview.reviewStartedAt = now;
    }
  } else if (hasNonRejectCheckUpdate) {
    nextReview.finalDecision = null;
  }

  nextReview.reviewedBy = userId;
  return nextReview;
}

function applyDerivedKycStatus(account: { contact: { shipmentTypes: ShipmentType[] }; documents?: Partial<Record<DocumentType, IBusinessDocument>>; kycReview?: IBusinessKycReview }) {
  const review = getSanitizedKycReview(account.kycReview);

  review.overallStatus = deriveKycOverallStatus(account.contact.shipmentTypes, account.documents ?? {}, review);
  review.reviewedAt = ["verified", "rejected"].includes(review.overallStatus) ? new Date() : null;

  return review;
}

function attachUploadedDocuments(
  documents: Partial<Record<DocumentType, IBusinessDocument>>,
  files: Partial<Record<DocumentType, Express.Multer.File>>
) {
  for (const type of ["gstCertificate", "panCard", "iecCertificate"] as DocumentType[]) {
    const file = files[type];
    if (file) documents[type] = toBusinessDocument(type, file);
  }
}

export async function validateBusinessAccountUniqueness(request: Request, response: Response): Promise<Response> {
  const email = typeof request.query.email === "string" ? request.query.email.trim().toLowerCase() : "";
  const mobileNumber = typeof request.query.mobileNumber === "string" ? request.query.mobileNumber.trim() : "";
  const registrationId = typeof request.query.registrationId === "string" ? request.query.registrationId.trim() : "";
  const excludeAccountId = typeof request.query.excludeAccountId === "string" ? request.query.excludeAccountId.trim() : "";

  const checks: Record<string, boolean> = {
    email: false,
    mobileNumber: false,
    registrationId: false
  };

  const baseFilter = excludeAccountId ? { accountId: { $ne: excludeAccountId } } : {};

  const [emailMatch, mobileMatch, registrationMatch] = await Promise.all([
    email ? BusinessAccount.exists({ ...baseFilter, "contact.email": email }) : null,
    mobileNumber ? BusinessAccount.exists({ ...baseFilter, "contact.mobileNumber": mobileNumber }) : null,
    registrationId ? BusinessAccount.exists({ ...baseFilter, "company.registrationId": registrationId }) : null
  ]);

  checks.email = Boolean(emailMatch);
  checks.mobileNumber = Boolean(mobileMatch);
  checks.registrationId = Boolean(registrationMatch);

  return response.status(200).json({ success: true, conflicts: checks });
}

export async function listBusinessAccounts(request: Request, response: Response): Promise<Response> {
  const { status, search } = request.query;
  const filters: Record<string, unknown> = {};

  if (typeof status === "string" && status) {
    filters.status = status;
  }

  if (typeof search === "string" && search.trim()) {
    const pattern = new RegExp(search.trim(), "i");
    filters.$or = [
      { accountId: pattern },
      { "company.companyName": pattern },
      { "contact.firstName": pattern },
      { "contact.lastName": pattern },
      { "contact.email": pattern },
      { "contact.mobileNumber": pattern },
      { "company.registrationId": pattern }
    ];
  }

  const accounts = await BusinessAccount.find(filters)
    .populate("createdBy", "email name")
    .sort({ createdAt: -1 })
    .lean()
    .exec();

  return response.status(200).json({ success: true, accounts });
}

export async function createBusinessAccount(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = parseBusinessAccountBody(request);
  if (!parsed.success) {
    return response.status(400).json({ success: false, errors: parsed.error.format() });
  }

  const duplicateMessage = await hasDuplicateBusinessIdentity(parsed.data);
  if (duplicateMessage) return response.status(409).json({ success: false, message: duplicateMessage });

  const files = getUploadedFiles(request);
  const documents: Partial<Record<DocumentType, IBusinessDocument>> = {};
  attachUploadedDocuments(documents, files);

  const account = await BusinessAccount.create({
    accountId: await generateAccountId(),
    status: "draft",
    ...buildAccountPayload(parsed.data),
    documents,
    createdBy: userId,
    updatedBy: userId
  });

  return response.status(201).json({ success: true, account });
}

export async function getBusinessAccount(request: Request, response: Response): Promise<Response> {
  const account = await BusinessAccount.findOne({ accountId: request.params.accountId })
    .populate("createdBy", "email name")
    .lean()
    .exec();

  if (!account) return response.status(404).json({ success: false, message: "Business account not found" });

  return response.status(200).json({ success: true, account });
}

export async function updateBusinessAccount(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const account = await BusinessAccount.findOne({ accountId: request.params.accountId }).exec();
  if (!account) return response.status(404).json({ success: false, message: "Business account not found" });

  const parsed = parseBusinessAccountBody(request);
  if (!parsed.success) {
    return response.status(400).json({ success: false, errors: parsed.error.format() });
  }

  const duplicateMessage = await hasDuplicateBusinessIdentity(parsed.data, String(account._id));
  if (duplicateMessage) return response.status(409).json({ success: false, message: duplicateMessage });

  const files = getUploadedFiles(request);
  const documents = account.documents ?? {};
  attachUploadedDocuments(documents, files);

  account.set({
    ...buildAccountPayload(parsed.data),
    documents,
    updatedBy: userId
  });
  account.kycReview = applyDerivedKycStatus(account);

  await account.save();

  return response.status(200).json({ success: true, account });
}

export async function submitBusinessAccount(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const account = await BusinessAccount.findOne({ accountId: request.params.accountId }).exec();
  if (!account) return response.status(404).json({ success: false, message: "Business account not found" });
  if (account.status !== "draft") {
    return response.status(409).json({ success: false, message: "Only draft accounts can be submitted" });
  }

  const requirementError = getDocumentRequirementError(account.contact.shipmentTypes, account.documents ?? {});
  if (requirementError) {
    return response.status(400).json({ success: false, message: requirementError });
  }

  account.status = "pending_review";
  account.submittedAt = new Date();
  account.updatedBy = userId;
  account.kycReview = applyDerivedKycStatus(account);
  await account.save();

  return response.status(200).json({
    success: true,
    message: "Business account created successfully and submitted for review.",
    account
  });
}

export async function updateBusinessAccountStatus(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = businessAccountStatusSchema.safeParse((request.body as { status?: unknown }).status);
  if (!parsed.success) {
    return response.status(400).json({ success: false, message: "Invalid business account status" });
  }

  const account = await BusinessAccount.findOne({ accountId: request.params.accountId }).exec();
  if (!account) return response.status(404).json({ success: false, message: "Business account not found" });

  if (parsed.data === "pending_review" && !account.submittedAt) {
    const requirementError = getDocumentRequirementError(account.contact.shipmentTypes, account.documents ?? {});
    if (requirementError) {
      return response.status(400).json({ success: false, message: requirementError });
    }

    account.submittedAt = new Date();
  }

  account.status = parsed.data;
  account.updatedBy = userId;
  account.kycReview = applyDerivedKycStatus(account);
  await account.save();

  return response.status(200).json({
    success: true,
    message: statusActionMessages[parsed.data],
    account
  });
}

export async function viewBusinessAccountDocument(request: Request, response: Response): Promise<void | Response> {
  const parsed = documentTypeSchema.safeParse(request.params.documentType);
  if (!parsed.success) {
    return response.status(400).json({ success: false, message: "Invalid document type" });
  }

  const account = await BusinessAccount.findOne({ accountId: request.params.accountId }).lean().exec();
  if (!account) return response.status(404).json({ success: false, message: "Business account not found" });

  const document = account.documents?.[parsed.data];
  if (!document) return response.status(404).json({ success: false, message: "Document not found" });

  const absolutePath = path.resolve(document.path);
  response.setHeader("Content-Type", document.mimeType);
  response.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(document.originalName)}"`);

  return response.sendFile(absolutePath);
}

export async function updateBusinessAccountKycReview(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = businessKycReviewBodySchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ success: false, errors: parsed.error.format() });
  }

  const account = await BusinessAccount.findOne({ accountId: request.params.accountId }).exec();
  if (!account) return response.status(404).json({ success: false, message: "Business account not found" });

  try {
    const nextReview = applyKycReviewUpdate(account.kycReview, parsed.data, userId);
    nextReview.overallStatus = deriveKycOverallStatus(account.contact.shipmentTypes, account.documents ?? {}, nextReview);
    nextReview.reviewedAt = ["verified", "rejected"].includes(nextReview.overallStatus) ? new Date() : null;

    account.kycReview = nextReview;
    account.updatedBy = userId;
    await account.save();
  } catch (error) {
    console.error("KYC review update failed:", error);
    return response.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : "Unable to update KYC review"
    });
  }

  return response.status(200).json({
    success: true,
    account,
    kycReview: account.kycReview
  });
}
