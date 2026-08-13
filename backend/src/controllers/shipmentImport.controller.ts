import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { env } from "../config/env.js";
import { AuditLog } from "../models/auditLog.model.js";
import { Branch } from "../models/branch.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentImportBatch } from "../models/shipmentImportBatch.model.js";
import { ShipmentImportEntry } from "../models/shipmentImportEntry.model.js";
import { canAccessBranch } from "../middleware/branchAccess.middleware.js";
import {
  parseShipmentImportWorkbook,
  ShipmentImportParseError,
  type ParsedShipmentImport
} from "../services/shipmentImport/shipmentImportParser.service.js";
import {
  shipmentImportLimits
} from "../services/shipmentImport/shipmentImportContract.js";
import { buildShipmentImportTemplateWorkbook } from "../services/shipmentImport/shipmentImportWorkbook.service.js";
import {
  checksumOf,
  deleteObject,
  putObject,
  shipmentImportKey
} from "../services/storage/storage.service.js";

const createDraftsSchema = z.object({
  entryIds: z.array(z.string().trim().min(1)).min(1).max(shipmentImportLimits.filesPerBatch)
});

type AuthenticatedUser = { _id?: unknown; role?: string };

function authenticatedUser(request: Request) {
  return (request as Request & { user?: AuthenticatedUser }).user;
}

function authenticatedUserId(request: Request) {
  const id = authenticatedUser(request)?._id;
  return id && mongoose.Types.ObjectId.isValid(String(id))
    ? new mongoose.Types.ObjectId(String(id))
    : null;
}

