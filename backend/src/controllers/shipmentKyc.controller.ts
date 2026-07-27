import fs from "fs";
import path from "path";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog } from "../models/auditLog.model.js";
import {
  ShipmentDraft,
  shipmentKycDocumentTypeValues,
  type ShipmentKycDocument,
  type ShipmentKycDocumentType
} from "../models/shipmentDraft.model.js";
import {
  assertShipmentDraftMutationAllowed,
  ShipmentDraftPolicyError
} from "../services/shipmentDraftPolicy.service.js";
import { validateShipmentDraftFields } from "../services/shipmentValidation.service.js";

const kycUploadRoot = path.resolve(process.cwd(), "private_uploads", "shipment-kyc");

const documentTypeSchema = z.enum(shipmentKycDocumentTypeValues);
const documentLabelSchema = z.string().trim().min(2).max(80);

export const kycDocumentLabels: Record<ShipmentKycDocumentType, string> = {
  aadhaar: "Aadhaar Card",
  pan: "PAN Card",
  other: "Other Document"
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

async function removeFile(filePath: string | undefined) {
  if (!filePath) return;
  await fs.promises.unlink(filePath).catch(() => undefined);
}

/** Public shape of a stored document: metadata only, never the on-disk path. */
export function serializeKycDocument(document: ShipmentKycDocument | undefined | null) {
  if (!document?.storedName) return null;

  return {
    type: document.type,
    documentLabel: document.documentLabel || kycDocumentLabels[document.type],
    originalName: document.originalName,
    mimeType: document.mimeType,
    size: document.size,
    uploadedAt: document.uploadedAt
  };
}

export function serializeKycDocuments(
  documents: Partial<Record<ShipmentKycDocumentType, ShipmentKycDocument>> | undefined
) {
  const source = documents ?? {};

  return {
    aadhaar: serializeKycDocument(source.aadhaar),
    pan: serializeKycDocument(source.pan),
    other: serializeKycDocument(source.other)
  };
}

function parseParcelSequence(request: Request): number | null {
  const raw = typeof request.params.sequence === "string" ? Number(request.params.sequence) : NaN;
  return Number.isInteger(raw) && raw >= 1 ? raw : null;
}

export async function uploadShipmentParcelKycDocument(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    await removeFile(request.file?.path);
    return response.status(401).json({ success: false, message: "Unauthorized" });
  }

  const parsedType = documentTypeSchema.safeParse(request.params.type);
  const sequence = parseParcelSequence(request);
  if (!parsedType.success || sequence === null) {
    await removeFile(request.file?.path);
    return response.status(400).json({ success: false, message: "Unknown parcel KYC document." });
  }

  if (!request.file) {
    return response.status(400).json({ success: false, message: "Select a document to upload." });
  }

  let documentLabel = kycDocumentLabels[parsedType.data];
  if (parsedType.data === "other") {
    const parsedLabel = documentLabelSchema.safeParse(request.body?.documentLabel);
    if (!parsedLabel.success) {
      await removeFile(request.file.path);
      return response.status(400).json({ success: false, message: "Type what the other document is before uploading it." });
    }
    documentLabel = parsedLabel.data;
  }

  const draftId = typeof request.params.id === "string" ? request.params.id : "";
  if (!mongoose.Types.ObjectId.isValid(draftId)) {
    await removeFile(request.file.path);
    return response.status(404).json({ success: false, message: "Shipment draft not found" });
  }

  const shipmentDraft = await ShipmentDraft.findById(draftId).exec();
  if (!shipmentDraft) {
    await removeFile(request.file.path);
    return response.status(404).json({ success: false, message: "Shipment draft not found" });
  }

  const parcelIndex = sequence - 1;
  if (parcelIndex >= shipmentDraft.parcelList.length) {
    await removeFile(request.file.path);
    return response.status(409).json({ success: false, message: "Save the shipment parcels before uploading their KYC." });
  }

  try {
    await assertShipmentDraftMutationAllowed({ draft: shipmentDraft, userId, portalRole: getAuthenticatedPortalRole(request) });
  } catch (error) {
    await removeFile(request.file.path);
    const policyResponse = sendDraftPolicyError(response, error);
    if (policyResponse) return policyResponse;
    throw error;
  }

  const previousDocument = shipmentDraft.parcelList[parcelIndex]?.kycDocuments?.[parsedType.data];

  shipmentDraft.set(`parcelList.${parcelIndex}.kycDocuments.${parsedType.data}`, {
    type: parsedType.data,
    documentLabel,
    originalName: request.file.originalname,
    storedName: request.file.filename,
    mimeType: request.file.mimetype,
    size: request.file.size,
    path: request.file.path,
    uploadedAt: new Date(),
    uploadedBy: userId
  });
  shipmentDraft.validationIssues = validateShipmentDraftFields(shipmentDraft);
  shipmentDraft.status = shipmentDraft.validationIssues.length ? "VALIDATION_FAILED" : "READY_FOR_DPD";
  await shipmentDraft.save();
  await removeFile(previousDocument?.path);

  await AuditLog.create({
    action: "SHIPMENT_KYC_DOCUMENT_UPLOADED",
    entityType: "SHIPMENT_DRAFT",
    entityId: shipmentDraft._id,
    performedBy: userId,
    performedAt: new Date(),
    metadata: { parcelSequence: sequence, documentType: parsedType.data, documentLabel, originalName: request.file.originalname, size: request.file.size }
  });

  return response.status(200).json({
    success: true,
    parcelSequence: sequence,
    kycDocuments: serializeKycDocuments(shipmentDraft.parcelList[parcelIndex]?.kycDocuments),
    validationIssues: shipmentDraft.validationIssues
  });
}

