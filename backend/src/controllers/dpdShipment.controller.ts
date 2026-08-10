import crypto from "crypto";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { env } from "../config/env.js";
import { AuditLog, type AuditEntityType } from "../models/auditLog.model.js";
import { Branch } from "../models/branch.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { InvoiceUpload } from "../models/invoiceUpload.model.js";
import { LabelDocument } from "../models/labelDocument.model.js";
import {
  ShipmentEvent,
  shipmentHoldReasonValues,
  shipmentOperationalStatusValues,
  type IShipmentEvent
} from "../models/shipmentEvent.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { counterPaymentMethodValues } from "../models/counterPayment.model.js";
import { recordCounterCollection } from "../services/individualCustomer.service.js";

// Present only on walk-in bookings; business shipments ignore it entirely.
const counterCollectionSchema = z.object({
  method: z.enum(counterPaymentMethodValues),
  reference: z.string().trim().max(80).optional(),
  note: z.string().trim().max(300).optional()
});
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import { ShipmentChargeVerification } from "../models/shipmentChargeVerification.model.js";
import { ShipmentCancellation } from "../models/shipmentCancellation.model.js";
import {
  DpdShipmentServiceError,
  createLabelForShipmentDraft,
  reconcileShipmentDocuments,
  resetSimulatedBookingForDevelopment
} from "../services/dpdShipment.service.js";
import {
  readShipmentBookingSnapshot,
  serializeShipmentBookingConfirmation
} from "../services/shipmentBookingSnapshot.service.js";
import { objectExists, streamObjectToResponse } from "../services/storage/storage.service.js";
import { buildPricingHash, ShipmentPriceChangedError } from "../services/shipmentCostEstimate.service.js";
import { RateCardRequiredError } from "../services/shipmentPricing.service.js";

const holdShipmentSchema = z.object({
  reason: z.enum(shipmentHoldReasonValues),
  note: z.string().trim().min(3).max(500)
});

const releaseShipmentSchema = z.object({
  note: z.string().trim().min(3).max(500)
});

const updateShipmentStatusSchema = z.object({
  status: z.enum(shipmentOperationalStatusValues),
  note: z.string().trim().max(500).optional().default("")
});

// The price the customer accepted, as returned by the cost estimate endpoint.
// Optional: booking paths that were never quoted through the estimator have no
// accepted price to check against.
const acceptedPricingSchema = z.object({
  acceptedPricingHash: z.string().trim().min(1).max(128).optional()
});

function getAuthenticatedUserId(request: Request): mongoose.Types.ObjectId | null {
  const user = (request as Request & { user?: { _id?: unknown } }).user;
  const id = user?._id;

  return id && mongoose.Types.ObjectId.isValid(String(id))
    ? new mongoose.Types.ObjectId(String(id))
    : null;
}

function serializeDpdShipment(shipment: {
  _id: unknown;
  shipmentDraftId: unknown;
  idempotencyKey: string;
  dpdShipmentId?: string;
  dpdTransactionId?: string;
  swiftlineTrackingNumber?: string;
  bookingProvider?: string;
  providerMode?: string;
  parcelNumbers: string[];
  serviceCode: string;
  status: string;
  snapshotRevision?: number;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: shipment._id,
    shipmentDraftId: shipment.shipmentDraftId,
    idempotencyKey: shipment.idempotencyKey,
    dpdShipmentId: shipment.dpdShipmentId ?? "",
    dpdTransactionId: shipment.dpdTransactionId ?? "",
    swiftlineTrackingNumber: shipment.swiftlineTrackingNumber ?? "",
    bookingProvider: shipment.bookingProvider ?? "DPD",
    providerMode: shipment.providerMode ?? "LIVE",
    parcelNumbers: shipment.parcelNumbers,
    serviceCode: shipment.serviceCode,
    status: shipment.status,
    snapshotRevision: shipment.snapshotRevision ?? 1,
    createdAt: shipment.createdAt,
    updatedAt: shipment.updatedAt
  };
}

function serializeLabel(label: {
  _id: unknown;
  dpdShipmentId: unknown;
  parcelNumber: string;
  labelType?: string;
  providerMode?: string;
  format: string;
  labelSize: string;
  fileChecksum: string;
  generatedAt: Date;
  downloadCount: number;
  lastDownloadedAt?: Date | null;
}) {
  return {
    id: label._id,
    dpdShipmentId: label.dpdShipmentId,
    parcelNumber: label.parcelNumber,
    labelType: label.labelType ?? "DPD",
    providerMode: label.providerMode ?? "LIVE",
    format: label.format,
    labelSize: label.labelSize,
    fileChecksum: label.fileChecksum,
    generatedAt: label.generatedAt,
    downloadCount: label.downloadCount,
    lastDownloadedAt: label.lastDownloadedAt ?? null
  };
}