function uploadedFiles(request: Request) {
  const files = request.files as Record<string, Express.Multer.File[]> | undefined;
  return files?.shipmentFiles ?? [];
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

function serializeEntry(entry: {
  _id: unknown; position: number; originalFilename: string; fileChecksum: string;
  parsedData?: Record<string, unknown>; warnings?: string[]; importErrors?: string[];
  status: string; shipmentDraftId?: unknown; createdAt?: Date; updatedAt?: Date;
}) {
  const parsed = entry.parsedData as Partial<ParsedShipmentImport> | undefined;
  return {
    id: String(entry._id),
    position: entry.position,
    originalFilename: entry.originalFilename,
    fileChecksum: entry.fileChecksum,
    status: entry.status,
    warnings: entry.warnings ?? [],
    errors: entry.importErrors ?? [],
    shipmentDraftId: entry.shipmentDraftId ? String(entry.shipmentDraftId) : null,
    summary: parsed ? {
      consignee: parsed.consignee?.contactName ?? "",
      destination: parsed.consignee?.countryName ?? "",
      references: parsed.parcels?.map((parcel) => parcel.reference).filter(Boolean) ?? [],
      parcelCount: parsed.parcels?.length ?? 0,
      itemCount: parsed.parcels?.reduce((total, parcel) => total + parcel.items.length, 0) ?? 0,
      totalWeightKg: parsed.parcels?.reduce((total, parcel) => total + parcel.weightKg, 0) ?? 0,
      declaredValue: parsed.parcels?.reduce((total, parcel) => (
        total + parcel.items.reduce((itemTotal, item) => itemTotal + item.quantity * item.unitRate, 0)
      ), 0) ?? 0,
      serviceType: parsed.serviceType ?? "",
      shipmentType: parsed.csbType ?? ""
    } : null,
    parsedData: entry.parsedData ?? {},
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

async function serializeBatch(batch: InstanceType<typeof ShipmentImportBatch>) {
  const entries = await ShipmentImportEntry.find({ batchId: batch._id }).sort({ position: 1 }).lean().exec();
  return {
    id: String(batch._id),
    businessAccountId: String(batch.businessAccountId),
    branchId: String(batch.branchId),
    status: batch.status,
    fileCount: batch.fileCount,
    readyCount: batch.readyCount,
    needsReviewCount: batch.needsReviewCount,
    invalidCount: batch.invalidCount,
    createdCount: batch.createdCount,
    failedCount: batch.failedCount,
    confirmedAt: batch.confirmedAt ?? null,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    entries: entries.map(serializeEntry)
  };
}

function canAccessBatch(request: Request, batch: InstanceType<typeof ShipmentImportBatch>) {
  const user = authenticatedUser(request);
  if (!user) return false;
  if (user.role === "client") return String(batch.uploadedBy) === String(user._id);
  return canAccessBranch(request, batch.branchId);
}

async function validateContext(request: Request, accountValue: string, branchValue: string) {
  const [businessAccount, branch] = await Promise.all([
    resolveBusinessAccount(accountValue),
    resolveBranch(branchValue)
  ]);
  if (!businessAccount) return { error: "Business account not found.", status: 404 } as const;
  if (!branch) return { error: "Sender branch not found.", status: 404 } as const;
  if (authenticatedUser(request)?.role !== "client" && !canAccessBranch(request, branch._id)) {
    return { error: "You do not have access to this branch.", status: 403 } as const;
  }
  if (!['approved', 'active'].includes(businessAccount.status)) {
    return { error: "The business account must be approved before importing shipment drafts.", status: 409 } as const;
  }
  if (!businessAccount.assignedBranch || String(businessAccount.assignedBranch) !== String(branch._id)) {
    return { error: "The selected branch is not assigned to this business account.", status: 403 } as const;
  }
  if (branch.status !== "ACTIVE") {
    return { error: "The assigned branch is not active.", status: 409 } as const;
  }
  return { businessAccount, branch } as const;
}

export async function downloadShipmentImportTemplate(_request: Request, response: Response) {
  const buffer = await buildShipmentImportTemplateWorkbook();
  response.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  response.setHeader("Content-Disposition", "attachment; filename=\"swiftline-shipment-import-template.xlsx\"");
  return response.status(200).send(buffer);
}

export async function createShipmentImportBatch(request: Request, response: Response) {
  const userId = authenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const files = uploadedFiles(request);
  if (!files.length) return response.status(400).json({ success: false, message: "Select at least one shipment .xlsx workbook." });
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > shipmentImportLimits.totalBytesPerBatch) {
    return response.status(400).json({ success: false, message: "The combined shipment import batch must be 25 MB or smaller." });
  }

  const accountValue = typeof request.body.businessAccountId === "string" ? request.body.businessAccountId : "";
  const branchValue = typeof request.body.branchId === "string" ? request.body.branchId : "";
  const context = await validateContext(request, accountValue, branchValue);
  if ("error" in context) return response.status(context.status ?? 500).json({ success: false, message: context.error });

  const batch = await ShipmentImportBatch.create({
    businessAccountId: context.businessAccount._id,
    branchId: context.branch._id,
    uploadedBy: userId,
    status: "PARSED",
    fileCount: files.length
  });
  const storedKeys: string[] = [];

  try {
    for (const [index, file] of files.entries()) {
      const storageKey = shipmentImportKey(String(batch._id), file.originalname);
      await putObject({ key: storageKey, body: file.buffer, contentType: file.mimetype, originalName: file.originalname });
      storedKeys.push(storageKey);

      let parsedData: ParsedShipmentImport | Record<string, never> = {};
      let warnings: string[] = [];
      let errors: string[] = [];
      try {
        parsedData = await parseShipmentImportWorkbook(file.buffer);
        warnings = parsedData.warnings;
        errors = parsedData.errors;
      } catch (error) {
        errors = error instanceof ShipmentImportParseError
          ? error.issues
          : [error instanceof Error ? error.message : "The shipment workbook could not be parsed."];
      }

      const status = errors.length ? "INVALID" : warnings.length ? "NEEDS_REVIEW" : "READY";
      await ShipmentImportEntry.create({
        batchId: batch._id,
        position: index + 1,
        originalFilename: file.originalname,
        storageKey,
        fileChecksum: checksumOf(file.buffer),
        parsedData,
        warnings,
        importErrors: errors,
        status
      });
    }
  } catch (error) {
    await Promise.all(storedKeys.map((key) => deleteObject(key).catch(() => undefined)));
    await ShipmentImportEntry.deleteMany({ batchId: batch._id });
    await ShipmentImportBatch.deleteOne({ _id: batch._id });
    throw error;
  }

  const counts = await ShipmentImportEntry.aggregate<{ _id: string; count: number }>([
    { $match: { batchId: batch._id } },
    { $group: { _id: "$status", count: { $sum: 1 } } }
  ]);
  const count = (status: string) => counts.find((item) => item._id === status)?.count ?? 0;
  batch.readyCount = count("READY");
  batch.needsReviewCount = count("NEEDS_REVIEW");
  batch.invalidCount = count("INVALID");
  await batch.save();

  await AuditLog.create({
    action: "SHIPMENT_IMPORT_UPLOADED",
    entityType: "SHIPMENT_IMPORT_BATCH",
    entityId: batch._id,
    performedBy: userId,
    performedAt: new Date(),
    metadata: {
      businessAccountId: batch.businessAccountId,
      branchId: batch.branchId,
      fileCount: batch.fileCount,
      readyCount: batch.readyCount,
      needsReviewCount: batch.needsReviewCount,
      invalidCount: batch.invalidCount
    }
  });

  return response.status(201).json({ success: true, batch: await serializeBatch(batch) });
}

export async function getShipmentImportBatch(request: Request, response: Response) {
  const userId = authenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });
  const batchId = String(request.params.batchId ?? "");
  if (!mongoose.Types.ObjectId.isValid(batchId)) return response.status(404).json({ success: false, message: "Shipment import batch not found." });
  const batch = await ShipmentImportBatch.findById(batchId).exec();
  if (!batch || !canAccessBatch(request, batch)) return response.status(404).json({ success: false, message: "Shipment import batch not found." });
  return response.status(200).json({ success: true, batch: await serializeBatch(batch) });
}

