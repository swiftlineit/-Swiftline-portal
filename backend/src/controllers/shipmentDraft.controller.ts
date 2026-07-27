import fs from "fs";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog } from "../models/auditLog.model.js";
import { InvoiceUpload } from "../models/invoiceUpload.model.js";
import { IShipmentDraft, ShipmentDraft, shipmentContentTypeValues, shipmentServiceTypeValues } from "../models/shipmentDraft.model.js";
import { mapShipmentDraftToDpdPayload } from "../services/dpdPayloadMapper.service.js";
import { validateDpdPayload } from "../services/dpdPayloadValidation.service.js";
import {
  DpdProviderConfigurationError,
  getDpdProviderConfiguration
} from "../services/dpdProviderConfiguration.service.js";
import { parseDpdInvoiceWorkbook } from "../services/invoiceParser.service.js";
import { maskAadhaarNumber, normalizeAadhaarNumber } from "../services/aadhaarValidation.service.js";
import { validateShipmentDraftFields } from "../services/shipmentValidation.service.js";
import {
  assertShipmentDraftMutationAllowed,
  ShipmentDraftPolicyError,
  syncLegacyDraftBookingState
} from "../services/shipmentDraftPolicy.service.js";
import {
  createBlankShipmentDraft,
  ManualShipmentDraftError
} from "../services/manualShipmentDraft.service.js";

const manualDraftSchema = z.object({
  businessAccountId: z.string().trim().min(1),
  branchId: z.string().trim().min(1)
});

const addressPatchSchema = z.object({
  companyName: z.string().trim().max(120).optional(),
  contactName: z.string().trim().max(120).optional(),
  email: z.string().trim().max(160).optional(),
  mobileCountryCode: z.string().trim().max(8).optional(),
  mobileNumber: z.string().trim().max(30).optional(),
  countryCode: z.string().trim().toUpperCase().length(2).optional(),
  countryName: z.string().trim().max(80).optional(),
  postcode: z.string().trim().toUpperCase().max(20).optional(),
  addressLine1: z.string().trim().max(120).optional(),
  addressLine2: z.string().trim().max(120).optional(),
  townOrCity: z.string().trim().max(80).optional(),
  county: z.string().trim().max(80).optional(),
  deliveryInstructions: z.string().trim().max(500).optional()
});

// Country, country name, and dialling code are pinned by the model, so they are
// intentionally absent here and cannot be overridden by a client.
const consignorPatchSchema = z.object({
  companyName: z.string().trim().max(120).optional(),
  contactName: z.string().trim().max(120).optional(),
  email: z.string().trim().max(160).optional(),
  mobileNumber: z.string().trim().max(30).optional(),
  aadhaarNumber: z.string().trim().max(20).transform((value) => normalizeAadhaarNumber(value)).optional(),
  postcode: z.string().trim().toUpperCase().max(20).optional(),
  addressLine1: z.string().trim().max(120).optional(),
  addressLine2: z.string().trim().max(120).optional(),
  townOrCity: z.string().trim().max(80).optional(),
  county: z.string().trim().max(80).optional(),
  pickupInstructions: z.string().trim().max(500).optional()
});

const parcelPatchSchema = z.object({
  sequence: z.coerce.number().int().positive(),
  weightKg: z.coerce.number().nonnegative(),
  lengthCm: z.coerce.number().nonnegative().optional().nullable(),
  widthCm: z.coerce.number().nonnegative().optional().nullable(),
  heightCm: z.coerce.number().nonnegative().optional().nullable(),
  shipmentContentType: z.enum(shipmentContentTypeValues).default("PARCEL"),
  contentsDescription: z.string().trim().max(120),
  shipmentReference1: z.string().trim().max(120).optional(),
  shipmentReference2: z.string().trim().max(120).optional(),
  // Per-parcel Aadhaar for shipments not sharing one KYC set. Uploaded files are
  // server-managed and preserved separately, never sent by the client.
  aadhaarNumber: z.string().trim().max(20).transform((value) => normalizeAadhaarNumber(value)).optional()
});

