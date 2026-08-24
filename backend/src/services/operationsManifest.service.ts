import crypto from "crypto";
import mongoose from "mongoose";
import PDFDocument from "pdfkit";
import { AuditLog, type AuditAction } from "../models/auditLog.model.js";
import { Branch } from "../models/branch.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { LabelDocument } from "../models/labelDocument.model.js";
import { OperationsManifest, type IOperationsManifest } from "../models/operationsManifest.model.js";
import { OperationsManifestBag } from "../models/operationsManifestBag.model.js";
import { OperationsManifestConsignment } from "../models/operationsManifestConsignment.model.js";
import { OperationsManifestCounter } from "../models/operationsManifestCounter.model.js";
import {
  OperationsManifestScan,
  type OperationsScanSource
} from "../models/operationsManifestScan.model.js";
import { OperationsManifestScanSession } from "../models/operationsManifestScanSession.model.js";
import { ShipmentEvent } from "../models/shipmentEvent.model.js";
import { ShipmentCancellation } from "../models/shipmentCancellation.model.js";
import { ShipmentManifest, type IShipmentManifest } from "../models/shipmentManifest.model.js";
import {
  buildManifestLine,
  buildShipmentManifestWorkbook,
  fixedPartyAddressRows,
  formatManifestConsignmentNumber,
  formatManifestOrigin
} from "./shipmentManifest.service.js";
import {
  buildManifestDocumentModel,
  parseSealedSnapshot,
  type SealedSnapshot
} from "./manifestDocument.service.js";
import {
  parcelDeclaredGoodsValueMinor,
  readShipmentBookingSnapshot,
  snapshotDeclaredGoodsValueMinor,
  type ShipmentBookingSnapshot
} from "./shipmentBookingSnapshot.service.js";
import { dateRangeCondition } from "../utils/dateRangeFilter.js";
import {
  findMissingPrerequisites,
  formatShipmentEventLabel
} from "./shipmentStatusSequence.service.js";
import { resolveShipmentEventNote } from "./shipmentEventCopy.service.js";

export class OperationsManifestServiceError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
  }
}

const editableStatuses = ["DRAFT", "PACKING", "READY_TO_SEAL"] as const;

function isEditable(manifest: IOperationsManifest) {
  return editableStatuses.includes(manifest.status as (typeof editableStatuses)[number]);
}

export async function allocateOperationsManifestNumber(session?: mongoose.ClientSession) {
  // A single running sequence gives the plain SLC001, SLC002, … numbers operations use.
  const counter = await OperationsManifestCounter.findOneAndUpdate(
    { _id: "operations-manifest" },
    { $inc: { sequence: 1 } },
    { upsert: true, returnDocument: "after", session }
  ).exec();
  if (!counter) throw new OperationsManifestServiceError("Manifest number could not be generated.", 500);
  return `SLC${String(counter.sequence).padStart(3, "0")}`;
}

async function audit(
  action: AuditAction,
  manifestId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
  metadata: Record<string, unknown>,
  session?: mongoose.ClientSession
) {
  await AuditLog.create([{
    action,
    entityType: "OPERATIONS_MANIFEST",
    entityId: manifestId,
    performedBy: userId,
    performedAt: new Date(),
    metadata
  }], { session });
}

function asObjectId(value: string, label: string) {
  if (!mongoose.Types.ObjectId.isValid(value)) throw new OperationsManifestServiceError(`${label} was not found.`, 404);
  return new mongoose.Types.ObjectId(value);
}

function roundWeight(value: number) {
  return Number(value.toFixed(3));
}

export function calculateScannedParcelWeight(consignment: {
  scannedParcelNumbers: string[];
  parcelWeightSnapshots?: Array<{ parcelNumber: string; weightKg: number }>;
}) {
  const scanned = new Set(consignment.scannedParcelNumbers);
  return roundWeight((consignment.parcelWeightSnapshots ?? []).reduce(
    (total, parcel) => total + (scanned.has(parcel.parcelNumber) ? parcel.weightKg : 0),
    0
  ));
}

type ParcelValueSnapshot = { parcelNumber: string; valueMinor?: number | null };

function snapshotParcelValueMinor(parcel: ShipmentBookingSnapshot["parcels"][number]) {
  const stored = parcel.declaredGoodsValueMinor;
  if (typeof stored === "number" && stored > 0) return stored;
  const derived = parcelDeclaredGoodsValueMinor(parcel);
  return derived > 0 ? derived : null;
}

function fillMissingParcelValues(
  snapshots: Array<{ parcelNumber: string; valueMinor?: number | null }>,
  shipmentSnapshot: ShipmentBookingSnapshot
) {
  const values = new Map(
    shipmentSnapshot.parcels.map((parcel) => [
      parcel.swiftlineParcelNumber.toUpperCase(),
      snapshotParcelValueMinor(parcel)
    ])
  );
  let changed = false;
  for (const parcel of snapshots) {
    if (parcel.valueMinor != null) continue;
    const value = values.get(parcel.parcelNumber.toUpperCase());
    if (value == null) continue;
    parcel.valueMinor = value;
    changed = true;
  }
  return changed;
}

/** The declared value of each scanned parcel, in scan order. */
export function scannedParcelValues(consignment: {
  scannedParcelNumbers: string[];
  parcelWeightSnapshots?: ParcelValueSnapshot[];
}) {
  const valueByParcel = new Map((consignment.parcelWeightSnapshots ?? []).map((parcel) => [parcel.parcelNumber, parcel.valueMinor ?? null]));
  return consignment.scannedParcelNumbers.map((parcelNumber) => ({ parcelNumber, valueMinor: valueByParcel.get(parcelNumber) ?? null }));
}

/** Sum of the scanned parcels' declared values; null until every one has a value. */
export function consignmentDeclaredValueMinor(consignment: {
  scannedParcelNumbers: string[];
  parcelWeightSnapshots?: ParcelValueSnapshot[];
}) {
  const values = scannedParcelValues(consignment);
  if (!values.length || values.some((parcel) => !parcel.valueMinor)) return null;
  return values.reduce((total, parcel) => total + (parcel.valueMinor ?? 0), 0);
}

export function formatOperationsBagNumber(manifestNumber: string, bagSequence: number) {
  // The MHBS is the manifest number with a two-digit bag suffix: SLC012 → SLC01201.
  return `${manifestNumber}${String(bagSequence).padStart(2, "0")}`;
}

export function isOperationsBagWeightAllowed(weightKg: number) {
  return roundWeight(weightKg) <= 31;
}

type ScannedParcelRef = { bagId?: unknown; parcelNumber: string; consignmentId?: unknown };

/**
 * A consignment's parcels may be packed across several bags, so a bag's contents
 * are derived from its accepted parcel scans rather than from the consignment's
 * primary bag. `consignment.bagId` only records where its first parcel landed.
 */
export function summarizeBagComposition(
  scans: ScannedParcelRef[],
  consignments: Array<{ parcelWeightSnapshots?: Array<{ parcelNumber: string; weightKg: number }> }>
) {
  const weightByParcel = new Map<string, number>();
  for (const consignment of consignments) {
    for (const parcel of consignment.parcelWeightSnapshots ?? []) weightByParcel.set(parcel.parcelNumber, parcel.weightKg);
  }

  const byBag = new Map<string, { parcelCount: number; weightKg: number; consignmentIds: Set<string> }>();
  for (const scan of scans) {
    if (!scan.bagId) continue;
    const key = String(scan.bagId);
    const entry = byBag.get(key) ?? { parcelCount: 0, weightKg: 0, consignmentIds: new Set<string>() };
    entry.parcelCount += 1;
    entry.weightKg = roundWeight(entry.weightKg + (weightByParcel.get(scan.parcelNumber) ?? 0));
    if (scan.consignmentId) entry.consignmentIds.add(String(scan.consignmentId));
    byBag.set(key, entry);
  }
  return byBag;
}

function bagIdsForConsignment(scans: ScannedParcelRef[], consignmentId: unknown) {
  const seen: string[] = [];
  for (const scan of scans) {
    if (String(scan.consignmentId ?? "") !== String(consignmentId) || !scan.bagId) continue;
    const bagId = String(scan.bagId);
    if (!seen.includes(bagId)) seen.push(bagId);
  }
  return seen;
}

