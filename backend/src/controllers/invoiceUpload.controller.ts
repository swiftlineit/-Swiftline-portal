import crypto from "crypto";
import fs from "fs";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { env } from "../config/env.js";
import { AuditLog } from "../models/auditLog.model.js";
import { Branch } from "../models/branch.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { InvoiceUpload } from "../models/invoiceUpload.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import {
  CustomsInvoiceParseError,
  parseCustomsInvoiceWorkbook,
  type ParsedCustomsInvoice
} from "../services/customsInvoice/customsInvoiceParser.service.js";
import { buildCustomsInvoiceTemplateWorkbook } from "../services/customsInvoice/customsInvoice.service.js";
import { shipmentDataTemplateVersion } from "../services/customsInvoice/customsInvoiceSheet.js";
import { resolveDraftBookingState } from "../services/shipmentDraftPolicy.service.js";

const uploadPayloadSchema = z.object({
  businessAccountId: z.string().trim().min(1),
  branchId: z.string().trim().min(1)
});

function getAuthenticatedUserId(request: Request): mongoose.Types.ObjectId | null {
  const user = (request as Request & { user?: { _id?: unknown } }).user;
  const id = user?._id;

  return id && mongoose.Types.ObjectId.isValid(String(id))
    ? new mongoose.Types.ObjectId(String(id))
    : null;
}