function serializeShipmentDraftSummary(draft: {
  _id: unknown;
  invoiceUploadId: unknown;
  branchId: unknown;
  consigneeEnteredAddress: {
    companyName?: string;
    contactName?: string;
    postcode: string;
    townOrCity?: string;
  };
  status: string;
  addressValidationStatus: string;
} | null | undefined, snapshotValue?: unknown) {
  if (!draft) return null;
  const bookingSnapshot = readShipmentBookingSnapshot(snapshotValue);
  const consignee = bookingSnapshot?.consignee as Record<string, unknown> | undefined;

  return {
    id: draft._id,
    invoiceUploadId: draft.invoiceUploadId,
    branchId: draft.branchId,
    consigneeName: typeof consignee?.companyName === "string"
      ? consignee.companyName
      : draft.consigneeEnteredAddress.companyName || draft.consigneeEnteredAddress.contactName || "",
    consigneeTownOrCity: typeof consignee?.townOrCity === "string"
      ? consignee.townOrCity
      : draft.consigneeEnteredAddress.townOrCity ?? "",
    deliveryPostcode: typeof consignee?.postcode === "string"
      ? consignee.postcode
      : draft.consigneeEnteredAddress.postcode,
    status: draft.status,
    addressValidationStatus: draft.addressValidationStatus
  };
}

function serializeBranchSummary(branch: {
  _id: unknown;
  name: string;
  code: string;
  address?: {
    city?: string;
  };
} | null | undefined) {
  if (!branch) return null;

  return {
    id: branch._id,
    name: branch.name,
    code: branch.code,
    city: branch.address?.city ?? ""
  };
}

function serializeInvoiceUploadSummary(upload: {
  _id: unknown;
  invoiceNumber: string;
  shipmentReference: string;
  originalFilename: string;
} | null | undefined) {
  if (!upload) return null;

  return {
    id: upload._id,
    invoiceNumber: upload.invoiceNumber,
    shipmentReference: upload.shipmentReference,
    originalFilename: upload.originalFilename
  };
}

function formatShipmentEventLabel(value?: string | null) {
  if (!value) return "Shipment Created";
  return value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function serializeShipmentEvent(event: {
  _id: unknown;
  shipmentDraftId: unknown;
  dpdShipmentId?: unknown;
  status: string;
  holdReason?: string | null;
  note?: string;
  customerVisible: boolean;
  eventAt: Date;
  createdBy: unknown;
}) {
  return {
    id: event._id,
    shipmentDraftId: event.shipmentDraftId,
    dpdShipmentId: event.dpdShipmentId ?? null,
    status: event.status,
    statusLabel: formatShipmentEventLabel(event.status),
    holdReason: event.holdReason ?? null,
    note: event.note ?? "",
    customerVisible: event.customerVisible,
    eventAt: event.eventAt,
    createdBy: event.createdBy
  };
}

function getCurrentShipmentEvent<T extends { eventAt: Date; status: string }>(events: T[]) {
  return events.length ? events[0] : null;
}

async function ensureShipmentBookedEvent(params: {
  shipmentDraftId: mongoose.Types.ObjectId;
  dpdShipmentId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  eventAt?: Date;
}) {
  await ShipmentEvent.findOneAndUpdate(
    {
      shipmentDraftId: params.shipmentDraftId,
      status: "SHIPMENT_BOOKED"
    },
    {
      $setOnInsert: {
        shipmentDraftId: params.shipmentDraftId,
        dpdShipmentId: params.dpdShipmentId,
        status: "SHIPMENT_BOOKED",
        note: "Shipment booked with carrier.",
        customerVisible: true,
        createdBy: params.userId,
        eventAt: params.eventAt ?? new Date()
      }
    },
    { upsert: true }
  ).exec();
}

async function getShipmentEventsByDraftIds(draftIds: mongoose.Types.ObjectId[]) {
  if (!draftIds.length) return new Map<string, IShipmentEvent[]>();

  const events = await ShipmentEvent.find({ shipmentDraftId: { $in: draftIds } })
    .sort({ eventAt: -1, createdAt: -1 })
    .lean<IShipmentEvent[]>()
    .exec();
  const eventsByDraftId = new Map<string, IShipmentEvent[]>();

  for (const event of events) {
    const key = String(event.shipmentDraftId);
    eventsByDraftId.set(key, [...(eventsByDraftId.get(key) ?? []), event]);
  }

  return eventsByDraftId;
}

function serializeAuditLog(log: {
  _id: unknown;
  action: string;
  entityType: string;
  entityId: unknown;
  performedBy: unknown;
  performedAt: Date;
  metadata?: Record<string, unknown>;
}) {
  return {
    id: log._id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    performedBy: log.performedBy,
    performedAt: log.performedAt,
    metadata: log.metadata ?? {}
  };
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function signLabelAccessPayload(payload: string) {
  return crypto.createHmac("sha256", env.JWT_SECRET).update(payload).digest("base64url");
}

function createLabelAccessToken(params: {
  dpdShipmentId: string;
  labelId: string;
  userId: string;
  expiresAt: Date;
}) {
  const payload = encodeBase64Url(JSON.stringify({
    dpdShipmentId: params.dpdShipmentId,
    labelId: params.labelId,
    userId: params.userId,
    expiresAt: params.expiresAt.toISOString()
  }));
  const signature = signLabelAccessPayload(payload);

  return `${payload}.${signature}`;
}

function verifyLabelAccessToken(token: string) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expectedSignature = signLabelAccessPayload(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      dpdShipmentId?: unknown;
      labelId?: unknown;
      userId?: unknown;
      expiresAt?: unknown;
    };
    const expiresAt = typeof parsed.expiresAt === "string" ? new Date(parsed.expiresAt) : null;

    if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) return null;
    if (typeof parsed.dpdShipmentId !== "string" || !mongoose.Types.ObjectId.isValid(parsed.dpdShipmentId)) return null;
    if (typeof parsed.labelId !== "string" || !mongoose.Types.ObjectId.isValid(parsed.labelId)) return null;
    if (typeof parsed.userId !== "string" || !mongoose.Types.ObjectId.isValid(parsed.userId)) return null;

    return {
      dpdShipmentId: parsed.dpdShipmentId,
      labelId: parsed.labelId,
      userId: new mongoose.Types.ObjectId(parsed.userId),
      expiresAt
    };
  } catch {
    return null;
  }
}