async function recalculateTotals(manifestId: mongoose.Types.ObjectId, session?: mongoose.ClientSession) {
  const [bags, consignments, acceptedScans] = await Promise.all([
    OperationsManifestBag.find({ manifestId, status: { $ne: "CANCELLED" } }).session(session ?? null).exec(),
    OperationsManifestConsignment.find({ manifestId, status: { $ne: "REMOVED" } }).session(session ?? null).exec(),
    OperationsManifestScan.find({ manifestId, status: "ACCEPTED" })
      .select("bagId parcelNumber consignmentId")
      .session(session ?? null)
      .lean()
      .exec()
  ]);

  const composition = summarizeBagComposition(acceptedScans, consignments);
  for (const bag of bags) {
    const entry = composition.get(String(bag._id));
    bag.totalConsignments = entry?.consignmentIds.size ?? 0;
    bag.totalPhysicalParcels = entry?.parcelCount ?? 0;
    bag.totalWeightKg = roundWeight(entry?.weightKg ?? 0);
    await bag.save({ session });
  }

  const manifest = await OperationsManifest.findById(manifestId).session(session ?? null).exec();
  if (!manifest) throw new OperationsManifestServiceError("Operations manifest was not found.", 404);
  manifest.totalBags = bags.length;
  manifest.totalConsignments = consignments.length;
  manifest.totalPhysicalParcels = acceptedScans.length;
  manifest.totalWeightKg = roundWeight(consignments.reduce((sum, item) => sum + item.weightKg, 0));

  if (isEditable(manifest)) {
    if (!acceptedScans.length) manifest.status = "DRAFT";
    else {
      // Closed bags mean packing is finished. Part-scanned consignments do not hold
      // the manifest back, because a held-back box is a normal operational outcome.
      const allBagsClosed = bags.length > 0 && bags.every((bag) => bag.status === "CLOSED");
      manifest.status = allBagsClosed ? "READY_TO_SEAL" : "PACKING";
    }
  }
  await manifest.save({ session });
  return manifest;
}

function serializeManifest(manifest: IOperationsManifest) {
  return {
    id: String(manifest._id),
    manifestNumber: manifest.manifestNumber,
    branchId: String(manifest.branchId),
    header: manifest.header,
    status: manifest.status,
    totalBags: manifest.totalBags,
    totalConsignments: manifest.totalConsignments,
    totalPhysicalParcels: manifest.totalPhysicalParcels,
    totalWeightKg: manifest.totalWeightKg,
    sealedAt: manifest.sealedAt,
    dispatchedAt: manifest.dispatchedAt,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt
  };
}

export async function listOperationsManifests(input: {
  page: number;
  limit: number;
  status?: string;
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
  allowedBranchIds?: string[] | null;
}) {
  const filter: Record<string, unknown> = {};
  if (input.status) filter.status = input.status;
  if (input.branchId && mongoose.Types.ObjectId.isValid(input.branchId)) {
    filter.branchId = input.branchId;
  } else if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined) {
    filter.branchId = { $in: input.allowedBranchIds };
  }
  const createdAt = dateRangeCondition(input.dateFrom, input.dateTo);
  if (createdAt) filter.createdAt = createdAt;
  const skip = (input.page - 1) * input.limit;
  const [items, total] = await Promise.all([
    OperationsManifest.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(input.limit).lean().exec(),
    OperationsManifest.countDocuments(filter).exec()
  ]);
  const branchIds = [...new Set(items.map((item) => String(item.branchId)))];
  const branches = await Branch.find({ _id: { $in: branchIds } }).select("name code").lean().exec();
  const branchById = new Map(branches.map((branch) => [String(branch._id), branch]));
  return {
    items: items.map((item) => ({ ...serializeManifest(item as unknown as IOperationsManifest), branch: branchById.get(String(item.branchId)) ?? null })),
    pagination: { page: input.page, limit: input.limit, total, pages: Math.max(1, Math.ceil(total / input.limit)) }
  };
}

export async function createOperationsManifest(input: {
  branchId: string;
  header: IOperationsManifest["header"];
  userId: mongoose.Types.ObjectId;
}) {
  const branchId = asObjectId(input.branchId, "Branch");
  const branch = await Branch.findOne({ _id: branchId, status: "ACTIVE" }).exec();
  if (!branch) throw new OperationsManifestServiceError("Select an active Swiftline branch.", 409);
  const manifestNumber = await allocateOperationsManifestNumber();
  const manifest = await OperationsManifest.create({
    manifestNumber,
    branchId,
    header: input.header,
    status: "DRAFT",
    createdBy: input.userId
  });
  await audit("OPERATIONS_MANIFEST_CREATED", manifest._id as mongoose.Types.ObjectId, input.userId, { manifestNumber, branchId });
  // Packing always starts with an open bag, so the operator can scan immediately.
  await openNextBag(manifest, input.userId);
  await recalculateTotals(manifest._id as mongoose.Types.ObjectId);
  return manifest;
}

export async function updateOperationsManifest(input: {
  manifestId: string;
  header: IOperationsManifest["header"];
  userId: mongoose.Types.ObjectId;
}) {
  const manifest = await OperationsManifest.findById(asObjectId(input.manifestId, "Operations manifest")).exec();
  if (!manifest) throw new OperationsManifestServiceError("Operations manifest was not found.", 404);
  if (!isEditable(manifest)) throw new OperationsManifestServiceError("A sealed, dispatched or cancelled manifest cannot be edited.", 409);
  manifest.header = input.header;
  await manifest.save();
  await audit("OPERATIONS_MANIFEST_UPDATED", manifest._id as mongoose.Types.ObjectId, input.userId, { headerUpdated: true });
  return manifest;
}

/** Opens the next sequential bag. Shared by manual creation, manifest setup, and packing overflow. */
async function openNextBag(
  manifest: IOperationsManifest,
  userId: mongoose.Types.ObjectId,
  session?: mongoose.ClientSession
) {
  const manifestId = manifest._id as mongoose.Types.ObjectId;
  const latest = await OperationsManifestBag.findOne({ manifestId }).sort({ sequence: -1 }).session(session ?? null).exec();
  const sequence = (latest?.sequence ?? 0) + 1;
  const bagNumber = formatOperationsBagNumber(manifest.manifestNumber, sequence);
  const created = await OperationsManifestBag.create([{
    manifestId,
    sequence,
    bagNumber,
    barcode: bagNumber,
    status: "OPEN",
    createdBy: userId
  }], { session });
  const bag = created[0];
  if (!bag) throw new OperationsManifestServiceError("Bag could not be created.", 500);
  await audit("OPERATIONS_BAG_CREATED", manifestId, userId, { bagId: bag._id, bagNumber }, session);
  return bag;
}

export async function createOperationsBag(manifestIdValue: string, userId: mongoose.Types.ObjectId) {
  const manifestId = asObjectId(manifestIdValue, "Operations manifest");
  const session = await mongoose.startSession();
  try {
    let createdBag: InstanceType<typeof OperationsManifestBag> | null = null;
    await session.withTransaction(async () => {
      const manifest = await OperationsManifest.findById(manifestId).session(session).exec();
      if (!manifest) throw new OperationsManifestServiceError("Operations manifest was not found.", 404);
      if (!isEditable(manifest)) throw new OperationsManifestServiceError("Bags cannot be added to this manifest.", 409);
      createdBag = await openNextBag(manifest, userId, session);
      await recalculateTotals(manifestId, session);
    });
    if (!createdBag) throw new OperationsManifestServiceError("Bag could not be created.", 500);
    return createdBag;
  } finally {
    await session.endSession();
  }
}

async function recordRejectedScan(input: {
  manifestId: mongoose.Types.ObjectId;
  bagId?: mongoose.Types.ObjectId;
  parcelNumber: string;
  scanRequestId: string;
  userId: mongoose.Types.ObjectId;
  message: string;
  scanSource?: OperationsScanSource;
  scanSessionId?: string;
}) {
  await OperationsManifestScan.create({
    manifestId: input.manifestId,
    bagId: input.bagId ?? null,
    parcelNumber: input.parcelNumber || "UNKNOWN",
    scanRequestId: input.scanRequestId,
    status: "REJECTED",
    scanSource: input.scanSource ?? "MANUAL",
    scanSessionId: input.scanSessionId || null,
    message: input.message,
    scannedBy: input.userId,
    scannedAt: new Date()
  }).catch(() => undefined);
  throw new OperationsManifestServiceError(input.message, 409);
}