const draftPatchSchema = z.object({
  consignorAddress: consignorPatchSchema.optional(),
  consigneeEnteredAddress: addressPatchSchema.optional(),
  kycUseForAllParcels: z.boolean().optional(),
  parcelList: z.array(parcelPatchSchema).min(1).max(10).optional(),
  serviceType: z.enum(shipmentServiceTypeValues).optional(),
  serviceCode: z.string().trim().max(40).optional()
});

type FieldChange = {
  fieldName: string;
  originalValue: unknown;
  newValue: unknown;
  changedBy: string;
  changedAt: string;
  source: "manual";
};

function getAuthenticatedUserId(request: Request): mongoose.Types.ObjectId | null {
  const user = (request as Request & { user?: { _id?: unknown } }).user;
  const id = user?._id;

  return id && mongoose.Types.ObjectId.isValid(String(id))
    ? new mongoose.Types.ObjectId(String(id))
    : null;
}

function getAuthenticatedPortalRole(request: Request) {
  const user = (request as Request & { user?: { role?: unknown } }).user;
  return typeof user?.role === "string" ? user.role : "";
}

function sendDraftPolicyError(response: Response, error: unknown) {
  return error instanceof ShipmentDraftPolicyError
    ? response.status(error.statusCode).json({ success: false, message: error.message })
    : null;
}

function getDraftId(request: Request) {
  const draftId = typeof request.params.id === "string" ? request.params.id : "";
  return mongoose.Types.ObjectId.isValid(draftId) ? draftId : "";
}

async function writeShipmentDraftAuditLog(
  action: "SHIPMENT_DRAFT_UPDATED" | "SHIPMENT_VALIDATION_COMPLETED",
  shipmentDraftId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
  metadata: Record<string, unknown>
) {
  await AuditLog.create({
    action,
    entityType: "SHIPMENT_DRAFT",
    entityId: shipmentDraftId,
    performedBy: userId,
    performedAt: new Date(),
    metadata
  });
}

function valuesDiffer(originalValue: unknown, newValue: unknown) {
  return JSON.stringify(originalValue ?? "") !== JSON.stringify(newValue ?? "");
}

function recordFieldChange(
  changes: FieldChange[],
  fieldName: string,
  originalValue: unknown,
  newValue: unknown,
  userId: mongoose.Types.ObjectId,
  changedAt: string
) {
  if (!valuesDiffer(originalValue, newValue)) return;

  changes.push({
    fieldName,
    originalValue: originalValue ?? "",
    newValue: newValue ?? "",
    changedBy: String(userId),
    changedAt,
    source: "manual"
  });
}

function getDraftPatchValidationIssues(error: z.ZodError) {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");

    if (path === "parcelList") return "One parcel is required";
    if (path.endsWith(".sequence")) return "Parcel sequence must be a positive whole number";
    if (path.endsWith(".weightKg")) return "Parcel weight must be zero or greater";
    if (path.endsWith(".contentsDescription")) return "Parcel contents description is required";
    if (path === "serviceType") return "Service type must be Courier or Cargo";
    if (path === "serviceCode") return "DPD service code must be 40 characters or fewer";
    if (path === "consignorAddress.contactName") return "Consignor contact name must be 120 characters or fewer";
    if (path === "consignorAddress.email") return "Consignor email must be 160 characters or fewer";
    if (path === "consignorAddress.mobileNumber") return "Consignor mobile number must be 30 characters or fewer";
    if (path === "consignorAddress.aadhaarNumber") return "Aadhaar number must be 12 digits";
    if (path === "consignorAddress.addressLine1") return "Consignor address line 1 must be 120 characters or fewer";
    if (path === "consignorAddress.townOrCity") return "Consignor town or city must be 80 characters or fewer";
    if (path === "consignorAddress.postcode") return "Consignor PIN code must be 20 characters or fewer";
    if (path === "consigneeEnteredAddress.contactName") return "Contact name must be 120 characters or fewer";
    if (path === "consigneeEnteredAddress.mobileCountryCode") return "Mobile country code must be 8 characters or fewer";
    if (path === "consigneeEnteredAddress.mobileNumber") return "Mobile number must be 30 characters or fewer";
    if (path === "consigneeEnteredAddress.addressLine1") return "Address line 1 must be 120 characters or fewer";
    if (path === "consigneeEnteredAddress.townOrCity") return "Town or city must be 80 characters or fewer";
    if (path === "consigneeEnteredAddress.postcode") return "Postcode must be 20 characters or fewer";

    return issue.message;
  });
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function backfillDraftPhoneFromInvoice(shipmentDraft: IShipmentDraft) {
  const address = shipmentDraft.consigneeEnteredAddress;
  if (hasText(address.mobileCountryCode) && hasText(address.mobileNumber)) return;

  const invoiceUpload = await InvoiceUpload.findById(shipmentDraft.invoiceUploadId).lean().exec();
  if (!invoiceUpload?.storagePath || !fs.existsSync(invoiceUpload.storagePath)) return;

  const parsedInvoice = parseDpdInvoiceWorkbook(invoiceUpload.storagePath);
  if (!parsedInvoice.consignee.mobileCountryCode || !parsedInvoice.consignee.mobileNumber) return;

  shipmentDraft.consigneeEnteredAddress = {
    ...shipmentDraft.consigneeEnteredAddress,
    mobileCountryCode: parsedInvoice.consignee.mobileCountryCode,
    mobileNumber: parsedInvoice.consignee.mobileNumber
  };
  shipmentDraft.validationIssues = validateShipmentDraftFields(shipmentDraft);
  await shipmentDraft.save();
}