function getFileChecksum(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

async function resolveBusinessAccount(value: string) {
  if (mongoose.Types.ObjectId.isValid(value)) {
    const account = await BusinessAccount.findById(value).lean().exec();
    if (account) return account;
  }

  return BusinessAccount.findOne({ accountId: value }).lean().exec();
}

async function resolveBranch(value: string) {
  if (mongoose.Types.ObjectId.isValid(value)) {
    const branch = await Branch.findById(value).lean().exec();
    if (branch) return branch;
  }

  return Branch.findOne({ code: value.toUpperCase() }).lean().exec();
}

function serializeInvoiceUpload(upload: {
  _id: unknown;
  businessAccountId: unknown;
  branchId: unknown;
  templateVersion?: string;
  invoiceNumber?: string;
  shipmentReference?: string;
  originalFilename: string;
  fileChecksum: string;
  extractedData?: Record<string, unknown>;
  status: string;
  processingErrors?: string[];
  uploadedBy: unknown;
  uploadedAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: upload._id,
    businessAccountId: upload.businessAccountId,
    branchId: upload.branchId,
    templateVersion: upload.templateVersion ?? "",
    invoiceNumber: upload.invoiceNumber ?? "",
    shipmentReference: upload.shipmentReference ?? "",
    originalFilename: upload.originalFilename,
    fileChecksum: upload.fileChecksum,
    extractedData: upload.extractedData ?? {},
    status: upload.status,
    processingErrors: upload.processingErrors ?? [],
    uploadedBy: upload.uploadedBy,
    uploadedAt: upload.uploadedAt,
    createdAt: upload.createdAt,
    updatedAt: upload.updatedAt
  };
}

async function writeInvoiceAuditLog(
  action: "INVOICE_UPLOADED" | "INVOICE_PARSED" | "INVOICE_EXTRACTION_FAILED",
  invoiceUploadId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
  metadata: Record<string, unknown>
) {
  await AuditLog.create({
    action,
    entityType: "INVOICE_UPLOAD",
    entityId: invoiceUploadId,
    performedBy: userId,
    performedAt: new Date(),
    metadata
  });
}

function getSenderSnapshot(branch: Awaited<ReturnType<typeof resolveBranch>>) {
  return {
    branchId: branch?._id,
    name: branch?.name ?? "",
    code: branch?.code ?? "",
    address: branch?.address ?? {},
    contact: branch?.contact ?? {}
  };
}

function getDefaultServiceCode() {
  return env.DPD_DEFAULT_SERVICE_CODE;
}

async function createOrUpdateShipmentDraft(
  invoiceUploadId: mongoose.Types.ObjectId,
  businessAccountId: mongoose.Types.ObjectId,
  branchId: mongoose.Types.ObjectId,
  branch: Awaited<ReturnType<typeof resolveBranch>>,
  parsedInvoice: ParsedCustomsInvoice,
  userId: mongoose.Types.ObjectId
): Promise<InstanceType<typeof ShipmentDraft>> {
  // Deleted drafts are skipped so re-uploading a discarded invoice starts a new
  // draft rather than reviving the one the user threw away.
  const existingDraft = await ShipmentDraft.findOne({ invoiceUploadId, deletedAt: null }).exec();
  if (existingDraft && await resolveDraftBookingState(existingDraft) !== "EDITABLE") {
    return existingDraft;
  }

  const serviceCode = getDefaultServiceCode();
  const consignor = parsedInvoice.consignor;
  const draftValues = {
      invoiceUploadId,
      businessAccountId,
      branchId,
      sender: getSenderSnapshot(branch),
      // Sender details come from the workbook's import sheet. The Aadhaar CARD
      // itself is never in a spreadsheet, so KYC uploads stay manual.
      consignorAddress: {
        companyName: consignor.companyName,
        contactName: consignor.contactName,
        email: consignor.email,
        mobileNumber: consignor.mobileNumber,
        aadhaarNumber: consignor.aadhaarNumber,
        postcode: consignor.postcode,
        addressLine1: consignor.addressLine1,
        addressLine2: consignor.addressLine2,
        townOrCity: consignor.townOrCity,
        county: consignor.county
      },
      consigneeEnteredAddress: {
        companyName: parsedInvoice.consignee.companyName,
        contactName: parsedInvoice.consignee.contactName,
        email: parsedInvoice.consignee.email,
        mobileCountryCode: parsedInvoice.consignee.mobileCountryCode,
        mobileNumber: parsedInvoice.consignee.mobileNumber,
        countryCode: parsedInvoice.consignee.countryCode,
        countryName: parsedInvoice.consignee.countryName,
        postcode: parsedInvoice.consignee.postcode,
        addressLine1: parsedInvoice.consignee.addressLine1,
        addressLine2: parsedInvoice.consignee.addressLine2,
        townOrCity: parsedInvoice.consignee.townOrCity,
        county: parsedInvoice.consignee.county,
        deliveryInstructions: ""
      },
      consigneeSelectedAddress: null,
      consigneeValidatedAddress: null,
      googlePlaceId: "",
      addressValidationStatus: "NOT_VALIDATED" as const,
      addressValidationResult: {},
      // Parcel rows are the source of truth; PCS is stored as a quick summary for list/review screens.
      parcelCount: parsedInvoice.parcels.length,
      parcelList: parsedInvoice.parcels.map((parcel) => ({
        sequence: parcel.sequence,
        weightKg: parcel.weightKg,
        lengthCm: parcel.lengthCm ?? undefined,
        widthCm: parcel.widthCm ?? undefined,
        heightCm: parcel.heightCm ?? undefined,
        shipmentContentType: "PARCEL" as const,
        // contentsDescription is recomposed from these by the model's hook.
        items: parcel.items,
        contentsDescription: "",
        // Genuinely optional on the form, so it stays blank when the invoice
        // carries no customer reference.
        shipmentReference1: parsedInvoice.shipmentReference,
        shipmentReference2: ""
      })),
      // Both default safely when the import sheet is absent: CSB-IV carries no
      // clearance charge, so a missing value can never silently overcharge.
      csbType: parsedInvoice.csbType ?? "CSB_IV",
      serviceType: parsedInvoice.serviceType ?? "COURIER",
      declarationNote: parsedInvoice.declarationNote,
      serviceCode,
      validationIssues: [] as string[],
      status: "NEEDS_REVIEW" as const,
      bookingState: "EDITABLE" as const,
      bookingAttemptId: "",
      lockedAt: null,
      createdBy: userId
  };

  if (existingDraft) {
    existingDraft.set(draftValues);
    return existingDraft.save();
  }

  return ShipmentDraft.create(draftValues);
}

async function getInvoiceDraftState(invoiceUploadId: mongoose.Types.ObjectId) {
  const shipmentDraft = await ShipmentDraft.findOne({ invoiceUploadId, deletedAt: null }).exec();
  if (!shipmentDraft) {
    return { shipmentDraft: null, bookingState: "EDITABLE" as const, locked: false };
  }

  const bookingState = await resolveDraftBookingState(shipmentDraft);
  if (shipmentDraft.bookingState !== bookingState) {
    shipmentDraft.bookingState = bookingState;
    if (bookingState !== "EDITABLE" && !shipmentDraft.lockedAt) shipmentDraft.lockedAt = new Date();
    await shipmentDraft.save();
  }

  return {
    shipmentDraft,
    bookingState,
    locked: bookingState !== "EDITABLE"
  };
}

function getLockedInvoiceMessage(bookingState: string) {
  if (bookingState === "BOOKING") return "This invoice is currently being booked. Please wait for the booking result.";
  if (bookingState === "REVIEW_REQUIRED") {
    return "This invoice is awaiting booking reconciliation. Contact Swiftline Operations before trying again.";
  }
  return "This invoice is already linked to a booked shipment.";
}

async function findExistingParsedInvoice(params: {
  businessAccountId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  invoiceNumber: string;
  shipmentReference: string;
  excludeUploadId?: mongoose.Types.ObjectId;
}) {
  if (!params.invoiceNumber || !params.shipmentReference) return null;

  const query: Record<string, unknown> = {
    businessAccountId: params.businessAccountId,
    branchId: params.branchId,
    invoiceNumber: params.invoiceNumber,
    shipmentReference: params.shipmentReference
  };

  if (params.excludeUploadId) {
    query._id = { $ne: params.excludeUploadId };
  }

  return InvoiceUpload.findOne(query).lean().exec();
}

async function refreshDuplicateInvoiceDraft(
  invoiceUpload: Awaited<ReturnType<typeof InvoiceUpload.findOne>>,
  businessAccount: Awaited<ReturnType<typeof resolveBusinessAccount>>,
  branch: Awaited<ReturnType<typeof resolveBranch>>,
  userId: mongoose.Types.ObjectId
) {
  const current = invoiceUpload
    ? await getInvoiceDraftState(invoiceUpload._id as mongoose.Types.ObjectId)
    : null;
  if (current?.locked) return current.shipmentDraft;

  if (!invoiceUpload || !businessAccount || !branch || !fs.existsSync(invoiceUpload.storagePath)) {
    return ShipmentDraft.findOne({ invoiceUploadId: invoiceUpload?._id, deletedAt: null }).exec();
  }

  const parsedInvoice = await parseCustomsInvoiceWorkbook(invoiceUpload.storagePath);
  invoiceUpload.set({
    templateVersion: shipmentDataTemplateVersion,
    invoiceNumber: parsedInvoice.invoiceNumber,
    // The customer's own REFERENCE line is optional, but booking requires a
    // shipment reference, so the invoice number stands in when none is given.
    shipmentReference: parsedInvoice.shipmentReference?.trim() || parsedInvoice.invoiceNumber,
    extractedData: parsedInvoice,
    status: "PARSED",
    processingErrors: []
  });
  await invoiceUpload.save();

  return createOrUpdateShipmentDraft(
    invoiceUpload._id as mongoose.Types.ObjectId,
    invoiceUpload.businessAccountId,
    invoiceUpload.branchId,
    branch,
    parsedInvoice,
    userId
  );
}

export async function downloadDpdInvoiceTemplate(_request: Request, response: Response): Promise<Response> {
  const buffer = await buildCustomsInvoiceTemplateWorkbook();

  response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  response.setHeader("Content-Disposition", "attachment; filename=\"swiftline-shipment-invoice-template.xlsx\"");

  return response.status(200).send(buffer);
}

export async function createInvoiceUpload(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const file = request.file;
  if (!file) return response.status(400).json({ success: false, message: "Invoice file is required" });

  const parsed = uploadPayloadSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, errors: parsed.error.format() });

  const [businessAccount, branch] = await Promise.all([
    resolveBusinessAccount(parsed.data.businessAccountId),
    resolveBranch(parsed.data.branchId)
  ]);

  if (!businessAccount) return response.status(404).json({ success: false, message: "Business account not found" });
  if (!branch) return response.status(404).json({ success: false, message: "Branch not found" });

  const fileChecksum = getFileChecksum(file.path);
  const existingUpload = await InvoiceUpload.findOne({
    businessAccountId: businessAccount._id,
    branchId: branch._id,
    fileChecksum
  }).exec();

  if (existingUpload) {
    void fs.promises.unlink(file.path).catch(() => undefined);

    const current = await getInvoiceDraftState(existingUpload._id as mongoose.Types.ObjectId);
    if (current.locked) {
      return response.status(200).json({
        success: true,
        duplicate: true,
        alreadyBooked: current.bookingState === "BOOKED",
        bookingState: current.bookingState,
        message: getLockedInvoiceMessage(current.bookingState),
        invoiceUpload: serializeInvoiceUpload(existingUpload),
        shipmentDraft: current.shipmentDraft
      });
    }

    let shipmentDraft = current.shipmentDraft;

    try {
      shipmentDraft = await refreshDuplicateInvoiceDraft(existingUpload, businessAccount, branch, userId);
    } catch {
      shipmentDraft = await ShipmentDraft.findOne({ invoiceUploadId: existingUpload._id, deletedAt: null }).exec();
    }

    return response.status(200).json({
      success: true,
      duplicate: true,
      alreadyBooked: false,
      bookingState: "EDITABLE",
      message: "This invoice file has already been uploaded.",
      invoiceUpload: serializeInvoiceUpload(existingUpload),
      shipmentDraft
    });
  }

  const invoiceUpload = await InvoiceUpload.create({
    businessAccountId: businessAccount._id,
    branchId: branch._id,
    originalFilename: file.originalname,
    storagePath: file.path,
    fileChecksum,
    status: "UPLOADED",
    processingErrors: [],
    uploadedBy: userId,
    uploadedAt: new Date()
  });

  await writeInvoiceAuditLog("INVOICE_UPLOADED", invoiceUpload._id as mongoose.Types.ObjectId, userId, {
    originalFilename: file.originalname,
    fileChecksum,
    businessAccountId: businessAccount._id,
    branchId: branch._id
  });

  return response.status(201).json({
    success: true,
    duplicate: false,
    invoiceUpload: serializeInvoiceUpload(invoiceUpload)
  });
}