async function previousDeclaredValue(shipmentDraftId: mongoose.Types.ObjectId) {
  const previous = await ShipmentManifest.findOne({ "lineSnapshots.shipmentDraftId": shipmentDraftId })
    .sort({ generatedAt: -1 })
    .select("lineSnapshots")
    .lean()
    .exec();
  const line = previous?.lineSnapshots.find((item) => String(item.shipmentDraftId) === String(shipmentDraftId));
  return line?.declaredValueMinor && line.declaredValueMinor > 0 ? line.declaredValueMinor : null;
}

export async function scanOperationsParcel(input: {
  manifestId: string;
  bagId: string;
  parcelNumber: string;
  scanRequestId?: string;
  scanSource?: OperationsScanSource;
  scanSessionId?: string;
  userId: mongoose.Types.ObjectId;
}) {
  const manifestId = asObjectId(input.manifestId, "Operations manifest");
  const bagId = asObjectId(input.bagId, "Bag");
  const parcelNumber = input.parcelNumber.trim().toUpperCase();
  const scanRequestId = input.scanRequestId?.trim() || crypto.randomUUID();
  const scanMetadata = { scanSource: input.scanSource ?? "MANUAL", scanSessionId: input.scanSessionId };
  if (!parcelNumber) throw new OperationsManifestServiceError("Scan or enter a Swiftline parcel barcode.");

  const existingRequest = await OperationsManifestScan.findOne({ scanRequestId }).lean().exec();
  if (existingRequest) {
    if (existingRequest.status === "ACCEPTED") return getOperationsManifestDetail(input.manifestId, { latestScanId: String(existingRequest._id) });
    throw new OperationsManifestServiceError(existingRequest.message, 409);
  }

  const [manifest, bag] = await Promise.all([
    OperationsManifest.findById(manifestId).exec(),
    OperationsManifestBag.findOne({ _id: bagId, manifestId }).exec()
  ]);
  if (!manifest) return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, ...scanMetadata, message: "Operations manifest was not found." });
  if (!isEditable(manifest)) return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, ...scanMetadata, message: "This manifest is locked and cannot accept parcel scans." });
  if (!bag) return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, ...scanMetadata, message: "Select a bag that belongs to this manifest." });
  if (!(["OPEN", "REOPENED"] as string[]).includes(bag.status)) {
    return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, ...scanMetadata, message: `${bag.bagNumber} is closed. Reopen it before scanning parcels.` });
  }

  const label = await LabelDocument.findOne({ parcelNumber, labelType: "SWIFTLINE", voidedAt: null }).exec();
  if (!label) return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, ...scanMetadata, message: "No Swiftline parcel was found for this barcode." });
  const shipment = await DpdShipment.findOne({ _id: label.dpdShipmentId, status: "LABEL_RECEIVED" }).exec();
  const snapshot = shipment
    ? readShipmentBookingSnapshot(shipment.currentShipmentSnapshot) ?? readShipmentBookingSnapshot(shipment.bookingSnapshot)
    : null;
  if (!shipment || !snapshot) {
    return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, ...scanMetadata, message: "Shipment information is incomplete. Contact Swiftline support before packing it." });
  }
  const expectedParcelNumbers = snapshot.parcels.map((parcel) => parcel.swiftlineParcelNumber.toUpperCase());
  const parcelWeightSnapshots = snapshot.parcels.map((parcel) => ({
    parcelNumber: parcel.swiftlineParcelNumber.toUpperCase(),
    weightKg: roundWeight(parcel.actualWeightKg),
    contentsDescription: typeof parcel.contentsDescription === "string" ? parcel.contentsDescription : "",
    valueMinor: snapshotParcelValueMinor(parcel)
  }));
  const incomingWeightKg = parcelWeightSnapshots.find((parcel) => parcel.parcelNumber === parcelNumber)?.weightKg ?? 0;
  if (!expectedParcelNumbers.includes(parcelNumber)) {
    return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, ...scanMetadata, message: "This barcode does not match the shipment's current parcel labels." });
  }
  const destinationCode = String(snapshot.consignee.countryCode ?? "").toUpperCase();
  if (manifest.header.destinationCountryCode && destinationCode !== manifest.header.destinationCountryCode) {
    return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, ...scanMetadata, message: `This shipment is for ${destinationCode || "another destination"}, not ${manifest.header.destinationCountryCode}.` });
  }
  const latestEvent = await ShipmentEvent.findOne({ shipmentDraftId: shipment.shipmentDraftId }).sort({ eventAt: -1, createdAt: -1 }).lean().exec();
  const cancelled = await ShipmentEvent.exists({ shipmentDraftId: shipment.shipmentDraftId, status: "SHIPMENT_CANCELLED" });
  if (cancelled || latestEvent?.status === "ON_HOLD") {
    return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, ...scanMetadata, message: cancelled ? "Cancelled shipments cannot be packed." : "This shipment is on hold and cannot be packed." });
  }

  const priorConsignment = await OperationsManifestConsignment.findOne({
    shipmentDraftId: shipment.shipmentDraftId,
    status: { $ne: "REMOVED" }
  }).exec();
  if (priorConsignment && String(priorConsignment.manifestId) !== String(manifestId)) {
    const priorManifest = await OperationsManifest.findById(priorConsignment.manifestId).lean().exec();
    if (priorManifest?.status !== "CANCELLED") {
      return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, ...scanMetadata, message: `This shipment already belongs to ${priorManifest?.manifestNumber ?? "another operations manifest"}.` });
    }
  }
  const duplicate = await OperationsManifestScan.findOne({ parcelNumber, status: "ACCEPTED" }).lean().exec();
  if (duplicate) {
    return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, ...scanMetadata, message: "This parcel has already been scanned." });
  }

  // A parcel heavier than a whole bag cannot be packed anywhere, so that is the only
  // weight a scan still refuses.
  if (!isOperationsBagWeightAllowed(incomingWeightKg)) {
    return recordRejectedScan({
      manifestId,
      bagId,
      parcelNumber,
      scanRequestId,
      userId: input.userId,
      ...scanMetadata,
      message: `This parcel weighs ${incomingWeightKg.toFixed(3)} kg and cannot fit inside a 31 kg bag.`
    });
  }
  // Otherwise the selected bag simply fills up and packing rolls onto a fresh bag.
  const overflowsSelectedBag = !isOperationsBagWeightAllowed(roundWeight(bag.totalWeightKg + incomingWeightKg));

  const [labelCount, previousValueMinor] = await Promise.all([
    LabelDocument.countDocuments({ dpdShipmentId: shipment._id, labelType: "SWIFTLINE", voidedAt: null }).exec(),
    previousDeclaredValue(shipment.shipmentDraftId)
  ]);
  const declaredValueFromSnapshot = snapshotDeclaredGoodsValueMinor(snapshot);
  const declaredValueMinor = declaredValueFromSnapshot > 0 ? declaredValueFromSnapshot : (previousValueMinor ?? 0);
  const line = buildManifestLine({
    shipmentDraftId: shipment.shipmentDraftId,
    dpdShipmentId: shipment._id as mongoose.Types.ObjectId,
    snapshot,
    declaredValueMinor: declaredValueMinor ?? 0,
    bagNumber: bag.bagNumber
  });
  const businessAccountId = asObjectId(String(snapshot.account.id ?? ""), "Business account");

  const session = await mongoose.startSession();
  let packedBag = bag;
  try {
    await session.withTransaction(async () => {
      packedBag = overflowsSelectedBag ? await openNextBag(manifest, input.userId, session) : bag;
      const packedBagId = packedBag._id as mongoose.Types.ObjectId;
      let consignment = await OperationsManifestConsignment.findOne({ manifestId, shipmentDraftId: shipment.shipmentDraftId })
        .session(session)
        .exec();
      if (!consignment) {
        const created = await OperationsManifestConsignment.create([{
          manifestId,
          bagId: packedBagId,
          shipmentDraftId: shipment.shipmentDraftId,
          dpdShipmentId: shipment._id,
          businessAccountId,
          consignmentNumber: snapshot.tracking.swiftlineTrackingNumber,
          expectedParcelNumbers,
          scannedParcelNumbers: [],
          parcelWeightSnapshots,
          manifestPieces: 1,
          weightKg: 0,
          status: "PARTIAL",
          consignorSnapshot: line.consignor,
          consigneeSnapshot: line.consignee,
          description: line.description,
          declaredValueMinor,
          currency: "INR",
          serviceInfo: line.serviceInfo,
          dpdLabelGenerated: labelCount >= snapshot.parcels.length
        }], { session });
        consignment = created[0] ?? null;
      }
      if (!consignment) throw new OperationsManifestServiceError("Manifest row could not be created.", 500);
      if (consignment.status === "REMOVED") {
        consignment.bagId = packedBagId;
        consignment.scannedParcelNumbers = [];
      }
      if (!consignment.parcelWeightSnapshots.length) {
        consignment.parcelWeightSnapshots = parcelWeightSnapshots;
      } else if (fillMissingParcelValues(consignment.parcelWeightSnapshots, snapshot)) {
        consignment.markModified("parcelWeightSnapshots");
      }
      if (!consignment.scannedParcelNumbers.includes(parcelNumber)) consignment.scannedParcelNumbers.push(parcelNumber);
      consignment.declaredValueMinor = consignmentDeclaredValueMinor(consignment) ?? declaredValueMinor;
      consignment.weightKg = calculateScannedParcelWeight(consignment);
      consignment.status = consignment.scannedParcelNumbers.length === consignment.expectedParcelNumbers.length ? "COMPLETE" : "PARTIAL";
      await consignment.save({ session });
      await OperationsManifestScan.create([{
        manifestId,
        bagId: packedBagId,
        consignmentId: consignment._id,
        parcelNumber,
        scanRequestId,
        status: "ACCEPTED",
        scanSource: scanMetadata.scanSource,
        scanSessionId: scanMetadata.scanSessionId || null,
        message: [
          overflowsSelectedBag ? `${bag.bagNumber} was full, so ${packedBag.bagNumber} was opened for this parcel.` : "Parcel added to the manifest.",
          consignment.dpdLabelGenerated ? "" : "Swiftline labels have not been generated for every parcel on this shipment."
        ].filter(Boolean).join(" "),
        scannedBy: input.userId,
        scannedAt: new Date()
      }], { session });
      await recalculateTotals(manifestId, session);
      await audit("OPERATIONS_PARCEL_SCANNED", manifestId, input.userId, {
        bagId: packedBagId,
        overflowedFromBagId: overflowsSelectedBag ? bagId : undefined,
        consignmentId: consignment._id,
        parcelNumber,
        scanSource: scanMetadata.scanSource,
        scanSessionId: scanMetadata.scanSessionId,
        dpdLabelGenerated: consignment.dpdLabelGenerated
      }, session);
    });
  } catch (error) {
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
      throw new OperationsManifestServiceError("This parcel has already been scanned.", 409);
    }
    throw error;
  } finally {
    await session.endSession();
  }
  if (overflowsSelectedBag) {
    // Point any paired phone at the bag packing actually continued in.
    await OperationsManifestScanSession.updateMany(
      { manifestId, activeBagId: bagId, status: "ACTIVE" },
      { $set: { activeBagId: packedBag._id, lastSeenAt: new Date() } }
    ).exec();
  }
  const accepted = await OperationsManifestScan.findOne({ scanRequestId }).lean().exec();
  return getOperationsManifestDetail(input.manifestId, { latestScanId: accepted ? String(accepted._id) : undefined });
}