async function syncReviewValidationIssues(shipmentDraft: IShipmentDraft) {
  const reviewIssues = validateShipmentDraftFields(shipmentDraft);
  if (JSON.stringify(shipmentDraft.validationIssues ?? []) === JSON.stringify(reviewIssues)) return;

  shipmentDraft.validationIssues = reviewIssues;
  await shipmentDraft.save();
}

export async function getShipmentDraft(request: Request, response: Response): Promise<Response> {
  const draftId = getDraftId(request);
  if (!draftId) return response.status(404).json({ success: false, message: "Shipment draft not found" });

  const shipmentDraft = await ShipmentDraft.findById(draftId).exec();
  if (!shipmentDraft) return response.status(404).json({ success: false, message: "Shipment draft not found" });

  try {
    const bookingState = await syncLegacyDraftBookingState(shipmentDraft);
    if (bookingState === "EDITABLE") {
      await backfillDraftPhoneFromInvoice(shipmentDraft);
      await syncReviewValidationIssues(shipmentDraft);
    }
  } catch {
    // Keep loading the draft even if the original invoice is no longer parseable.
  }

  return response.status(200).json({ success: true, shipmentDraft });
}

export async function createManualShipmentDraft(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = manualDraftSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      success: false,
      message: "Select a business account and sender branch before creating a blank shipment."
    });
  }

  try {
    const shipmentDraft = await createBlankShipmentDraft({
      ...parsed.data,
      createdBy: userId
    });

    return response.status(201).json({ success: true, shipmentDraft });
  } catch (error) {
    if (error instanceof ManualShipmentDraftError) {
      return response.status(error.statusCode).json({ success: false, message: error.message });
    }
    throw error;
  }
}