async function createDraftForEntry(input: {
  entry: InstanceType<typeof ShipmentImportEntry>;
  batch: InstanceType<typeof ShipmentImportBatch>;
  parsed: ParsedShipmentImport;
  branch: NonNullable<Awaited<ReturnType<typeof resolveBranch>>>;
  userId: mongoose.Types.ObjectId;
}) {
  const session = await mongoose.startSession();
  let createdDraft: InstanceType<typeof ShipmentDraft> | null = null;
  try {
    await session.withTransaction(async () => {
      const current = await ShipmentImportEntry.findOne({
        _id: input.entry._id,
        status: { $in: ["READY", "NEEDS_REVIEW", "CREATE_FAILED"] },
        shipmentDraftId: null
      }).session(session).exec();
      if (!current) return;

      const draft = new ShipmentDraft({
        creationSource: "SHIPMENT_IMPORT",
        shipmentImportEntryId: input.entry._id,
        businessAccountId: input.batch.businessAccountId,
        branchId: input.batch.branchId,
        sender: {
          branchId: input.branch._id,
          name: input.branch.name,
          code: input.branch.code,
          address: input.branch.address,
          contact: input.branch.contact
        },
        consignorAddress: {
          ...input.parsed.consignor,
          mobileCountryCode: "+91",
          countryCode: "IN",
          countryName: "India"
        },
        consigneeEnteredAddress: input.parsed.consignee,
        consigneeSelectedAddress: null,
        consigneeValidatedAddress: null,
        googlePlaceId: "",
        addressValidationStatus: "NOT_VALIDATED",
        addressValidationResult: {},
        parcelCount: input.parsed.parcels.length,
        parcelList: input.parsed.parcels.map((parcel) => ({
          sequence: parcel.sequence,
          weightKg: parcel.weightKg,
          lengthCm: parcel.lengthCm ?? undefined,
          widthCm: parcel.widthCm ?? undefined,
          heightCm: parcel.heightCm ?? undefined,
          shipmentContentType: parcel.shipmentContentType,
          items: parcel.items,
          contentsDescription: "",
          shipmentReference1: parcel.reference,
          shipmentReference2: ""
        })),
        csbType: input.parsed.csbType,
        insuranceOptIn: false,
        forceGst: false,
        declarationNote: input.parsed.declarationNote,
        serviceType: input.parsed.serviceType,
        serviceCode: env.DPD_DEFAULT_SERVICE_CODE,
        validationIssues: input.parsed.warnings,
        status: "NEEDS_REVIEW",
        bookingState: "EDITABLE",
        createdBy: input.userId
      });
      await draft.save({ session });

      current.status = "DRAFT_CREATED";
      current.shipmentDraftId = draft._id as mongoose.Types.ObjectId;
      await current.save({ session });

      await new AuditLog({
        action: "SHIPMENT_DRAFT_CREATED",
        entityType: "SHIPMENT_DRAFT",
        entityId: draft._id,
        performedBy: input.userId,
        performedAt: new Date(),
        metadata: {
          creationSource: "SHIPMENT_IMPORT",
          shipmentImportBatchId: input.batch._id,
          shipmentImportEntryId: current._id,
          businessAccountId: input.batch.businessAccountId,
          branchId: input.batch.branchId
        }
      }).save({ session });
      createdDraft = draft;
    });
  } finally {
    await session.endSession();
  }
  return createdDraft;
}