export async function closeOperationsBag(manifestIdValue: string, bagIdValue: string, userId: mongoose.Types.ObjectId) {
  const manifestId = asObjectId(manifestIdValue, "Operations manifest");
  const bag = await OperationsManifestBag.findOne({ _id: asObjectId(bagIdValue, "Bag"), manifestId }).exec();
  if (!bag) throw new OperationsManifestServiceError("Bag was not found.", 404);
  if (!(["OPEN", "REOPENED"] as string[]).includes(bag.status)) throw new OperationsManifestServiceError("Only an open bag can be closed.", 409);
  // Closing is a physical act the operator decides on. Empty bags and part-packed
  // consignments are both fine here; sealing is where completeness is enforced.
  bag.status = "CLOSED";
  bag.closedBy = userId;
  bag.closedAt = new Date();
  await bag.save();
  await OperationsManifestScanSession.updateMany(
    { manifestId, activeBagId: bag._id, status: "ACTIVE" },
    { $set: { activeBagId: null, lastSeenAt: new Date() } }
  ).exec();
  await recalculateTotals(manifestId);
  await audit("OPERATIONS_BAG_UPDATED", manifestId, userId, { bagId: bag._id, status: "CLOSED" });
  return bag;
}

export async function reopenOperationsBag(manifestIdValue: string, bagIdValue: string, reason: string, userId: mongoose.Types.ObjectId) {
  const manifestId = asObjectId(manifestIdValue, "Operations manifest");
  const manifest = await OperationsManifest.findById(manifestId).exec();
  if (!manifest || !isEditable(manifest)) throw new OperationsManifestServiceError("This manifest cannot be reopened.", 409);
  const bag = await OperationsManifestBag.findOne({ _id: asObjectId(bagIdValue, "Bag"), manifestId, status: { $ne: "CANCELLED" } }).exec();
  if (!bag) throw new OperationsManifestServiceError("Bag was not found.", 404);
  bag.status = "REOPENED";
  bag.reopenedBy = userId;
  bag.reopenedAt = new Date();
  bag.correctionReason = reason;
  await bag.save();
  await recalculateTotals(manifestId);
  await audit("OPERATIONS_BAG_UPDATED", manifestId, userId, { bagId: bag._id, status: "REOPENED", reason });
  return bag;
}

export async function removeOperationsScan(input: {
  manifestId: string;
  scanId: string;
  reason: string;
  userId: mongoose.Types.ObjectId;
}) {
  const manifestId = asObjectId(input.manifestId, "Operations manifest");
  const manifest = await OperationsManifest.findById(manifestId).exec();
  if (!manifest || !isEditable(manifest)) throw new OperationsManifestServiceError("Scans cannot be corrected after sealing.", 409);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const scan = await OperationsManifestScan.findOne({ _id: asObjectId(input.scanId, "Scan"), manifestId, status: "ACCEPTED" }).session(session).exec();
      if (!scan || !scan.consignmentId) throw new OperationsManifestServiceError("Active parcel scan was not found.", 404);
      const bag = scan.bagId ? await OperationsManifestBag.findById(scan.bagId).session(session).exec() : null;
      if (bag?.status === "CLOSED") throw new OperationsManifestServiceError("Reopen the bag before removing a parcel scan.", 409);
      scan.status = "REMOVED";
      scan.removedBy = input.userId;
      scan.removedAt = new Date();
      scan.removalReason = input.reason;
      await scan.save({ session });
      const consignment = await OperationsManifestConsignment.findById(scan.consignmentId).session(session).exec();
      if (consignment) {
        consignment.scannedParcelNumbers = consignment.scannedParcelNumbers.filter((item) => item !== scan.parcelNumber);
        consignment.weightKg = calculateScannedParcelWeight(consignment);
        consignment.status = consignment.scannedParcelNumbers.length
          ? consignment.scannedParcelNumbers.length === consignment.expectedParcelNumbers.length ? "COMPLETE" : "PARTIAL"
          : "REMOVED";
        await consignment.save({ session });
      }
      await recalculateTotals(manifestId, session);
      await audit("OPERATIONS_SCAN_REMOVED", manifestId, input.userId, { scanId: scan._id, parcelNumber: scan.parcelNumber, reason: input.reason }, session);
    });
  } finally {
    await session.endSession();
  }
}