export async function deleteShipmentParcelKycDocument(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsedType = documentTypeSchema.safeParse(request.params.type);
  const sequence = parseParcelSequence(request);
  if (!parsedType.success || sequence === null) {
    return response.status(400).json({ success: false, message: "Unknown parcel KYC document." });
  }

  const draftId = typeof request.params.id === "string" ? request.params.id : "";
  if (!mongoose.Types.ObjectId.isValid(draftId)) {
    return response.status(404).json({ success: false, message: "Shipment draft not found" });
  }

  const shipmentDraft = await ShipmentDraft.findById(draftId).exec();
  if (!shipmentDraft) return response.status(404).json({ success: false, message: "Shipment draft not found" });

  const parcelIndex = sequence - 1;
  const existing = shipmentDraft.parcelList[parcelIndex]?.kycDocuments?.[parsedType.data];
  if (!existing?.storedName) return response.status(404).json({ success: false, message: "Document not found" });

  try {
    await assertShipmentDraftMutationAllowed({ draft: shipmentDraft, userId, portalRole: getAuthenticatedPortalRole(request) });
  } catch (error) {
    const policyResponse = sendDraftPolicyError(response, error);
    if (policyResponse) return policyResponse;
    throw error;
  }

  shipmentDraft.set(`parcelList.${parcelIndex}.kycDocuments.${parsedType.data}`, undefined);
  shipmentDraft.validationIssues = validateShipmentDraftFields(shipmentDraft);
  shipmentDraft.status = shipmentDraft.validationIssues.length ? "VALIDATION_FAILED" : "READY_FOR_DPD";
  await shipmentDraft.save();
  await removeFile(existing.path);

  await AuditLog.create({
    action: "SHIPMENT_KYC_DOCUMENT_REMOVED",
    entityType: "SHIPMENT_DRAFT",
    entityId: shipmentDraft._id,
    performedBy: userId,
    performedAt: new Date(),
    metadata: { parcelSequence: sequence, documentType: parsedType.data, originalName: existing.originalName }
  });

  return response.status(200).json({
    success: true,
    parcelSequence: sequence,
    kycDocuments: serializeKycDocuments(shipmentDraft.parcelList[parcelIndex]?.kycDocuments),
    validationIssues: shipmentDraft.validationIssues
  });
}