function buildAbsoluteUrl(request: Request, path: string) {
  return `${request.protocol}://${request.get("host")}${path}`;
}

export async function buildStoredLabelAccess(params: {
  request: Request;
  dpdShipmentId: string;
  labelId: string;
  userId: mongoose.Types.ObjectId;
  disposition: "inline" | "attachment";
}) {
  if (!mongoose.Types.ObjectId.isValid(params.dpdShipmentId) || !mongoose.Types.ObjectId.isValid(params.labelId)) {
    return null;
  }

  const label = await LabelDocument.findOne({
    _id: new mongoose.Types.ObjectId(params.labelId),
    dpdShipmentId: new mongoose.Types.ObjectId(params.dpdShipmentId)
  }).lean().exec();
  if (!label) return null;

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const token = createLabelAccessToken({
    dpdShipmentId: params.dpdShipmentId,
    labelId: params.labelId,
    userId: String(params.userId),
    expiresAt
  });
  const path = `/api/v1/dpd-shipments/${params.dpdShipmentId}/label-file?token=${encodeURIComponent(token)}&disposition=${params.disposition}`;

  return {
    url: buildAbsoluteUrl(params.request, path),
    expiresAt,
    label: serializeLabel(label)
  };
}

async function sendStoredLabel(params: {
  label: InstanceType<typeof LabelDocument>;
  userId: mongoose.Types.ObjectId;
  response: Response;
  dpdShipmentId: string;
  accessMode: "authenticated" | "signed";
  disposition?: "inline" | "attachment";
}): Promise<Response | void> {
  const { label, userId, response, dpdShipmentId, accessMode } = params;

  if (!(await objectExists(label.storageKey))) {
    return response.status(404).json({
      success: false,
      message: "The shipment was created, but the label could not be stored. Contact an administrator."
    });
  }

  label.downloadCount += 1;
  label.lastDownloadedAt = new Date();
  await label.save();

  await AuditLog.create({
    action: "LABEL_DOWNLOADED",
    entityType: "LABEL_DOCUMENT",
    entityId: label._id,
    performedBy: userId,
    performedAt: new Date(),
    metadata: {
      dpdShipmentId,
      parcelNumber: label.parcelNumber,
      labelType: label.labelType,
      downloadCount: label.downloadCount,
      accessMode
    }
  });

  const extension = label.format.toLowerCase();

  return streamObjectToResponse({
    response,
    key: label.storageKey,
    contentType: label.format === "PDF" ? "application/pdf" : "text/plain",
    filename: `${label.labelType.toLowerCase()}-label-${label.parcelNumber}.${extension}`,
    disposition: params.disposition ?? "inline"
  });
}