export async function moveOperationsConsignment(input: {
  manifestId: string;
  consignmentId: string;
  targetBagId: string;
  reason: string;
  userId: mongoose.Types.ObjectId;
}) {
  const manifestId = asObjectId(input.manifestId, "Operations manifest");
  const manifest = await OperationsManifest.findById(manifestId).exec();
  if (!manifest || !isEditable(manifest)) throw new OperationsManifestServiceError("Consignments cannot be moved after sealing.", 409);
  const consignment = await OperationsManifestConsignment.findOne({ _id: asObjectId(input.consignmentId, "Consignment"), manifestId, status: { $ne: "REMOVED" } }).exec();
  const target = await OperationsManifestBag.findOne({ _id: asObjectId(input.targetBagId, "Bag"), manifestId, status: { $in: ["OPEN", "REOPENED"] } }).exec();
  if (!consignment || !target) throw new OperationsManifestServiceError("Select an active consignment and an open destination bag.", 409);
  // Moving gathers every scanned parcel of the consignment into one bag, so the
  // source can be several bags once a shipment has been split across them.
  const consignmentScans = await OperationsManifestScan.find({ consignmentId: consignment._id, status: "ACCEPTED" }).lean().exec();
  const sourceBagIds = [...new Set(consignmentScans.map((scan) => String(scan.bagId ?? "")).filter(Boolean))];
  const relocatingScans = consignmentScans.filter((scan) => String(scan.bagId ?? "") !== String(target._id));
  if (!relocatingScans.length) throw new OperationsManifestServiceError("This consignment is already packed in the selected bag.", 409);

  const sourceBags = await OperationsManifestBag.find({ _id: { $in: sourceBagIds } }).exec();
  if (sourceBags.some((bag) => bag.status === "CLOSED")) {
    throw new OperationsManifestServiceError("Reopen every bag holding this consignment before moving it.", 409);
  }

  const weightByParcel = new Map(consignment.parcelWeightSnapshots.map((parcel) => [parcel.parcelNumber, parcel.weightKg]));
  const relocatingWeightKg = roundWeight(relocatingScans.reduce((sum, scan) => sum + (weightByParcel.get(scan.parcelNumber) ?? 0), 0));
  if (!isOperationsBagWeightAllowed(roundWeight(target.totalWeightKg + relocatingWeightKg))) {
    throw new OperationsManifestServiceError(`${target.bagNumber} cannot take another ${relocatingWeightKg.toFixed(3)} kg without passing the 31 kg limit.`, 409);
  }

  consignment.bagId = target._id as mongoose.Types.ObjectId;
  await consignment.save();
  await OperationsManifestScan.updateMany({ consignmentId: consignment._id, status: "ACCEPTED" }, { $set: { bagId: target._id } }).exec();
  await recalculateTotals(manifestId);
  await audit("OPERATIONS_BAG_UPDATED", manifestId, input.userId, { consignmentId: consignment._id, sourceBagIds, targetBagId: target._id, reason: input.reason });
}

export async function cancelOperationsBag(manifestIdValue: string, bagIdValue: string, reason: string, userId: mongoose.Types.ObjectId) {
  const manifestId = asObjectId(manifestIdValue, "Operations manifest");
  const manifest = await OperationsManifest.findById(manifestId).exec();
  if (!manifest || !isEditable(manifest)) throw new OperationsManifestServiceError("This bag cannot be cancelled.", 409);
  const bag = await OperationsManifestBag.findOne({ _id: asObjectId(bagIdValue, "Bag"), manifestId, status: { $ne: "CANCELLED" } }).exec();
  if (!bag) throw new OperationsManifestServiceError("Bag was not found.", 404);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Cancelling releases whatever was in the bag instead of refusing, so those
      // parcels become scannable again rather than being stranded on a dead bag.
      const packedScans = await OperationsManifestScan.find({ manifestId, bagId: bag._id, status: "ACCEPTED" }).session(session).exec();
      for (const scan of packedScans) {
        scan.status = "REMOVED";
        scan.removedBy = userId;
        scan.removedAt = new Date();
        scan.removalReason = reason || "Bag cancelled.";
        await scan.save({ session });

        if (!scan.consignmentId) continue;
        const consignment = await OperationsManifestConsignment.findById(scan.consignmentId).session(session).exec();
        if (!consignment) continue;
        consignment.scannedParcelNumbers = consignment.scannedParcelNumbers.filter((item) => item !== scan.parcelNumber);
        consignment.weightKg = calculateScannedParcelWeight(consignment);
        consignment.status = consignment.scannedParcelNumbers.length
          ? consignment.scannedParcelNumbers.length === consignment.expectedParcelNumbers.length ? "COMPLETE" : "PARTIAL"
          : "REMOVED";
        await consignment.save({ session });
      }

      bag.status = "CANCELLED";
      bag.cancelledBy = userId;
      bag.cancelledAt = new Date();
      bag.correctionReason = reason;
      await bag.save({ session });
      await OperationsManifestScanSession.updateMany(
        { manifestId, activeBagId: bag._id, status: "ACTIVE" },
        { $set: { activeBagId: null, lastSeenAt: new Date() } },
        { session }
      ).exec();
      await recalculateTotals(manifestId, session);
      await audit("OPERATIONS_BAG_UPDATED", manifestId, userId, { bagId: bag._id, status: "CANCELLED", releasedParcels: packedScans.length, reason }, session);
    });
  } finally {
    await session.endSession();
  }
}