export async function createShipmentImportDrafts(request: Request, response: Response) {
  const userId = authenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });
  const parsedBody = createDraftsSchema.safeParse(request.body);
  if (!parsedBody.success) return response.status(400).json({ success: false, message: "Select at least one valid import entry." });
  const invalidId = parsedBody.data.entryIds.some((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalidId) return response.status(400).json({ success: false, message: "One or more selected import entries are invalid." });

  const batchId = String(request.params.batchId ?? "");
  if (!mongoose.Types.ObjectId.isValid(batchId)) return response.status(404).json({ success: false, message: "Shipment import batch not found." });
  const batch = await ShipmentImportBatch.findById(batchId).exec();
  if (!batch || !canAccessBatch(request, batch)) return response.status(404).json({ success: false, message: "Shipment import batch not found." });

  const idempotencyKey = String(request.header("Idempotency-Key") ?? "").trim();
  if (!idempotencyKey || idempotencyKey.length > 120) {
    return response.status(400).json({ success: false, message: "A valid Idempotency-Key header is required." });
  }
  if (batch.confirmationKey === idempotencyKey && batch.status !== "CREATING_DRAFTS") {
    return response.status(200).json({ success: true, duplicateRequest: true, batch: await serializeBatch(batch) });
  }

  const claimed = await ShipmentImportBatch.findOneAndUpdate(
    { _id: batch._id, status: { $in: ["PARSED", "PARTIAL", "FAILED"] } },
    { $set: { status: "CREATING_DRAFTS", confirmationKey: idempotencyKey, confirmedAt: new Date() } },
    { new: true }
  ).exec();
  if (!claimed) return response.status(409).json({ success: false, message: "This shipment import is already being processed or is complete." });

  const [branch, entries] = await Promise.all([
    Branch.findById(claimed.branchId).lean().exec(),
    ShipmentImportEntry.find({
      _id: { $in: parsedBody.data.entryIds.map((id) => new mongoose.Types.ObjectId(id)) },
      batchId: claimed._id
    }).sort({ position: 1 }).exec()
  ]);
  if (!branch) {
    claimed.status = "FAILED";
    await claimed.save();
    return response.status(409).json({ success: false, message: "The sender branch is no longer available." });
  }
  if (entries.length !== new Set(parsedBody.data.entryIds).size) {
    claimed.status = "PARSED";
    await claimed.save();
    return response.status(400).json({ success: false, message: "Every selected entry must belong to this import batch." });
  }

  for (const entry of entries) {
    if (entry.status === "INVALID" || entry.status === "DRAFT_CREATED") continue;
    try {
      await createDraftForEntry({
        entry,
        batch: claimed,
        parsed: entry.parsedData as unknown as ParsedShipmentImport,
        branch,
        userId
      });
    } catch (error) {
      entry.status = "CREATE_FAILED";
      entry.importErrors = [
        ...entry.importErrors,
        error instanceof Error ? error.message : "The shipment draft could not be created."
      ];
      await entry.save();
    }
  }

  const [createdCount, failedCount, remainingCount] = await Promise.all([
    ShipmentImportEntry.countDocuments({ batchId: claimed._id, status: "DRAFT_CREATED" }),
    ShipmentImportEntry.countDocuments({ batchId: claimed._id, status: "CREATE_FAILED" }),
    ShipmentImportEntry.countDocuments({ batchId: claimed._id, status: { $in: ["READY", "NEEDS_REVIEW"] } })
  ]);
  claimed.createdCount = createdCount;
  claimed.failedCount = failedCount;
  claimed.status = failedCount || remainingCount ? "PARTIAL" : "COMPLETED";
  await claimed.save();

  await AuditLog.create({
    action: "SHIPMENT_IMPORT_DRAFTS_CREATED",
    entityType: "SHIPMENT_IMPORT_BATCH",
    entityId: claimed._id,
    performedBy: userId,
    performedAt: new Date(),
    metadata: { selectedCount: entries.length, createdCount, failedCount, remainingCount }
  });

  return response.status(200).json({ success: true, duplicateRequest: false, batch: await serializeBatch(claimed) });
}