async function createShipment(
  request: Request,
  response: Response,
  bookingProvider: "DPD" | "SWIFTLINE"
): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const shipmentDraftId = typeof request.params.id === "string" ? request.params.id : "";
  if (!mongoose.Types.ObjectId.isValid(shipmentDraftId)) {
    return response.status(404).json({ success: false, message: "Shipment draft not found" });
  }

  // A walk-in has already paid into a company account, so how that happened is
  // captured at booking. The draft decides the payment source: it cannot be
  // chosen by the caller, so a business shipment can never be booked as a counter
  // sale and skip its credit reservation.
  const draft = await ShipmentDraft.findById(shipmentDraftId).select("customerType branchId").lean().exec();
  if (!draft) return response.status(404).json({ success: false, message: "Shipment draft not found" });
  const isIndividual = draft.customerType === "INDIVIDUAL";

  const collection = counterCollectionSchema.safeParse(request.body ?? {});
  if (isIndividual && !collection.success) {
    return response.status(400).json({
      success: false,
      message: "Record how the customer paid before booking this shipment."
    });
  }

  const acceptedPricing = acceptedPricingSchema.safeParse(request.body ?? {});

  try {
    const result = await createLabelForShipmentDraft(shipmentDraftId, userId, {
      actor: "admin",
      paymentSource: isIndividual ? "ADMIN_DIRECT" : "BUSINESS_ACCOUNT",
      bookingProvider,
      acceptedPricingHash: acceptedPricing.success ? acceptedPricing.data.acceptedPricingHash : undefined
    });

    if (isIndividual && collection.success) {
      // Written after the booking succeeds: a failed booking must not leave a
      // record of money the branch never took.
      await recordCounterCollection({
        shipmentDraftId: new mongoose.Types.ObjectId(shipmentDraftId),
        branchId: draft.branchId,
        amountMinor: result.shipmentInvoice.totalAmountMinor,
        payment: collection.data,
        recordedBy: userId
      });
    }
    await ensureShipmentBookedEvent({
      shipmentDraftId: new mongoose.Types.ObjectId(shipmentDraftId),
      dpdShipmentId: result.dpdShipment._id as mongoose.Types.ObjectId,
      userId,
      eventAt: result.dpdShipment.createdAt
    });

    return response.status(result.reused ? 200 : 201).json({
      success: true,
      reused: result.reused,
      dpdShipment: serializeDpdShipment(result.dpdShipment),
      labels: result.labels.map(serializeLabel),
      bookingConfirmation: serializeShipmentBookingConfirmation(result.dpdShipment.bookingSnapshot),
      shipmentInvoice: {
        id: String(result.shipmentInvoice._id),
        invoiceNumber: result.shipmentInvoice.invoiceNumber,
        currency: result.shipmentInvoice.currency,
        totalAmountMinor: result.shipmentInvoice.totalAmountMinor,
        revision: result.shipmentInvoice.revision,
        status: result.shipmentInvoice.status
      }
    });
  } catch (error) {
    if (error instanceof RateCardRequiredError) {
      return response.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    }
    // The price moved between the estimate the booker accepted and this booking.
    // Nothing has been reserved or sent to the carrier; the updated breakdown goes
    // back so the panel can show what changed and ask for an explicit re-accept.
    if (error instanceof ShipmentPriceChangedError) {
      return response.status(error.statusCode).json({
        success: false,
        code: error.code,
        message: error.message,
        pricing: error.currentPricing,
        pricingHash: buildPricingHash(error.currentPricing)
      });
    }

    if (error instanceof DpdShipmentServiceError) {
      return response.status(error.statusCode).json({
        success: false,
        message: error.message,
        ...error.details
      });
    }

    return response.status(502).json({
      success: false,
      message: bookingProvider === "DPD"
        ? "DPD is temporarily unavailable."
        : "The Swiftline shipment could not be created."
    });
  }
}

export async function createDpdLabel(request: Request, response: Response): Promise<Response> {
  return createShipment(request, response, "DPD");
}

export async function createSwiftlineShipment(request: Request, response: Response): Promise<Response> {
  return createShipment(request, response, "SWIFTLINE");
}

export async function reconcileDpdShipmentDocuments(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  try {
    const result = await reconcileShipmentDocuments(String(request.params.id ?? ""), userId);
    return response.status(200).json({
      success: true,
      message: result.reused ? "Shipment documents are already complete." : "Shipment documents reconciled successfully.",
      dpdShipment: serializeDpdShipment(result.dpdShipment),
      labels: result.labels.map(serializeLabel),
      bookingConfirmation: serializeShipmentBookingConfirmation(result.dpdShipment.bookingSnapshot),
      shipmentInvoice: {
        id: String(result.shipmentInvoice._id),
        invoiceNumber: result.shipmentInvoice.invoiceNumber,
        currency: result.shipmentInvoice.currency,
        totalAmountMinor: result.shipmentInvoice.totalAmountMinor,
        revision: result.shipmentInvoice.revision,
        status: result.shipmentInvoice.status
      }
    });
  } catch (error) {
    if (error instanceof DpdShipmentServiceError) {
      return response.status(error.statusCode).json({ success: false, message: error.message, ...error.details });
    }
    return response.status(500).json({ success: false, message: "Shipment documents could not be reconciled." });
  }
}