function sealingIssues(manifest: IOperationsManifest, bags: Array<{ status: string; totalWeightKg?: number }>, consignments: Array<{ status: string; scannedParcelNumbers?: string[]; parcelWeightSnapshots?: ParcelValueSnapshot[] }>) {
  const issues: string[] = [];
  const header = manifest.header;
  if (!header.destinationAgent) issues.push("Destination agent details are required.");
  if (!header.destinationCountryCode || !header.destinationCountryName) issues.push("Destination country is required.");
  if (!header.flightNumber) issues.push("Flight number is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(header.departureDate)) issues.push("Departure date is required.");
  if (!header.mawbNumber) issues.push("MAWB number is required.");
  if (!/^[A-Z]{3}$/.test(header.originIataCode)) issues.push("A valid origin IATA code is required.");
  if (!/^[A-Z]{3}$/.test(header.destinationIataCode)) issues.push("A valid destination IATA code is required.");
  if (!header.valueType) issues.push("Value type is required.");
  if (!bags.length) issues.push("Create and close at least one bag.");
  if (bags.some((bag) => bag.status !== "CLOSED")) issues.push("Every active bag must be closed.");
  if (bags.some((bag) => !isOperationsBagWeightAllowed(bag.totalWeightKg ?? 0))) issues.push("Every bag must remain within the 31 kg maximum weight.");
  if (!consignments.length) issues.push("Scan at least one consignment.");
  // A part-scanned consignment is a real outcome: a box can be held back or returned
  // before the flight. The manifest records what was actually packed, so the scanned
  // parcel count on each row is the record rather than a blocker.
  // Every packed parcel needs its own declared value, since each box is a customs line.
  const parcelMissingValue = consignments.some((item) =>
    scannedParcelValues({ scannedParcelNumbers: item.scannedParcelNumbers ?? [], parcelWeightSnapshots: item.parcelWeightSnapshots })
      .some((parcel) => !parcel.valueMinor));
  if (parcelMissingValue) issues.push("Enter the goods value for every parcel.");
  return issues;
}

export type ManifestDispatchIssue = {
  shipmentDraftId: string;
  reference: string;
  reason: string;
  missingStatuses: string[];
};

export function buildManifestDispatchIssues(input: {
  consignments: Array<{ shipmentDraftId: unknown; consignmentNumber: string }>;
  events: Array<{ shipmentDraftId: unknown; status: string; eventAt: Date }>;
  cancellations?: Array<{ shipmentDraftId: unknown; status: string }>;
}): ManifestDispatchIssue[] {
  const statusesByDraft = new Map<string, Set<string>>();
  const latestByDraft = new Map<string, { status: string; eventAt: Date }>();
  for (const event of input.events) {
    const draftId = String(event.shipmentDraftId);
    const statuses = statusesByDraft.get(draftId) ?? new Set<string>();
    statuses.add(event.status);
    statusesByDraft.set(draftId, statuses);
    const latest = latestByDraft.get(draftId);
    if (!latest || event.eventAt.getTime() > latest.eventAt.getTime()) latestByDraft.set(draftId, event);
  }
  const cancellationByDraft = new Map(
    (input.cancellations ?? []).map((item) => [String(item.shipmentDraftId), item.status])
  );

  return input.consignments.flatMap((consignment) => {
    const draftId = String(consignment.shipmentDraftId);
    const reference = consignment.consignmentNumber || draftId;
    const cancellation = cancellationByDraft.get(draftId);
    if (cancellation) {
      return [{
        shipmentDraftId: draftId,
        reference,
        reason: cancellation === "COMPLETED"
          ? "Shipment is cancelled."
          : "Shipment has a pending cancellation request.",
        missingStatuses: []
      }];
    }
    if (latestByDraft.get(draftId)?.status === "ON_HOLD") {
      return [{ shipmentDraftId: draftId, reference, reason: "Shipment is on hold.", missingStatuses: [] }];
    }
    const missing = findMissingPrerequisites("ORIGIN_HUB_DISPATCHED", statusesByDraft.get(draftId) ?? []);
    return missing.length ? [{
      shipmentDraftId: draftId,
      reference,
      reason: `Missing ${missing.map(formatShipmentEventLabel).join(", ")}.`,
      missingStatuses: missing
    }] : [];
  });
}

async function loadManifestDispatchIssues(
  consignments: Array<{ shipmentDraftId: mongoose.Types.ObjectId; consignmentNumber: string }>,
  session?: mongoose.ClientSession
) {
  if (!consignments.length) return [];
  const shipmentDraftIds = consignments.map((item) => item.shipmentDraftId);
  const [events, cancellations] = await Promise.all([
    ShipmentEvent.find({ shipmentDraftId: { $in: shipmentDraftIds } })
      .select("shipmentDraftId status eventAt")
      .lean()
      .session(session ?? null)
      .exec(),
    ShipmentCancellation.find({
      shipmentDraftId: { $in: shipmentDraftIds },
      status: { $in: ["REQUESTED", "COMPLETED"] }
    }).select("shipmentDraftId status").lean().session(session ?? null).exec()
  ]);
  return buildManifestDispatchIssues({ consignments, events, cancellations });
}

export function buildManifestDispatchTrackingEvent(input: {
  shipmentDraftId: mongoose.Types.ObjectId;
  dpdShipmentId: mongoose.Types.ObjectId;
  manifestId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  dispatchedAt: Date;
}) {
  return {
    shipmentDraftId: input.shipmentDraftId,
    dpdShipmentId: input.dpdShipmentId,
    status: "ORIGIN_HUB_DISPATCHED" as const,
    milestoneKey: "ORIGIN_HUB_DISPATCHED",
    note: resolveShipmentEventNote("", "ORIGIN_HUB_DISPATCHED"),
    location: "",
    customerVisible: true,
    source: "MANIFEST" as const,
    sourceReference: String(input.manifestId),
    createdBy: input.userId,
    eventAt: input.dispatchedAt
  };
}

export async function sealOperationsManifest(manifestIdValue: string, userId: mongoose.Types.ObjectId) {
  const manifestId = asObjectId(manifestIdValue, "Operations manifest");
  const session = await mongoose.startSession();
  try {
    let sealed: IOperationsManifest | null = null;
    await session.withTransaction(async () => {
      const manifest = await OperationsManifest.findById(manifestId).session(session).exec();
      if (!manifest || !isEditable(manifest)) throw new OperationsManifestServiceError("This manifest cannot be sealed.", 409);
      const [branch, bags, consignments] = await Promise.all([
        Branch.findById(manifest.branchId).lean().session(session).exec(),
        OperationsManifestBag.find({ manifestId, status: { $ne: "CANCELLED" } }).sort({ sequence: 1 }).lean().session(session).exec(),
        OperationsManifestConsignment.find({ manifestId, status: { $ne: "REMOVED" } }).sort({ createdAt: 1 }).lean().session(session).exec()
      ]);
      const issues = sealingIssues(manifest, bags, consignments);
      if (issues.length) throw new OperationsManifestServiceError(issues.join(" "), 409);
      // A consignment can span several bags, so the printed manifest records every
      // bag its parcels were packed into rather than just the first one.
      const acceptedScans = await OperationsManifestScan.find({ manifestId, status: "ACCEPTED" })
        .select("bagId parcelNumber consignmentId")
        .sort({ scannedAt: 1 })
        .lean()
        .session(session)
        .exec();
      const sealedBagNumberById = new Map(bags.map((bag) => [String(bag._id), bag.bagNumber]));
      const sealedConsignments = consignments.map((item) => {
        const snapshotByParcel = new Map((item.parcelWeightSnapshots ?? []).map((parcel) => [parcel.parcelNumber, parcel]));
        // Each packed parcel becomes its own manifest row, carrying the weight,
        // contents, and bag it was actually scanned into.
        const parcels = acceptedScans
          .filter((scan) => String(scan.consignmentId ?? "") === String(item._id))
          .map((scan) => ({
            parcelNumber: scan.parcelNumber,
            weightKg: roundWeight(snapshotByParcel.get(scan.parcelNumber)?.weightKg ?? 0),
            description: snapshotByParcel.get(scan.parcelNumber)?.contentsDescription ?? "",
            bagNumber: sealedBagNumberById.get(String(scan.bagId ?? "")) ?? "",
            valueMinor: snapshotByParcel.get(scan.parcelNumber)?.valueMinor ?? null
          }));
        return {
          ...item,
          parcels,
          bagNumbers: [...new Set(parcels.map((parcel) => parcel.bagNumber))].filter(Boolean)
        };
      });
      // v2 adds structured consignor/consignee `party` fields on each consignment
      // (for the EDI export). v1 snapshots stay readable; the EDI export checks for
      // `party` directly rather than trusting the version number.
      manifest.sealedSnapshot = JSON.parse(JSON.stringify({
        version: 2,
        manifestNumber: manifest.manifestNumber,
        header: manifest.header,
        branch,
        totals: {
          totalBags: manifest.totalBags,
          totalConsignments: manifest.totalConsignments,
          totalPhysicalParcels: manifest.totalPhysicalParcels,
          totalWeightKg: manifest.totalWeightKg
        },
        bags,
        consignments: sealedConsignments,
        sealedAt: new Date().toISOString(),
        sealedBy: userId
      }));
      manifest.status = "SEALED";
      manifest.sealedAt = new Date();
      manifest.sealedBy = userId;
      await manifest.save({ session });
      await OperationsManifestScanSession.updateMany(
        { manifestId, status: { $ne: "ENDED" } },
        { $set: { status: "ENDED", activeBagId: null, endedAt: new Date(), endedReason: "Manifest sealed." } },
        { session }
      ).exec();
      await audit("OPERATIONS_MANIFEST_SEALED", manifestId, userId, { totals: manifest.sealedSnapshot.totals }, session);
      sealed = manifest;
    });
    if (!sealed) throw new OperationsManifestServiceError("Manifest could not be sealed.", 500);
    return sealed;
  } finally {
    await session.endSession();
  }
}

export async function dispatchOperationsManifest(manifestIdValue: string, userId: mongoose.Types.ObjectId) {
  const manifestId = asObjectId(manifestIdValue, "Operations manifest");
  const session = await mongoose.startSession();
  let dispatched: IOperationsManifest | null = null;

  try {
    await session.withTransaction(async () => {
      const manifest = await OperationsManifest.findById(manifestId).session(session).exec();
      if (!manifest || manifest.status !== "SEALED") {
        throw new OperationsManifestServiceError("Only a sealed manifest can be dispatched.", 409);
      }

      const dispatchedAt = new Date();
      const consignments = await OperationsManifestConsignment.find({
        manifestId: manifest._id,
        status: { $ne: "REMOVED" }
      }).select("shipmentDraftId dpdShipmentId consignmentNumber").session(session).lean().exec();

      const dispatchIssues = await loadManifestDispatchIssues(consignments, session);
      if (dispatchIssues.length) {
        const visible = dispatchIssues.slice(0, 8).map((issue) => `${issue.reference}: ${issue.reason}`);
        const remainder = dispatchIssues.length - visible.length;
        throw new OperationsManifestServiceError(
          `Manifest cannot be dispatched. ${visible.join(" ")}`
            + (remainder > 0 ? ` ${remainder} more shipment(s) need attention.` : ""),
          409
        );
      }

      manifest.status = "DISPATCHED";
      manifest.dispatchedAt = dispatchedAt;
      manifest.dispatchedBy = userId;
      await manifest.save({ session });

      if (consignments.length) {
        // Run these sequentially on the transaction session. Mongoose 9 can
        // silently omit a bulk update whose only mutation is `$setOnInsert`,
        // reporting zero matches and zero upserts while allowing the manifest
        // transaction to commit. A direct updateOne reliably performs the
        // idempotent upsert and keeps manifest dispatch and tracking atomic.
        for (const consignment of consignments) {
          const result = await ShipmentEvent.updateOne(
            {
              shipmentDraftId: consignment.shipmentDraftId,
              $or: [
                { milestoneKey: "ORIGIN_HUB_DISPATCHED" },
                { status: { $in: ["ORIGIN_HUB_DISPATCHED", "FLIGHT_DEPARTED"] } }
              ]
            },
            {
              $setOnInsert: buildManifestDispatchTrackingEvent({
                shipmentDraftId: consignment.shipmentDraftId,
                dpdShipmentId: consignment.dpdShipmentId,
                manifestId: manifest._id as mongoose.Types.ObjectId,
                userId,
                dispatchedAt
              })
            },
            { session, upsert: true }
          ).exec();

          if (!result.acknowledged || (result.matchedCount === 0 && result.upsertedCount === 0)) {
            throw new OperationsManifestServiceError(
              `Dispatch tracking could not be recorded for ${consignment.consignmentNumber}. The manifest was not dispatched.`,
              500
            );
          }
        }
      }

      await OperationsManifestScanSession.updateMany(
        { manifestId: manifest._id, status: { $ne: "ENDED" } },
        { $set: { status: "ENDED", activeBagId: null, endedAt: dispatchedAt, endedReason: "Manifest dispatched." } },
        { session }
      ).exec();
      await audit(
        "OPERATIONS_MANIFEST_DISPATCHED",
        manifest._id as mongoose.Types.ObjectId,
        userId,
        { dispatchedAt, consignmentsChecked: consignments.length },
        session
      );
      dispatched = manifest;
    });
  } finally {
    await session.endSession();
  }

  if (!dispatched) throw new OperationsManifestServiceError("Manifest could not be dispatched.", 500);
  return dispatched;
}

export async function cancelOperationsManifest(manifestIdValue: string, reason: string, userId: mongoose.Types.ObjectId) {
  const manifest = await OperationsManifest.findById(asObjectId(manifestIdValue, "Operations manifest")).exec();
  if (!manifest || !isEditable(manifest)) throw new OperationsManifestServiceError("A sealed, dispatched or cancelled manifest cannot be cancelled.", 409);
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      manifest.status = "CANCELLED";
      manifest.cancelledAt = new Date();
      manifest.cancelledBy = userId;
      manifest.cancellationReason = reason;
      await manifest.save({ session });
      await OperationsManifestScanSession.updateMany(
        { manifestId: manifest._id, status: { $ne: "ENDED" } },
        { $set: { status: "ENDED", activeBagId: null, endedAt: new Date(), endedReason: "Manifest cancelled." } },
        { session }
      ).exec();
      await OperationsManifestScan.updateMany({ manifestId: manifest._id, status: "ACCEPTED" }, {
        $set: { status: "REMOVED", removedBy: userId, removedAt: new Date(), removalReason: `Manifest cancelled: ${reason}` }
      }, { session }).exec();
      await audit("OPERATIONS_MANIFEST_CANCELLED", manifest._id as mongoose.Types.ObjectId, userId, { reason }, session);
    });
  } finally {
    await session.endSession();
  }
  return manifest;
}