export async function downloadShipmentParcelKycDocument(request: Request, response: Response): Promise<Response | void> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsedType = documentTypeSchema.safeParse(request.params.type);
  const sequence = parseParcelSequence(request);
  if (!parsedType.success || sequence === null) {
    return response.status(400).json({ success: false, message: "Unknown parcel KYC document." });
  }

  const draftId = typeof request.params.id === "string" ? request.params.id : "";
  if (!mongoose.Types.ObjectId.isValid(draftId)) {
    return response.status(404).json({ success: false, message: "Shipment draft not found" });
  }

  const shipmentDraft = await ShipmentDraft.findById(draftId).lean().exec();
  if (!shipmentDraft) return response.status(404).json({ success: false, message: "Shipment draft not found" });

  const document = shipmentDraft.parcelList[sequence - 1]?.kycDocuments?.[parsedType.data];
  if (!document?.storedName) return response.status(404).json({ success: false, message: "Document not found" });

  const absolutePath = path.resolve(kycUploadRoot, path.basename(document.storedName));
  if (!absolutePath.startsWith(kycUploadRoot + path.sep)) {
    return response.status(404).json({ success: false, message: "Document not found" });
  }

  try {
    await fs.promises.access(absolutePath, fs.constants.R_OK);
  } catch {
    return response.status(404).json({ success: false, message: "Document file is no longer available" });
  }

  response.setHeader("Content-Type", document.mimeType);
  response.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(document.originalName)}"`);
  return response.sendFile(absolutePath);
}

export async function uploadShipmentKycDocument(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) {
    await removeFile(request.file?.path);
    return response.status(401).json({ success: false, message: "Unauthorized" });
  }

  const parsedType = documentTypeSchema.safeParse(request.params.type);
  if (!parsedType.success) {
    await removeFile(request.file?.path);
    return response.status(400).json({ success: false, message: "Unknown KYC document type." });
  }

  if (!request.file) {
    return response.status(400).json({ success: false, message: "Select a document to upload." });
  }

  // "Other" documents are meaningless to a reviewer without a name, so the
  // label is captured with the file rather than after the fact.
  let documentLabel = kycDocumentLabels[parsedType.data];
  if (parsedType.data === "other") {
    const parsedLabel = documentLabelSchema.safeParse(request.body?.documentLabel);
    if (!parsedLabel.success) {
      await removeFile(request.file.path);
      return response.status(400).json({
        success: false,
        message: "Type what the other document is before uploading it."
      });
    }
    documentLabel = parsedLabel.data;
  }

  const draftId = typeof request.params.id === "string" ? request.params.id : "";
  if (!mongoose.Types.ObjectId.isValid(draftId)) {
    await removeFile(request.file.path);
    return response.status(404).json({ success: false, message: "Shipment draft not found" });
  }

  const shipmentDraft = await ShipmentDraft.findById(draftId).exec();
  if (!shipmentDraft) {
    await removeFile(request.file.path);
    return response.status(404).json({ success: false, message: "Shipment draft not found" });
  }

  try {
    await assertShipmentDraftMutationAllowed({
      draft: shipmentDraft,
      userId,
      portalRole: getAuthenticatedPortalRole(request)
    });
  } catch (error) {
    await removeFile(request.file.path);
    const policyResponse = sendDraftPolicyError(response, error);
    if (policyResponse) return policyResponse;
    throw error;
  }

  const previousDocument = shipmentDraft.kycDocuments?.[parsedType.data];

  shipmentDraft.set(`kycDocuments.${parsedType.data}`, {
    type: parsedType.data,
    documentLabel,
    originalName: request.file.originalname,
    storedName: request.file.filename,
    mimeType: request.file.mimetype,
    size: request.file.size,
    path: request.file.path,
    uploadedAt: new Date(),
    uploadedBy: userId
  });
  shipmentDraft.validationIssues = validateShipmentDraftFields(shipmentDraft);
  shipmentDraft.status = shipmentDraft.validationIssues.length ? "VALIDATION_FAILED" : "READY_FOR_DPD";
  await shipmentDraft.save();

  // Only drop the replaced file once the new one is committed.
  await removeFile(previousDocument?.path);

  await AuditLog.create({
    action: "SHIPMENT_KYC_DOCUMENT_UPLOADED",
    entityType: "SHIPMENT_DRAFT",
    entityId: shipmentDraft._id,
    performedBy: userId,
    performedAt: new Date(),
    metadata: {
      documentType: parsedType.data,
      documentLabel,
      originalName: request.file.originalname,
      size: request.file.size,
      replacedExisting: Boolean(previousDocument?.storedName)
    }
  });

  return response.status(200).json({
    success: true,
    kycDocuments: serializeKycDocuments(shipmentDraft.kycDocuments),
    validationIssues: shipmentDraft.validationIssues
  });
}