export async function resetDevelopmentShipmentBooking(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  try {
    await resetSimulatedBookingForDevelopment(String(request.params.draftId ?? ""), userId);
    return response.status(200).json({
      success: true,
      message: "The simulated booking attempt was released. This draft can be booked again."
    });
  } catch (error) {
    if (error instanceof DpdShipmentServiceError) {
      return response.status(error.statusCode).json({ success: false, message: error.message, ...error.details });
    }
    return response.status(500).json({ success: false, message: "The simulated booking attempt could not be reset." });
  }
}

export async function createDpdLabelAccessUrl(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const dpdShipmentId = typeof request.params.id === "string" ? request.params.id : "";
  const labelId = typeof request.query.labelId === "string" ? request.query.labelId : "";
  const access = await buildStoredLabelAccess({
    request,
    dpdShipmentId,
    labelId,
    userId,
    disposition: request.query.disposition === "attachment" ? "attachment" : "inline"
  });
  if (!access) return response.status(404).json({ success: false, message: "Label not found" });

  return response.status(200).json({
    success: true,
    ...access
  });
}

export async function listDpdShipmentAudit(request: Request, response: Response): Promise<Response> {
  const shipmentDraftId = typeof request.params.draftId === "string" ? request.params.draftId : "";
  if (!mongoose.Types.ObjectId.isValid(shipmentDraftId)) {
    return response.status(404).json({ success: false, message: "Shipment draft not found" });
  }

  const draftObjectId = new mongoose.Types.ObjectId(shipmentDraftId);
  const draft = await ShipmentDraft.findById(draftObjectId).lean().exec();
  if (!draft) return response.status(404).json({ success: false, message: "Shipment draft not found" });

  const dpdShipment = await DpdShipment.findOne({ shipmentDraftId: draftObjectId }).lean().exec();
  const labels = dpdShipment
    ? await LabelDocument.find({ dpdShipmentId: dpdShipment._id }).lean().exec()
    : [];

  const entityFilters: Array<{ entityType: AuditEntityType; entityId: mongoose.Types.ObjectId }> = [
    { entityType: "SHIPMENT_DRAFT", entityId: draft._id },
    { entityType: "INVOICE_UPLOAD", entityId: draft.invoiceUploadId }
  ];

  if (dpdShipment) {
    entityFilters.push({ entityType: "DPD_SHIPMENT", entityId: dpdShipment._id });
  }

  for (const label of labels) {
    entityFilters.push({ entityType: "LABEL_DOCUMENT", entityId: label._id });
  }

  const auditLogs = await AuditLog.find({ $or: entityFilters })
    .sort({ performedAt: -1 })
    .limit(100)
    .lean()
    .exec();

  return response.status(200).json({
    success: true,
    auditLogs: auditLogs.map(serializeAuditLog)
  });
}