export async function processInvoiceUpload(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const invoiceUploadId = typeof request.params.id === "string" ? request.params.id : "";
  if (!mongoose.Types.ObjectId.isValid(invoiceUploadId)) {
    return response.status(404).json({ success: false, message: "Invoice upload not found" });
  }

  const invoiceUpload = await InvoiceUpload.findById(invoiceUploadId).exec();
  if (!invoiceUpload) return response.status(404).json({ success: false, message: "Invoice upload not found" });

  const current = await getInvoiceDraftState(invoiceUpload._id as mongoose.Types.ObjectId);
  if (current.locked) {
    return response.status(200).json({
      success: true,
      duplicate: true,
      alreadyBooked: current.bookingState === "BOOKED",
      bookingState: current.bookingState,
      message: getLockedInvoiceMessage(current.bookingState),
      invoiceUpload: serializeInvoiceUpload(invoiceUpload),
      shipmentDraft: current.shipmentDraft
    });
  }

  const [businessAccount, branch] = await Promise.all([
    BusinessAccount.findById(invoiceUpload.businessAccountId).lean().exec(),
    Branch.findById(invoiceUpload.branchId).lean().exec()
  ]);

  if (!businessAccount) return response.status(404).json({ success: false, message: "Business account not found" });
  if (!branch) return response.status(404).json({ success: false, message: "Branch not found" });

  try {
    invoiceUpload.status = "PROCESSING";
    invoiceUpload.processingErrors = [];
    await invoiceUpload.save();

    const parsedInvoice = await parseCustomsInvoiceWorkbook(invoiceUpload.storagePath);
    const existingParsedUpload = await findExistingParsedInvoice({
      businessAccountId: invoiceUpload.businessAccountId,
      branchId: invoiceUpload.branchId,
      invoiceNumber: parsedInvoice.invoiceNumber,
      shipmentReference: parsedInvoice.shipmentReference,
      excludeUploadId: invoiceUpload._id as mongoose.Types.ObjectId
    });

    if (existingParsedUpload) {
      const existing = await getInvoiceDraftState(existingParsedUpload._id as mongoose.Types.ObjectId);

      invoiceUpload.set({
        status: "PARSING_FAILED",
        processingErrors: ["An invoice with this invoice number and shipment reference has already been processed."]
      });
      await invoiceUpload.save();

      await writeInvoiceAuditLog("INVOICE_EXTRACTION_FAILED", invoiceUpload._id as mongoose.Types.ObjectId, userId, {
        duplicateInvoiceUploadId: existingParsedUpload._id,
        invoiceNumber: parsedInvoice.invoiceNumber,
        shipmentReference: parsedInvoice.shipmentReference
      });

      return response.status(200).json({
        success: true,
        duplicate: true,
        alreadyBooked: existing.bookingState === "BOOKED",
        bookingState: existing.bookingState,
        message: "An invoice with this invoice number and shipment reference has already been processed.",
        invoiceUpload: serializeInvoiceUpload(existingParsedUpload),
        shipmentDraft: existing.shipmentDraft
      });
    }

    invoiceUpload.set({
      templateVersion: shipmentDataTemplateVersion,
      invoiceNumber: parsedInvoice.invoiceNumber,
      shipmentReference: parsedInvoice.shipmentReference,
      extractedData: parsedInvoice,
      status: "PARSED",
      processingErrors: []
    });
    await invoiceUpload.save();

    const shipmentDraft = await createOrUpdateShipmentDraft(
      invoiceUpload._id as mongoose.Types.ObjectId,
      invoiceUpload.businessAccountId,
      invoiceUpload.branchId,
      branch,
      parsedInvoice,
      userId
    );

    await writeInvoiceAuditLog("INVOICE_PARSED", invoiceUpload._id as mongoose.Types.ObjectId, userId, {
      invoiceNumber: parsedInvoice.invoiceNumber,
      shipmentReference: parsedInvoice.shipmentReference,
      shipmentDraftId: shipmentDraft?._id
    });

    return response.status(200).json({
      success: true,
      invoiceUpload: serializeInvoiceUpload(invoiceUpload),
      shipmentDraft
    });
  } catch (error) {
    const issues = error instanceof CustomsInvoiceParseError
      ? error.issues
      : [error instanceof Error ? error.message : "Invoice could not be parsed"];

    invoiceUpload.set({
      status: "PARSING_FAILED",
      processingErrors: issues
    });
    await invoiceUpload.save();

    await writeInvoiceAuditLog("INVOICE_EXTRACTION_FAILED", invoiceUpload._id as mongoose.Types.ObjectId, userId, {
      issues
    });

    return response.status(400).json({
      success: false,
      message: "Invoice could not be parsed",
      errors: issues,
      invoiceUpload: serializeInvoiceUpload(invoiceUpload)
    });
  }
}

export async function getInvoiceUpload(request: Request, response: Response): Promise<Response> {
  const invoiceUploadId = typeof request.params.id === "string" ? request.params.id : "";
  if (!mongoose.Types.ObjectId.isValid(invoiceUploadId)) {
    return response.status(404).json({ success: false, message: "Invoice upload not found" });
  }

  const invoiceUpload = await InvoiceUpload.findById(invoiceUploadId).lean().exec();
  if (!invoiceUpload) return response.status(404).json({ success: false, message: "Invoice upload not found" });

  const shipmentDraft = await ShipmentDraft.findOne({ invoiceUploadId: invoiceUpload._id, deletedAt: null })
    .lean()
    .exec();

  return response.status(200).json({
    success: true,
    invoiceUpload: serializeInvoiceUpload(invoiceUpload),
    shipmentDraft
  });
}