export async function deleteShipmentKycDocument(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsedType = documentTypeSchema.safeParse(request.params.type);
  if (!parsedType.success) {
    return response.status(400).json({ success: false, message: "Unknown KYC document type." });
  }

  const draftId = typeof request.params.id === "string" ? request.params.id : "";
  if (!mongoose.Types.ObjectId.isValid(draftId)) {
    return response.status(404).json({ success: false, message: "Shipment draft not found" });
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

  const existing = shipmentDraft.kycDocuments?.[parsedType.data];
  if (!existing?.storedName) {
    return response.status(404).json({ success: false, message: "Document not found" });
  }

  shipmentDraft.set(`kycDocuments.${parsedType.data}`, undefined);
  shipmentDraft.validationIssues = validateShipmentDraftFields(shipmentDraft);
  shipmentDraft.status = shipmentDraft.validationIssues.length ? "VALIDATION_FAILED" : "READY_FOR_DPD";
  await shipmentDraft.save();
  await removeFile(existing.path);

  await AuditLog.create({
    action: "SHIPMENT_KYC_DOCUMENT_REMOVED",
    entityType: "SHIPMENT_DRAFT",
    entityId: shipmentDraft._id,
    performedBy: userId,
    performedAt: new Date(),
    metadata: { documentType: parsedType.data, originalName: existing.originalName }
  });

  return response.status(200).json({
    success: true,
    kycDocuments: serializeKycDocuments(shipmentDraft.kycDocuments),
    validationIssues: shipmentDraft.validationIssues
  });
}

export async function downloadShipmentKycDocument(request: Request, response: Response): Promise<Response | void> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsedType = documentTypeSchema.safeParse(request.params.type);
  if (!parsedType.success) {
    return response.status(400).json({ success: false, message: "Unknown KYC document type." });
  }

  const draftId = typeof request.params.id === "string" ? request.params.id : "";
  if (!mongoose.Types.ObjectId.isValid(draftId)) {
    return response.status(404).json({ success: false, message: "Shipment draft not found" });
  }

  const shipmentDraft = await ShipmentDraft.findById(draftId).lean().exec();
  if (!shipmentDraft) return response.status(404).json({ success: false, message: "Shipment draft not found" });

  const document = shipmentDraft.kycDocuments?.[parsedType.data];
  if (!document?.storedName) return response.status(404).json({ success: false, message: "Document not found" });

  // Resolve against the KYC root so a tampered stored path cannot escape it.
  const absolutePath = path.resolve(kycUploadRoot, path.basename(document.storedName));
  if (!absolutePath.startsWith(kycUploadRoot + path.sep)) {
    return response.status(404).json({ success: false, message: "Document not found" });
  }

  try {
    await fs.promises.access(absolutePath, fs.constants.R_OK);
  } catch {
    return response.status(404).json({ success: false, message: "Document file is no longer available" });
  }

  response.setHeader("Content-Type", document.mimeType);
  response.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(document.originalName)}"`);

  return response.sendFile(absolutePath);
}