export async function listDpdShipments(request: Request, response: Response): Promise<Response> {
  const limitValue = typeof request.query.limit === "string" ? Number(request.query.limit) : 25;
  const limit = Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 1), 100) : 25;
  const status = typeof request.query.status === "string" ? request.query.status : "";
  const trackingNumber = typeof request.query.trackingNumber === "string" ? request.query.trackingNumber.trim() : "";
  const filters: Record<string, unknown> = {};

  if (status) filters.status = status;
  if (trackingNumber) {
    const exact = new RegExp(`^${trackingNumber.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    const trackingFilters: Record<string, unknown>[] = [
      { dpdShipmentId: exact },
      { swiftlineTrackingNumber: exact },
      { parcelNumbers: exact }
    ];
    const matchingSwiftlineShipmentIds = await LabelDocument.find({
      parcelNumber: exact,
      labelType: "SWIFTLINE",
      voidedAt: null
    }).distinct("dpdShipmentId").exec();
    if (matchingSwiftlineShipmentIds.length) trackingFilters.push({ _id: { $in: matchingSwiftlineShipmentIds } });
    filters.$or = trackingFilters;
  }

  const shipments = await DpdShipment.find(filters).sort({ createdAt: -1 }).limit(limit).lean().exec();
  const shipmentIds = shipments.map((shipment) => shipment._id);
  const draftIds = shipments.map((shipment) => shipment.shipmentDraftId);
  const [labels, drafts] = await Promise.all([
    LabelDocument.find({ dpdShipmentId: { $in: shipmentIds } }).lean().exec(),
    ShipmentDraft.find({ _id: { $in: draftIds } }).lean().exec()
  ]);
  const invoiceUploadIds = drafts.map((draft) => draft.invoiceUploadId);
  const branchIds = drafts.map((draft) => draft.branchId);
  const [invoiceUploads, branches, shipmentInvoices] = await Promise.all([
    InvoiceUpload.find({ _id: { $in: invoiceUploadIds } }).lean().exec(),
    Branch.find({ _id: { $in: branchIds } }).lean().exec(),
    ShipmentInvoice.find({ shipmentDraftId: { $in: draftIds } })
      .select("shipmentDraftId invoiceNumber currency totalAmountMinor status revision")
      .lean()
      .exec()
  ]);
  const eventsByDraftId = await getShipmentEventsByDraftIds(draftIds as mongoose.Types.ObjectId[]);
  const labelsByShipment = new Map<string, typeof labels>();
  const draftsById = new Map(drafts.map((draft) => [String(draft._id), draft]));
  const uploadsById = new Map(invoiceUploads.map((upload) => [String(upload._id), upload]));
  const branchesById = new Map(branches.map((branch) => [String(branch._id), branch]));
  const shipmentInvoicesByDraftId = new Map(shipmentInvoices.map((invoice) => [String(invoice.shipmentDraftId), invoice]));

  for (const label of labels) {
    const key = String(label.dpdShipmentId);
    labelsByShipment.set(key, [...(labelsByShipment.get(key) ?? []), label]);
  }

  return response.status(200).json({
    success: true,
    shipments: shipments.map((shipment) => {
      const draft = draftsById.get(String(shipment.shipmentDraftId));
      const upload = draft ? uploadsById.get(String(draft.invoiceUploadId)) : null;
      const branch = draft ? branchesById.get(String(draft.branchId)) : null;
      const events = eventsByDraftId.get(String(shipment.shipmentDraftId)) ?? [];
      const currentEvent = getCurrentShipmentEvent(events);
      const shipmentInvoice = shipmentInvoicesByDraftId.get(String(shipment.shipmentDraftId));

      return {
        dpdShipment: serializeDpdShipment(shipment),
        bookingConfirmation: serializeShipmentBookingConfirmation(shipment.bookingSnapshot),
        shipmentDraft: serializeShipmentDraftSummary(
          draft,
          (shipmentInvoice?.revision ?? 1) <= (shipment.snapshotRevision || 1)
            ? shipment.currentShipmentSnapshot || shipment.bookingSnapshot
            : null
        ),
        branch: serializeBranchSummary(branch),
        invoiceUpload: serializeInvoiceUploadSummary(upload),
        shipmentInvoice: shipmentInvoice ? {
          invoiceNumber: shipmentInvoice.invoiceNumber,
          currency: shipmentInvoice.currency,
          totalAmountMinor: shipmentInvoice.totalAmountMinor,
          chargeableAmountMinor: shipmentInvoice.totalAmountMinor,
          status: shipmentInvoice.status,
          revision: shipmentInvoice.revision
        } : null,
        labels: (labelsByShipment.get(String(shipment._id)) ?? [])
          .filter((label) => label.labelVersion === (shipment.snapshotRevision || 1))
          .map(serializeLabel),
        currentEvent: currentEvent ? serializeShipmentEvent(currentEvent) : null,
        events: events.map(serializeShipmentEvent)
      };
    })
  });
}

export async function getDpdShipment(request: Request, response: Response): Promise<Response> {
  const dpdShipmentId = typeof request.params.id === "string" ? request.params.id : "";
  if (!mongoose.Types.ObjectId.isValid(dpdShipmentId)) {
    return response.status(404).json({ success: false, message: "DPD shipment not found" });
  }

  const shipment = await DpdShipment.findById(dpdShipmentId).lean().exec();
  if (!shipment) return response.status(404).json({ success: false, message: "DPD shipment not found" });

  const [labels, events] = await Promise.all([
    LabelDocument.find({
      dpdShipmentId: shipment._id,
      labelVersion: shipment.snapshotRevision || 1
    }).lean().exec(),
    ShipmentEvent.find({ shipmentDraftId: shipment.shipmentDraftId })
      .sort({ eventAt: -1, createdAt: -1 })
      .lean()
      .exec()
  ]);
  const currentEvent = getCurrentShipmentEvent(events);

  return response.status(200).json({
    success: true,
    dpdShipment: serializeDpdShipment(shipment),
    labels: labels.map(serializeLabel),
    currentEvent: currentEvent ? serializeShipmentEvent(currentEvent) : null,
    events: events.map(serializeShipmentEvent)
  });
}

export async function holdDpdShipment(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const dpdShipmentId = typeof request.params.id === "string" ? request.params.id : "";
  if (!mongoose.Types.ObjectId.isValid(dpdShipmentId)) {
    return response.status(404).json({ success: false, message: "DPD shipment not found" });
  }

  const parsed = holdShipmentSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      success: false,
      message: "Hold reason and note are required.",
      errors: parsed.error.format()
    });
  }

  const shipment = await DpdShipment.findById(dpdShipmentId).lean().exec();
  if (!shipment) return response.status(404).json({ success: false, message: "DPD shipment not found" });

  const cancellation = await ShipmentCancellation.findOne({
    shipmentDraftId: shipment.shipmentDraftId,
    status: { $in: ["REQUESTED", "COMPLETED"] }
  }).select("status").lean().exec();
  if (cancellation) {
    return response.status(409).json({
      success: false,
      message: cancellation.status === "COMPLETED"
        ? "This shipment has been cancelled and cannot be placed on hold."
        : "Resolve the pending shipment cancellation before placing the shipment on hold."
    });
  }

  const latestEvent = await ShipmentEvent.findOne({ shipmentDraftId: shipment.shipmentDraftId })
    .sort({ eventAt: -1, createdAt: -1 })
    .lean()
    .exec();
  if (latestEvent?.status === "ON_HOLD") {
    return response.status(409).json({ success: false, message: "Shipment is already on hold." });
  }

  const event = await ShipmentEvent.create({
    shipmentDraftId: shipment.shipmentDraftId,
    dpdShipmentId: shipment._id,
    status: "ON_HOLD",
    holdReason: parsed.data.reason,
    note: parsed.data.note,
    customerVisible: true,
    createdBy: userId,
    eventAt: new Date()
  });

  await AuditLog.create({
    action: "SHIPMENT_HELD",
    entityType: "DPD_SHIPMENT",
    entityId: shipment._id,
    performedBy: userId,
    performedAt: new Date(),
    metadata: {
      shipmentDraftId: shipment.shipmentDraftId,
      reason: parsed.data.reason,
      note: parsed.data.note
    }
  });

  return response.status(201).json({
    success: true,
    message: "Shipment placed on hold.",
    event: serializeShipmentEvent(event)
  });
}

export async function releaseDpdShipment(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const dpdShipmentId = typeof request.params.id === "string" ? request.params.id : "";
  if (!mongoose.Types.ObjectId.isValid(dpdShipmentId)) {
    return response.status(404).json({ success: false, message: "DPD shipment not found" });
  }

  const parsed = releaseShipmentSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      success: false,
      message: "Release note is required.",
      errors: parsed.error.format()
    });
  }

  const shipment = await DpdShipment.findById(dpdShipmentId).lean().exec();
  if (!shipment) return response.status(404).json({ success: false, message: "DPD shipment not found" });

  const cancellation = await ShipmentCancellation.findOne({
    shipmentDraftId: shipment.shipmentDraftId,
    status: { $in: ["REQUESTED", "COMPLETED"] }
  }).select("status").lean().exec();
  if (cancellation) {
    return response.status(409).json({
      success: false,
      message: cancellation.status === "COMPLETED"
        ? "This shipment has been cancelled and cannot be released from hold."
        : "Resolve the pending shipment cancellation before releasing the shipment."
    });
  }

  const latestEvent = await ShipmentEvent.findOne({ shipmentDraftId: shipment.shipmentDraftId })
    .sort({ eventAt: -1, createdAt: -1 })
    .lean()
    .exec();
  if (latestEvent?.status !== "ON_HOLD") {
    return response.status(409).json({ success: false, message: "Shipment is not currently on hold." });
  }

  const event = await ShipmentEvent.create({
    shipmentDraftId: shipment.shipmentDraftId,
    dpdShipmentId: shipment._id,
    status: "RELEASED_FROM_HOLD",
    note: parsed.data.note,
    customerVisible: true,
    createdBy: userId,
    eventAt: new Date()
  });

  await AuditLog.create({
    action: "SHIPMENT_RELEASED",
    entityType: "DPD_SHIPMENT",
    entityId: shipment._id,
    performedBy: userId,
    performedAt: new Date(),
    metadata: {
      shipmentDraftId: shipment.shipmentDraftId,
      note: parsed.data.note
    }
  });

  return response.status(201).json({
    success: true,
    message: "Shipment released from hold.",
    event: serializeShipmentEvent(event)
  });
}

export async function updateDpdShipmentOperationalStatus(request: Request, response: Response): Promise<Response> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const dpdShipmentId = typeof request.params.id === "string" ? request.params.id : "";
  if (!mongoose.Types.ObjectId.isValid(dpdShipmentId)) {
    return response.status(404).json({ success: false, message: "DPD shipment not found" });
  }

  const parsed = updateShipmentStatusSchema.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({
      success: false,
      message: "Shipment status is invalid.",
      errors: parsed.error.format()
    });
  }

  const shipment = await DpdShipment.findById(dpdShipmentId).lean().exec();
  if (!shipment) return response.status(404).json({ success: false, message: "DPD shipment not found" });

  const cancellation = await ShipmentCancellation.findOne({
    shipmentDraftId: shipment.shipmentDraftId,
    status: { $in: ["REQUESTED", "COMPLETED"] }
  }).select("status").lean().exec();
  if (cancellation) {
    return response.status(409).json({
      success: false,
      message: cancellation.status === "COMPLETED"
        ? "This shipment has been cancelled and its progress cannot be updated."
        : "Resolve the pending shipment cancellation before updating shipment progress."
    });
  }

  const latestEvent = await ShipmentEvent.findOne({ shipmentDraftId: shipment.shipmentDraftId })
    .sort({ eventAt: -1, createdAt: -1 })
    .lean()
    .exec();
  if (latestEvent?.status === "ON_HOLD") {
    return response.status(409).json({ success: false, message: "Release the shipment before updating its status." });
  }

  if (
    parsed.data.status === "WAREHOUSE_SCAN_IN"
    && !(await ShipmentChargeVerification.exists({ dpdShipmentId: shipment._id }))
  ) {
    return response.status(409).json({
      success: false,
      message: "Verify the final shipment weight and charge before Warehouse Scan In."
    });
  }

  const event = await ShipmentEvent.create({
    shipmentDraftId: shipment.shipmentDraftId,
    dpdShipmentId: shipment._id,
    status: parsed.data.status,
    note: parsed.data.note || "Live action updated by Swiftline Operations",
    customerVisible: true,
    createdBy: userId,
    eventAt: new Date()
  });

  await AuditLog.create({
    action: "SHIPMENT_STATUS_UPDATED",
    entityType: "DPD_SHIPMENT",
    entityId: shipment._id,
    performedBy: userId,
    performedAt: new Date(),
    metadata: {
      shipmentDraftId: shipment.shipmentDraftId,
      status: parsed.data.status,
      note: parsed.data.note
    }
  });

  return response.status(201).json({
    success: true,
    message: "Shipment status updated.",
    event: serializeShipmentEvent(event)
  });
}

export async function downloadDpdLabel(request: Request, response: Response): Promise<Response | void> {
  const userId = getAuthenticatedUserId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const dpdShipmentId = typeof request.params.id === "string" ? request.params.id : "";
  if (!mongoose.Types.ObjectId.isValid(dpdShipmentId)) {
    return response.status(404).json({ success: false, message: "DPD shipment not found" });
  }

  const labelId = typeof request.query.labelId === "string" ? request.query.labelId : "";
  const label = await LabelDocument.findOne({
    dpdShipmentId: new mongoose.Types.ObjectId(dpdShipmentId),
    ...(mongoose.Types.ObjectId.isValid(labelId)
      ? { _id: new mongoose.Types.ObjectId(labelId) }
      : { labelType: "DPD" })
  }).exec();
  if (!label) return response.status(404).json({ success: false, message: "Label not found" });

  return sendStoredLabel({
    label,
    userId,
    response,
    dpdShipmentId,
    accessMode: "authenticated",
    disposition: "inline"
  });
}

export async function downloadDpdLabelWithToken(request: Request, response: Response): Promise<Response | void> {
  const dpdShipmentId = typeof request.params.id === "string" ? request.params.id : "";
  const token = typeof request.query.token === "string" ? request.query.token : "";
  const tokenPayload = verifyLabelAccessToken(token);

  if (!mongoose.Types.ObjectId.isValid(dpdShipmentId) || !tokenPayload || tokenPayload.dpdShipmentId !== dpdShipmentId) {
    return response.status(401).json({ success: false, message: "Label link has expired or is invalid." });
  }

  const label = await LabelDocument.findOne({
    _id: new mongoose.Types.ObjectId(tokenPayload.labelId),
    dpdShipmentId: new mongoose.Types.ObjectId(dpdShipmentId)
  }).exec();
  if (!label) return response.status(404).json({ success: false, message: "Label not found" });

  return sendStoredLabel({
    label,
    userId: tokenPayload.userId,
    response,
    dpdShipmentId,
    accessMode: "signed",
    disposition: request.query.disposition === "attachment" ? "attachment" : "inline"
  });
}