async function normalizeEditableManifestData(manifest: IOperationsManifest) {
  if (!isEditable(manifest)) return;
  const [bags, consignments] = await Promise.all([
    OperationsManifestBag.find({ manifestId: manifest._id, status: { $ne: "CANCELLED" } }).sort({ sequence: 1 }).exec(),
    OperationsManifestConsignment.find({
      manifestId: manifest._id,
      status: { $ne: "REMOVED" },
      $or: [
        { parcelWeightSnapshots: { $exists: false } },
        { parcelWeightSnapshots: { $size: 0 } },
        { "parcelWeightSnapshots.valueMinor": null }
      ]
    }).exec()
  ]);
  let changed = false;

  for (const bag of bags) {
    const expectedNumber = formatOperationsBagNumber(manifest.manifestNumber, bag.sequence);
    if (bag.bagNumber === expectedNumber && bag.barcode === expectedNumber) continue;
    bag.bagNumber = expectedNumber;
    bag.barcode = expectedNumber;
    await bag.save();
    changed = true;
  }

  if (consignments.length) {
    const shipments = await DpdShipment.find({ _id: { $in: consignments.map((item) => item.dpdShipmentId) } }).exec();
    const shipmentById = new Map(shipments.map((shipment) => [String(shipment._id), shipment]));
    for (const consignment of consignments) {
      const shipment = shipmentById.get(String(consignment.dpdShipmentId));
      const snapshot = shipment
        ? readShipmentBookingSnapshot(shipment.currentShipmentSnapshot) ?? readShipmentBookingSnapshot(shipment.bookingSnapshot)
        : null;
      if (!snapshot) continue;
      let valueChanged = false;
      if (!consignment.parcelWeightSnapshots.length) {
        consignment.parcelWeightSnapshots = snapshot.parcels.map((parcel) => ({
          parcelNumber: parcel.swiftlineParcelNumber.toUpperCase(),
          weightKg: roundWeight(parcel.actualWeightKg),
          contentsDescription: typeof parcel.contentsDescription === "string" ? parcel.contentsDescription : "",
          valueMinor: snapshotParcelValueMinor(parcel)
        }));
        valueChanged = true;
      } else {
        valueChanged = fillMissingParcelValues(consignment.parcelWeightSnapshots, snapshot);
      }
      const declaredValueMinor = snapshotDeclaredGoodsValueMinor(snapshot);
      if (consignment.declaredValueMinor !== declaredValueMinor) {
        consignment.declaredValueMinor = declaredValueMinor;
        valueChanged = true;
      }
      if (valueChanged) {
        consignment.markModified("parcelWeightSnapshots");
        consignment.weightKg = calculateScannedParcelWeight(consignment);
        await consignment.save();
        changed = true;
      }
    }
  }

  if (changed) await recalculateTotals(manifest._id as mongoose.Types.ObjectId);
}

export async function getOperationsManifestDetail(manifestIdValue: string, options?: { latestScanId?: string }) {
  const manifestId = asObjectId(manifestIdValue, "Operations manifest");
  const manifestDocument = await OperationsManifest.findById(manifestId).exec();
  if (!manifestDocument) throw new OperationsManifestServiceError("Operations manifest was not found.", 404);
  await normalizeEditableManifestData(manifestDocument);
  const [manifest, bags, consignments, scans, acceptedScans] = await Promise.all([
    OperationsManifest.findById(manifestId).lean().exec(),
    OperationsManifestBag.find({ manifestId }).sort({ sequence: 1 }).lean().exec(),
    OperationsManifestConsignment.find({ manifestId, status: { $ne: "REMOVED" } }).sort({ createdAt: 1 }).lean().exec(),
    OperationsManifestScan.find({ manifestId }).sort({ scannedAt: -1 }).limit(50).lean().exec(),
    OperationsManifestScan.find({ manifestId, status: "ACCEPTED" })
      .select("bagId parcelNumber consignmentId")
      .sort({ scannedAt: 1 })
      .lean()
      .exec()
  ]);
  if (!manifest) throw new OperationsManifestServiceError("Operations manifest was not found.", 404);
  const dispatchIssues = manifest.status === "SEALED"
    ? await loadManifestDispatchIssues(consignments)
    : [];
  const branch = await Branch.findById(manifest.branchId).select("name code address contact").lean().exec();
  const bagNumberById = new Map(bags.map((bag) => [String(bag._id), bag.bagNumber]));
  const latestScan = options?.latestScanId
    ? scans.find((scan) => String(scan._id) === options.latestScanId)
    : scans[0];
  return {
    manifest: { ...serializeManifest(manifest as unknown as IOperationsManifest), branch },
    bags: bags.map((bag) => ({ ...bag, id: String(bag._id), manifestId: String(bag.manifestId) })),
    consignments: consignments.map((item) => {
      const packedIn = bagIdsForConsignment(acceptedScans, item._id);
      return {
        ...item,
        id: String(item._id),
        manifestId: String(item.manifestId),
        bagId: String(item.bagId),
        // Every bag holding a parcel of this consignment, in packing order.
        bagIds: packedIn,
        bagNumbers: packedIn.map((id) => bagNumberById.get(id) ?? "").filter(Boolean),
        shipmentDraftId: String(item.shipmentDraftId),
        dpdShipmentId: String(item.dpdShipmentId),
        businessAccountId: String(item.businessAccountId),
        displayConsignmentNumber: formatManifestConsignmentNumber(item.consignmentNumber),
        // Goods value is entered per parcel; the consignment value is their sum.
        parcelValues: scannedParcelValues(item),
        goodsValueRequired: scannedParcelValues(item).some((parcel) => !parcel.valueMinor),
        dpdWarning: item.dpdLabelGenerated ? "" : "Swiftline labels have not been generated for every parcel on this shipment."
      };
    }),
    scans: scans.map((scan) => ({ ...scan, id: String(scan._id), manifestId: String(scan.manifestId), bagId: scan.bagId ? String(scan.bagId) : null })),
    latestScan: latestScan
      ? { ...latestScan, id: String(latestScan._id), bagId: latestScan.bagId ? String(latestScan.bagId) : null }
      : null,
    sealingIssues: sealingIssues(
      manifest as unknown as IOperationsManifest,
      bags.filter((bag) => bag.status !== "CANCELLED"),
      consignments
    ),
    dispatchIssues
  };
}

function readSealedSnapshot(manifest: IOperationsManifest): SealedSnapshot {
  const snapshot = parseSealedSnapshot(manifest.sealedSnapshot);
  if (!snapshot) throw new OperationsManifestServiceError("The sealed manifest snapshot is unavailable.", 409);
  return snapshot;
}