export async function updateShipmentDraft(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const draftId = getDraftId(request);
  if (!draftId) return response.status(404).json({ success: false, message: "Shipment draft not found" });

  const parsed = draftPatchSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      success: false,
      message: "Shipment changes are invalid.",
      errors: getDraftPatchValidationIssues(parsed.error)
    });
  }

  const shipmentDraft = await ShipmentDraft.findById(draftId).exec();
  if (!shipmentDraft) return response.status(404).json({ success: false, message: "Shipment draft not found" });

  try {
    await assertShipmentDraftMutationAllowed({
      draft: shipmentDraft,
      userId,
      portalRole: getAuthenticatedPortalRole(request)
    });
  } catch (error) {
    const policyResponse = sendDraftPolicyError(response, error);
    if (policyResponse) return policyResponse;
    throw error;
  }

  const changedAt = new Date().toISOString();
  const changedFields: FieldChange[] = [];

  if (parsed.data.consignorAddress) {
    const originalConsignor = { ...(shipmentDraft.consignorAddress ?? {}) } as Record<string, unknown>;

    for (const [fieldName, newValue] of Object.entries(parsed.data.consignorAddress)) {
      // Aadhaar numbers never reach the audit trail in full.
      const isAadhaar = fieldName === "aadhaarNumber";
      recordFieldChange(
        changedFields,
        `consignorAddress.${fieldName}`,
        isAadhaar ? maskAadhaarNumber(originalConsignor[fieldName]) : originalConsignor[fieldName],
        isAadhaar ? maskAadhaarNumber(newValue) : newValue,
        userId,
        changedAt
      );
    }

    shipmentDraft.consignorAddress = {
      ...(shipmentDraft.consignorAddress ?? {}),
      ...parsed.data.consignorAddress
    } as typeof shipmentDraft.consignorAddress;
  }

  if (parsed.data.consigneeEnteredAddress) {
    const originalAddress = { ...shipmentDraft.consigneeEnteredAddress } as Record<string, unknown>;

    for (const [fieldName, newValue] of Object.entries(parsed.data.consigneeEnteredAddress)) {
      recordFieldChange(
        changedFields,
        `consigneeEnteredAddress.${fieldName}`,
        (originalAddress as Record<string, unknown>)[fieldName],
        newValue,
        userId,
        changedAt
      );
    }

    shipmentDraft.consigneeEnteredAddress = {
      ...shipmentDraft.consigneeEnteredAddress,
      ...parsed.data.consigneeEnteredAddress
    };

    // Only a change to the postal address itself invalidates a prior address
    // validation. Editing contact fields (name, email, phone, delivery notes) must
    // NOT reset it, otherwise a manual "use address as entered" confirmation is lost
    // every time an unrelated field is corrected, forcing the user to re-confirm.
    const addressRelevantFields = new Set([
      "countryCode",
      "countryName",
      "addressLine1",
      "addressLine2",
      "townOrCity",
      "county",
      "postcode"
    ]);
    const postalAddressChanged = changedFields.some((field) =>
      field.fieldName.startsWith("consigneeEnteredAddress.")
      && addressRelevantFields.has(field.fieldName.slice("consigneeEnteredAddress.".length))
    );

    if (postalAddressChanged) {
      shipmentDraft.addressValidationStatus = "NOT_VALIDATED";
      shipmentDraft.consigneeValidatedAddress = null;
    }
  }

  if (parsed.data.parcelList) {
    parsed.data.parcelList.forEach((nextParcel, index) => {
      const originalParcel = { ...(shipmentDraft.parcelList[index] ?? {}) } as Record<string, unknown>;

      for (const [fieldName, newValue] of Object.entries(nextParcel)) {
        // Parcel Aadhaar numbers, like the consignor's, are masked in the audit log.
        const isAadhaar = fieldName === "aadhaarNumber";
        recordFieldChange(
          changedFields,
          `parcelList.${index}.${fieldName}`,
          isAadhaar ? maskAadhaarNumber(originalParcel[fieldName]) : originalParcel[fieldName],
          isAadhaar ? maskAadhaarNumber(newValue) : (newValue ?? ""),
          userId,
          changedAt
        );
      }
    });

    // KYC uploads are server-managed and are preserved by sequence across a parcel
    // edit. Files belonging to parcels that no longer exist are cleaned up.
    const existingBySequence = new Map(shipmentDraft.parcelList.map((parcel) => [parcel.sequence, parcel]));
    const nextSequences = new Set(parsed.data.parcelList.map((parcel) => parcel.sequence));
    const removedKycPaths = shipmentDraft.parcelList
      .filter((parcel) => !nextSequences.has(parcel.sequence))
      .flatMap((parcel) => Object.values(parcel.kycDocuments ?? {}))
      .map((document) => document?.path)
      .filter((filePath): filePath is string => Boolean(filePath));

    shipmentDraft.parcelList = parsed.data.parcelList.map((parcel) => {
      const existing = existingBySequence.get(parcel.sequence);
      return {
        sequence: parcel.sequence,
        weightKg: parcel.weightKg,
        lengthCm: parcel.lengthCm ?? undefined,
        widthCm: parcel.widthCm ?? undefined,
        heightCm: parcel.heightCm ?? undefined,
        shipmentContentType: parcel.shipmentContentType,
        contentsDescription: parcel.contentsDescription,
        shipmentReference1: parcel.shipmentReference1 ?? "",
        shipmentReference2: parcel.shipmentReference2 ?? "",
        aadhaarNumber: parcel.aadhaarNumber ?? existing?.aadhaarNumber ?? "",
        kycDocuments: existing?.kycDocuments ?? {}
      };
    });
    shipmentDraft.parcelCount = shipmentDraft.parcelList.length;

    await Promise.all(removedKycPaths.map((filePath) => fs.promises.unlink(filePath).catch(() => undefined)));
  }

  if (typeof parsed.data.kycUseForAllParcels === "boolean") {
    recordFieldChange(
      changedFields,
      "kycUseForAllParcels",
      shipmentDraft.kycUseForAllParcels,
      parsed.data.kycUseForAllParcels,
      userId,
      changedAt
    );
    shipmentDraft.kycUseForAllParcels = parsed.data.kycUseForAllParcels;
  }

  if (typeof parsed.data.serviceCode === "string") {
    recordFieldChange(
      changedFields,
      "serviceCode",
      shipmentDraft.serviceCode,
      parsed.data.serviceCode,
      userId,
      changedAt
    );
    shipmentDraft.serviceCode = parsed.data.serviceCode;
  }

  if (parsed.data.serviceType) {
    recordFieldChange(
      changedFields,
      "serviceType",
      shipmentDraft.serviceType,
      parsed.data.serviceType,
      userId,
      changedAt
    );
    shipmentDraft.serviceType = parsed.data.serviceType;
  }

  shipmentDraft.validationIssues = validateShipmentDraftFields(shipmentDraft);
  shipmentDraft.status = shipmentDraft.validationIssues.length ? "VALIDATION_FAILED" : "READY_FOR_DPD";
  await shipmentDraft.save();

  await writeShipmentDraftAuditLog("SHIPMENT_DRAFT_UPDATED", shipmentDraft._id as mongoose.Types.ObjectId, userId, {
    changedFields,
    changeCount: changedFields.length
  });

  return response.status(200).json({ success: true, shipmentDraft });
}

export async function validateShipmentDraft(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const draftId = getDraftId(request);
  if (!draftId) return response.status(404).json({ success: false, message: "Shipment draft not found" });

  const shipmentDraft = await ShipmentDraft.findById(draftId).exec();
  if (!shipmentDraft) return response.status(404).json({ success: false, message: "Shipment draft not found" });

  try {
    await assertShipmentDraftMutationAllowed({
      draft: shipmentDraft,
      userId,
      portalRole: getAuthenticatedPortalRole(request)
    });
  } catch (error) {
    const policyResponse = sendDraftPolicyError(response, error);
    if (policyResponse) return policyResponse;
    throw error;
  }

  const issues = validateShipmentDraftFields(shipmentDraft, { requireValidatedAddress: true });
  const invoiceUpload = await InvoiceUpload.findById(shipmentDraft.invoiceUploadId).exec();
  let configuration;
  try {
    configuration = getDpdProviderConfiguration();
  } catch (error) {
    issues.push(error instanceof DpdProviderConfigurationError
      ? error.message
      : "The global DPD provider configuration is unavailable.");
  }
  const dpdConfigured = Boolean(configuration);

  if (!invoiceUpload) {
    issues.push("Invoice upload is required before DPD validation");
  } else if (configuration && issues.length === 0) {
    const payload = mapShipmentDraftToDpdPayload(shipmentDraft, invoiceUpload, configuration);
    issues.push(...validateDpdPayload(payload, configuration));
  }

  shipmentDraft.validationIssues = issues;
  shipmentDraft.status = issues.length ? "VALIDATION_FAILED" : "READY_FOR_DPD";
  await shipmentDraft.save();

  await writeShipmentDraftAuditLog(
    "SHIPMENT_VALIDATION_COMPLETED",
    shipmentDraft._id as mongoose.Types.ObjectId,
    userId,
    {
      issueCount: issues.length,
      dpdConfigured,
      providerMode: configuration?.mode ?? "UNAVAILABLE"
    }
  );

  return response.status(200).json({
    success: true,
    readyForDpd: shipmentDraft.status === "READY_FOR_DPD",
    validationIssues: shipmentDraft.validationIssues,
    shipmentDraft
  });
}