function normalizedManifestAddress(value: unknown) {
  const seen = new Set<string>();
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => {
    if (!line) return false;
    const key = line.replace(/\s+/g, " ").toUpperCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((line) => ["UNITED KINGDOM", "UK", "GREAT BRITAIN"].includes(line.toUpperCase()) ? "GB" : line).join("\n");
}

function spacedPdfAddress(value: unknown) {
  const lines = normalizedManifestAddress(value).split("\n").filter(Boolean);
  const phone = lines.find((line) => line.toUpperCase().startsWith("TEL-"));
  const address = lines.filter((line) => line !== phone);
  const spread = [...address.slice(0, 3), "", ...address.slice(3)];
  if (phone) spread.push("", phone);
  // Legacy fallback keeps the trailing blank row the fixed party block also carries.
  spread.push("");
  return spread;
}

export async function buildOperationsManifestExcel(manifest: IOperationsManifest) {
  const snapshot = readSealedSnapshot(manifest);
  const model = buildManifestDocumentModel(snapshot);
  const virtualManifest = {
    manifestNumber: model.manifestNumber,
    businessAccountId: new mongoose.Types.ObjectId(),
    branchId: manifest.branchId,
    shipmentDraftIds: model.consignments.map((item) => new mongoose.Types.ObjectId(item.shipmentDraftId)),
    headerSnapshot: {
      originBranch: [String(model.branch.name ?? ""), String(model.branch.code ?? "")].filter(Boolean).join(" - "),
      originAddress: formatManifestOrigin(model.branch),
      destinationAgent: snapshot.header.destinationAgent,
      flightNumber: snapshot.header.flightNumber,
      departureDate: snapshot.header.departureDate,
      mawbNumber: snapshot.header.mawbNumber,
      originIataCode: snapshot.header.originIataCode,
      destinationIataCode: snapshot.header.destinationIataCode,
      valueType: snapshot.header.valueType
    },
    // One line per parcel, straight from the shared document model. The goods value
    // already lives only on each consignment's first parcel row.
    lineSnapshots: model.parcelRows.map((row) => ({
      shipmentDraftId: new mongoose.Types.ObjectId(row.shipmentDraftId),
      dpdShipmentId: new mongoose.Types.ObjectId(row.dpdShipmentId),
      consignmentNumber: row.consignmentNumber,
      pieces: 1,
      weightKg: row.weightKg,
      consignor: { formatted: normalizedManifestAddress(row.consignor.formatted), party: row.consignor.party },
      consignee: { formatted: normalizedManifestAddress(row.consignee.formatted), party: row.consignee.party },
      description: row.description,
      declaredValueMinor: row.declaredValueMinor,
      currency: row.currency,
      bagNumber: row.bagNumber,
      serviceInfo: row.serviceInfo
    })),
    totalPieces: model.totals.totalPhysicalParcels,
    totalWeightKg: model.totals.totalWeightKg,
    totalBags: model.totals.totalBags,
    actorRole: "admin",
    generatedAt: model.generatedAt
  };
  return buildShipmentManifestWorkbook(virtualManifest as unknown as IShipmentManifest);
}

export async function buildOperationsManifestPdf(manifest: IOperationsManifest) {
  const snapshot = readSealedSnapshot(manifest);
  const model = buildManifestDocumentModel(snapshot);
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", layout: "landscape", margin: 20 });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    const widths = [30, 78, 42, 50, 132, 145, 120, 55, 45, 45, 58];
    const headers = ["S.No *", "Consignment\nNo. *", "Pieces *", "Weight\n(kg)", "Consignor *", "Consignee *", "Description *", "Value *", "Currency *", "Bag No *", "Service\nInfo"];
    const left = document.page.margins.left;
    const totalWidth = widths.reduce((sum, width) => sum + width, 0);
    const drawCell = (column: number, y: number, height: number, value: unknown, options?: { bold?: boolean; align?: "left" | "center"; size?: number }) => {
      const x = left + widths.slice(0, column).reduce((sum, width) => sum + width, 0);
      document.rect(x, y, widths[column] ?? 0, height).stroke("#222222");
      document.font(options?.bold ? "Helvetica-Bold" : "Helvetica").fontSize(options?.size ?? 7)
        .fillColor("#111111").text(String(value ?? ""), x + 3, y + 4, { width: (widths[column] ?? 0) - 6, height: height - 6, align: options?.align ?? "center", lineGap: 1 });
    };
    let y = 30;
    document.rect(left, y, totalWidth, 20).stroke("#222222");
    document.font("Helvetica-Bold").fontSize(10).text("Courier Manifest", left, y + 5, { width: totalWidth, align: "center" });
    y += 20;
    const branchLines = formatManifestOrigin(snapshot.branch).split("\n");
    const destinationLines = String(snapshot.header.destinationAgent ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const details: Array<[string, string | number]> = [
      ["Manifest Number", snapshot.manifestNumber], ["FLIGHT NUMBER", snapshot.header.flightNumber],
      ["FLIGHT DEPARTURE DATE", snapshot.header.departureDate.split("-").reverse().join("/")], ["MAWB NO. *", snapshot.header.mawbNumber],
      ["MAWB ORIGIN (IATA Code) *", snapshot.header.originIataCode], ["MAWB DESTINATION (IATA Code) *", snapshot.header.destinationIataCode],
      ["TOTAL BAGS *", snapshot.totals.totalBags], ["TOTAL WEIGHT (kg) *", snapshot.totals.totalWeightKg.toFixed(3)],
      ["VALUE TYPE (HV, LV, TS, Docs)", snapshot.header.valueType], ["", ""]
    ];
    for (let row = 0; row < 10; row += 1) {
      for (let column = 0; column < widths.length; column += 1) drawCell(column, y, 16, "");
      if (row === 0) { drawCell(4, y, 16, "FROM *", { bold: true, align: "left" }); drawCell(5, y, 16, "TO *", { bold: true, align: "left" }); }
      else { drawCell(4, y, 16, branchLines[row - 1] ?? "", { bold: row === 1, align: "left" }); drawCell(5, y, 16, destinationLines[row - 1] ?? "", { bold: row === 1, align: "left" }); }
      drawCell(6, y, 16, details[row]?.[0] ?? "", { bold: true, align: "left" });
      drawCell(7, y, 16, details[row]?.[1] ?? "", { bold: true, align: "left" });
      y += 16;
    }
    y += 10;
    headers.forEach((header, index) => drawCell(index, y, 30, header, { bold: true }));
    y += 30;
    const rowHeight = 11.2;
    model.consignments.forEach((consignment) => {
      // Same fixed ten-row block as the Excel: contact name first (no company), the
      // phone on the consignee only, and a blank tenth row.
      const consignorLines = consignment.consignor.party
        ? fixedPartyAddressRows(consignment.consignor.party, false)
        : spacedPdfAddress(consignment.consignor.formatted);
      const consigneeLines = consignment.consignee.party
        ? fixedPartyAddressRows(consignment.consignee.party, true)
        : spacedPdfAddress(consignment.consignee.formatted);
      const blockSize = Math.max(consignorLines.length, consigneeLines.length);

      consignment.parcels.forEach((parcel) => {
        const blockHeight = blockSize * rowHeight;
        if (y + blockHeight > document.page.height - 28) {
          document.addPage();
          y = document.page.margins.top;
          headers.forEach((header, column) => drawCell(column, y, 30, header, { bold: true }));
          y += 30;
        }

        for (let row = 0; row < blockSize; row += 1) {
          const values = row === 0
            ? [
              parcel.serial,
              consignment.formattedConsignmentNumber,
              1,
              parcel.weightKg.toFixed(3),
              consignorLines[0] ?? "",
              consigneeLines[0] ?? "",
              parcel.description,
              parcel.declaredValueMinor != null ? (parcel.declaredValueMinor / 100).toFixed(2) : "",
              consignment.currency,
              parcel.bagNumber,
              consignment.serviceInfo
            ]
            : ["", "", "", "", consignorLines[row] ?? "", consigneeLines[row] ?? "", "", "", "", "", ""];
          values.forEach((value, column) => drawCell(column, y, rowHeight, value, { align: "center", size: 6.5 }));
          y += rowHeight;
        }
      });
    });
    document.font("Helvetica").fontSize(7).text("Swiftline Portal | Computer Generated Operations Manifest", left, document.page.height - 18, { width: totalWidth, align: "center" });
    document.end();
  });
}
