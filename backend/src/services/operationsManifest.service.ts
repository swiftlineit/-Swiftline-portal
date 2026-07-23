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
import { OperationsManifestScan } from "../models/operationsManifestScan.model.js";
import { ShipmentEvent } from "../models/shipmentEvent.model.js";
import { ShipmentManifest } from "../models/shipmentManifest.model.js";
import {
  buildManifestLine,
  buildShipmentManifestWorkbook,
  formatManifestConsignmentNumber,
  formatManifestOrigin
} from "./shipmentManifest.service.js";
import { readShipmentBookingSnapshot, type ShipmentBookingSnapshot } from "./shipmentBookingSnapshot.service.js";

export class OperationsManifestServiceError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
  }
}

const editableStatuses = ["DRAFT", "PACKING", "READY_TO_SEAL"] as const;

function isEditable(manifest: IOperationsManifest) {
  return editableStatuses.includes(manifest.status as (typeof editableStatuses)[number]);
}

function fiscalYearCode(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? date.getUTCFullYear());
  const month = Number(parts.find((part) => part.type === "month")?.value ?? date.getUTCMonth() + 1);
  const startYear = month >= 4 ? year : year - 1;
  return `${String(startYear).slice(-2)}${String(startYear + 1).slice(-2)}`;
}

export async function allocateOperationsManifestNumber(session?: mongoose.ClientSession) {
  const counter = await OperationsManifestCounter.findOneAndUpdate(
    { _id: `operations-manifest-${fiscalYearCode()}` },
    { $inc: { sequence: 1 } },
    { upsert: true, returnDocument: "after", session }
  ).exec();
  if (!counter) throw new OperationsManifestServiceError("Manifest number could not be generated.", 500);
  return `SLCM${fiscalYearCode()}${String(counter.sequence).padStart(5, "0")}`;
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

function manifestSequence(manifestNumber: string) {
  const match = /(\d{5})$/.exec(manifestNumber);
  return String(Number(match?.[1] ?? 0)).padStart(3, "0");
}

export function formatOperationsBagNumber(manifestNumber: string, bagSequence: number) {
  return `SLC${manifestSequence(manifestNumber)}${String(bagSequence).padStart(2, "0")}`;
}

export function isOperationsBagWeightAllowed(weightKg: number) {
  return roundWeight(weightKg) <= 31;
}

async function recalculateTotals(manifestId: mongoose.Types.ObjectId, session?: mongoose.ClientSession) {
  const [bags, consignments, scanCount] = await Promise.all([
    OperationsManifestBag.find({ manifestId, status: { $ne: "CANCELLED" } }).session(session ?? null).exec(),
    OperationsManifestConsignment.find({ manifestId, status: { $ne: "REMOVED" } }).session(session ?? null).exec(),
    OperationsManifestScan.countDocuments({ manifestId, status: "ACCEPTED" }).session(session ?? null).exec()
  ]);

  for (const bag of bags) {
    const bagConsignments = consignments.filter((item) => String(item.bagId) === String(bag._id));
    bag.totalConsignments = bagConsignments.length;
    bag.totalPhysicalParcels = bagConsignments.reduce((sum, item) => sum + item.scannedParcelNumbers.length, 0);
    bag.totalWeightKg = roundWeight(bagConsignments.reduce((sum, item) => sum + item.weightKg, 0));
    await bag.save({ session });
  }

  const manifest = await OperationsManifest.findById(manifestId).session(session ?? null).exec();
  if (!manifest) throw new OperationsManifestServiceError("Operations manifest was not found.", 404);
  manifest.totalBags = bags.length;
  manifest.totalConsignments = consignments.length;
  manifest.totalPhysicalParcels = scanCount;
  manifest.totalWeightKg = roundWeight(consignments.reduce((sum, item) => sum + item.weightKg, 0));

  if (isEditable(manifest)) {
    if (!scanCount) manifest.status = "DRAFT";
    else {
      const allBagsClosed = bags.length > 0 && bags.every((bag) => bag.status === "CLOSED");
      const allConsignmentsComplete = consignments.length > 0 && consignments.every((item) => item.status === "COMPLETE");
      manifest.status = allBagsClosed && allConsignmentsComplete ? "READY_TO_SEAL" : "PACKING";
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

export async function listOperationsManifests(input: { page: number; limit: number; status?: string; branchId?: string }) {
  const filter: Record<string, unknown> = {};
  if (input.status) filter.status = input.status;
  if (input.branchId && mongoose.Types.ObjectId.isValid(input.branchId)) filter.branchId = input.branchId;
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

export async function createOperationsBag(manifestIdValue: string, userId: mongoose.Types.ObjectId) {
  const manifestId = asObjectId(manifestIdValue, "Operations manifest");
  const session = await mongoose.startSession();
  try {
    let createdBag: InstanceType<typeof OperationsManifestBag> | null = null;
    await session.withTransaction(async () => {
      const manifest = await OperationsManifest.findById(manifestId).session(session).exec();
      if (!manifest) throw new OperationsManifestServiceError("Operations manifest was not found.", 404);
      if (!isEditable(manifest)) throw new OperationsManifestServiceError("Bags cannot be added to this manifest.", 409);
      const latest = await OperationsManifestBag.findOne({ manifestId }).sort({ sequence: -1 }).session(session).exec();
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
      createdBag = created[0] ?? null;
      await recalculateTotals(manifestId, session);
      await audit("OPERATIONS_BAG_CREATED", manifestId, userId, { bagId: createdBag?._id, bagNumber }, session);
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
}) {
  await OperationsManifestScan.create({
    manifestId: input.manifestId,
    bagId: input.bagId ?? null,
    parcelNumber: input.parcelNumber || "UNKNOWN",
    scanRequestId: input.scanRequestId,
    status: "REJECTED",
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
  userId: mongoose.Types.ObjectId;
}) {
  const manifestId = asObjectId(input.manifestId, "Operations manifest");
  const bagId = asObjectId(input.bagId, "Bag");
  const parcelNumber = input.parcelNumber.trim().toUpperCase();
  const scanRequestId = input.scanRequestId?.trim() || crypto.randomUUID();
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
  if (!manifest) return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, message: "Operations manifest was not found." });
  if (!isEditable(manifest)) return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, message: "This manifest is locked and cannot accept parcel scans." });
  if (!bag) return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, message: "Select a bag that belongs to this manifest." });
  if (!(["OPEN", "REOPENED"] as string[]).includes(bag.status)) {
    return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, message: `${bag.bagNumber} is closed. Reopen it before scanning parcels.` });
  }

  const label = await LabelDocument.findOne({ parcelNumber, labelType: "SWIFTLINE", voidedAt: null }).exec();
  if (!label) return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, message: "No Swiftline parcel was found for this barcode." });
  const shipment = await DpdShipment.findOne({ _id: label.dpdShipmentId, status: "LABEL_RECEIVED" }).exec();
  const snapshot = shipment
    ? readShipmentBookingSnapshot(shipment.currentShipmentSnapshot) ?? readShipmentBookingSnapshot(shipment.bookingSnapshot)
    : null;
  if (!shipment || !snapshot) {
    return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, message: "Shipment information is incomplete. Contact Swiftline support before packing it." });
  }
  const expectedParcelNumbers = snapshot.parcels.map((parcel) => parcel.swiftlineParcelNumber.toUpperCase());
  const parcelWeightSnapshots = snapshot.parcels.map((parcel) => ({
    parcelNumber: parcel.swiftlineParcelNumber.toUpperCase(),
    weightKg: roundWeight(parcel.actualWeightKg)
  }));
  const incomingWeightKg = parcelWeightSnapshots.find((parcel) => parcel.parcelNumber === parcelNumber)?.weightKg ?? 0;
  const expectedShipmentWeightKg = roundWeight(parcelWeightSnapshots.reduce((total, parcel) => total + parcel.weightKg, 0));
  if (!expectedParcelNumbers.includes(parcelNumber)) {
    return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, message: "This barcode does not match the shipment's current parcel labels." });
  }
  const destinationCode = String(snapshot.consignee.countryCode ?? "").toUpperCase();
  if (manifest.header.destinationCountryCode && destinationCode !== manifest.header.destinationCountryCode) {
    return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, message: `This shipment is for ${destinationCode || "another destination"}, not ${manifest.header.destinationCountryCode}.` });
  }
  const latestEvent = await ShipmentEvent.findOne({ shipmentDraftId: shipment.shipmentDraftId }).sort({ eventAt: -1, createdAt: -1 }).lean().exec();
  const cancelled = await ShipmentEvent.exists({ shipmentDraftId: shipment.shipmentDraftId, status: "SHIPMENT_CANCELLED" });
  if (cancelled || latestEvent?.status === "ON_HOLD") {
    return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, message: cancelled ? "Cancelled shipments cannot be packed." : "This shipment is on hold and cannot be packed." });
  }

  const priorConsignment = await OperationsManifestConsignment.findOne({
    shipmentDraftId: shipment.shipmentDraftId,
    status: { $ne: "REMOVED" }
  }).exec();
  if (priorConsignment && String(priorConsignment.manifestId) !== String(manifestId)) {
    const priorManifest = await OperationsManifest.findById(priorConsignment.manifestId).lean().exec();
    if (priorManifest?.status !== "CANCELLED") {
      return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, message: `This shipment already belongs to ${priorManifest?.manifestNumber ?? "another operations manifest"}.` });
    }
  }
  if (priorConsignment && String(priorConsignment.bagId) !== String(bagId)) {
    const assignedBag = await OperationsManifestBag.findById(priorConsignment.bagId).lean().exec();
    return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, message: `This consignment is assigned to ${assignedBag?.bagNumber ?? "another bag"}. Select that bag to continue.` });
  }

  const duplicate = await OperationsManifestScan.findOne({ parcelNumber, status: "ACCEPTED" }).lean().exec();
  if (duplicate) {
    return recordRejectedScan({ manifestId, bagId, parcelNumber, scanRequestId, userId: input.userId, message: "This parcel has already been scanned." });
  }

  const bagConsignments = await OperationsManifestConsignment.find({ manifestId, bagId, status: { $ne: "REMOVED" } }).lean().exec();
  const committedBagWeightKg = roundWeight(bagConsignments.reduce((total, item) => {
    const snapshots = item.parcelWeightSnapshots ?? [];
    return total + (snapshots.length ? snapshots.reduce((sum, parcel) => sum + parcel.weightKg, 0) : item.weightKg);
  }, 0));
  const projectedBagWeightKg = priorConsignment
    ? roundWeight(bag.totalWeightKg + incomingWeightKg)
    : roundWeight(committedBagWeightKg + expectedShipmentWeightKg);
  if (!isOperationsBagWeightAllowed(projectedBagWeightKg)) {
    return recordRejectedScan({
      manifestId,
      bagId,
      parcelNumber,
      scanRequestId,
      userId: input.userId,
      message: `${bag.bagNumber} has insufficient capacity. A bag cannot exceed 31 kg.`
    });
  }

  const [dpdLabelCount, declaredValueMinor] = await Promise.all([
    LabelDocument.countDocuments({ dpdShipmentId: shipment._id, labelType: "DPD", voidedAt: null }).exec(),
    previousDeclaredValue(shipment.shipmentDraftId)
  ]);
  const line = buildManifestLine({
    shipmentDraftId: shipment.shipmentDraftId,
    dpdShipmentId: shipment._id as mongoose.Types.ObjectId,
    snapshot,
    declaredValueMinor: declaredValueMinor ?? 0,
    bagNumber: bag.bagNumber
  });
  const businessAccountId = asObjectId(String(snapshot.account.id ?? ""), "Business account");

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      let consignment = await OperationsManifestConsignment.findOne({ manifestId, shipmentDraftId: shipment.shipmentDraftId })
        .session(session)
        .exec();
      if (!consignment) {
        const created = await OperationsManifestConsignment.create([{
          manifestId,
          bagId,
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
          dpdLabelGenerated: dpdLabelCount >= snapshot.parcels.length
        }], { session });
        consignment = created[0] ?? null;
      }
      if (!consignment) throw new OperationsManifestServiceError("Manifest row could not be created.", 500);
      if (consignment.status === "REMOVED") {
        consignment.bagId = bagId;
        consignment.scannedParcelNumbers = [];
      }
      if (!consignment.parcelWeightSnapshots.length) consignment.parcelWeightSnapshots = parcelWeightSnapshots;
      if (!consignment.scannedParcelNumbers.includes(parcelNumber)) consignment.scannedParcelNumbers.push(parcelNumber);
      consignment.weightKg = calculateScannedParcelWeight(consignment);
      consignment.status = consignment.scannedParcelNumbers.length === consignment.expectedParcelNumbers.length ? "COMPLETE" : "PARTIAL";
      await consignment.save({ session });
      await OperationsManifestScan.create([{
        manifestId,
        bagId,
        consignmentId: consignment._id,
        parcelNumber,
        scanRequestId,
        status: "ACCEPTED",
        message: consignment.dpdLabelGenerated
          ? "Parcel added to the manifest."
          : "Parcel added. DPD label has not been generated; this shipment uses Swiftline internal labels only.",
        scannedBy: input.userId,
        scannedAt: new Date()
      }], { session });
      await recalculateTotals(manifestId, session);
      await audit("OPERATIONS_PARCEL_SCANNED", manifestId, input.userId, {
        bagId,
        consignmentId: consignment._id,
        parcelNumber,
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
  const accepted = await OperationsManifestScan.findOne({ scanRequestId }).lean().exec();
  return getOperationsManifestDetail(input.manifestId, { latestScanId: accepted ? String(accepted._id) : undefined });
}

export async function updateDeclaredValue(input: {
  manifestId: string;
  consignmentId: string;
  declaredValueMinor: number;
  userId: mongoose.Types.ObjectId;
}) {
  const manifest = await OperationsManifest.findById(asObjectId(input.manifestId, "Operations manifest")).exec();
  if (!manifest || !isEditable(manifest)) throw new OperationsManifestServiceError("This manifest can no longer be edited.", 409);
  const consignment = await OperationsManifestConsignment.findOneAndUpdate(
    { _id: asObjectId(input.consignmentId, "Consignment"), manifestId: manifest._id, status: { $ne: "REMOVED" } },
    { $set: { declaredValueMinor: input.declaredValueMinor } },
    { returnDocument: "after", runValidators: true }
  ).exec();
  if (!consignment) throw new OperationsManifestServiceError("Consignment was not found.", 404);
  await audit("OPERATIONS_MANIFEST_UPDATED", manifest._id as mongoose.Types.ObjectId, input.userId, { consignmentId: consignment._id, declaredValueUpdated: true });
  return consignment;
}

export async function closeOperationsBag(manifestIdValue: string, bagIdValue: string, userId: mongoose.Types.ObjectId) {
  const manifestId = asObjectId(manifestIdValue, "Operations manifest");
  const bag = await OperationsManifestBag.findOne({ _id: asObjectId(bagIdValue, "Bag"), manifestId }).exec();
  if (!bag) throw new OperationsManifestServiceError("Bag was not found.", 404);
  if (!(["OPEN", "REOPENED"] as string[]).includes(bag.status)) throw new OperationsManifestServiceError("Only an open bag can be closed.", 409);
  const consignments = await OperationsManifestConsignment.find({ manifestId, bagId: bag._id, status: { $ne: "REMOVED" } }).exec();
  if (!consignments.length) throw new OperationsManifestServiceError("An empty bag cannot be closed.", 409);
  if (consignments.some((item) => item.status !== "COMPLETE")) throw new OperationsManifestServiceError("Scan every parcel for each consignment before closing this bag.", 409);
  if (!isOperationsBagWeightAllowed(bag.totalWeightKg)) throw new OperationsManifestServiceError("This bag exceeds the 31 kg maximum. Remove or move a consignment before closing it.", 409);
  bag.status = "CLOSED";
  bag.closedBy = userId;
  bag.closedAt = new Date();
  await bag.save();
  await recalculateTotals(manifestId);
  await audit("OPERATIONS_BAG_UPDATED", manifestId, userId, { bagId: bag._id, status: "CLOSED" });
  return bag;
}

export async function reopenOperationsBag(manifestIdValue: string, bagIdValue: string, reason: string, userId: mongoose.Types.ObjectId) {
  const manifestId = asObjectId(manifestIdValue, "Operations manifest");
  const manifest = await OperationsManifest.findById(manifestId).exec();
  if (!manifest || !isEditable(manifest)) throw new OperationsManifestServiceError("This manifest cannot be reopened.", 409);
  const bag = await OperationsManifestBag.findOne({ _id: asObjectId(bagIdValue, "Bag"), manifestId }).exec();
  if (!bag || bag.status !== "CLOSED") throw new OperationsManifestServiceError("Only a closed bag can be reopened.", 409);
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
  if (String(consignment.bagId) === String(target._id)) throw new OperationsManifestServiceError("This consignment is already assigned to the selected bag.", 409);
  const source = await OperationsManifestBag.findById(consignment.bagId).exec();
  if (source?.status === "CLOSED") throw new OperationsManifestServiceError("Reopen the current bag before moving this consignment.", 409);
  const targetConsignments = await OperationsManifestConsignment.find({ manifestId, bagId: target._id, status: { $ne: "REMOVED" } }).lean().exec();
  const targetCommittedWeight = targetConsignments.reduce((total, item) => total + (item.parcelWeightSnapshots?.length
    ? item.parcelWeightSnapshots.reduce((sum, parcel) => sum + parcel.weightKg, 0)
    : item.weightKg), 0);
  const movedCommittedWeight = consignment.parcelWeightSnapshots.length
    ? consignment.parcelWeightSnapshots.reduce((sum, parcel) => sum + parcel.weightKg, 0)
    : consignment.weightKg;
  if (!isOperationsBagWeightAllowed(targetCommittedWeight + movedCommittedWeight)) {
    throw new OperationsManifestServiceError(`${target.bagNumber} has insufficient capacity. A bag cannot exceed 31 kg.`, 409);
  }
  consignment.bagId = target._id as mongoose.Types.ObjectId;
  await consignment.save();
  await OperationsManifestScan.updateMany({ consignmentId: consignment._id, status: "ACCEPTED" }, { $set: { bagId: target._id } }).exec();
  await recalculateTotals(manifestId);
  await audit("OPERATIONS_BAG_UPDATED", manifestId, input.userId, { consignmentId: consignment._id, sourceBagId: source?._id, targetBagId: target._id, reason: input.reason });
}

export async function cancelOperationsBag(manifestIdValue: string, bagIdValue: string, reason: string, userId: mongoose.Types.ObjectId) {
  const manifestId = asObjectId(manifestIdValue, "Operations manifest");
  const manifest = await OperationsManifest.findById(manifestId).exec();
  if (!manifest || !isEditable(manifest)) throw new OperationsManifestServiceError("This bag cannot be cancelled.", 409);
  const bag = await OperationsManifestBag.findOne({ _id: asObjectId(bagIdValue, "Bag"), manifestId, status: { $ne: "CANCELLED" } }).exec();
  if (!bag) throw new OperationsManifestServiceError("Bag was not found.", 404);
  const activeScans = await OperationsManifestScan.countDocuments({ manifestId, bagId: bag._id, status: "ACCEPTED" }).exec();
  if (activeScans) throw new OperationsManifestServiceError("Remove or move every parcel before cancelling this bag.", 409);
  bag.status = "CANCELLED";
  bag.cancelledBy = userId;
  bag.cancelledAt = new Date();
  bag.correctionReason = reason;
  await bag.save();
  await recalculateTotals(manifestId);
  await audit("OPERATIONS_BAG_UPDATED", manifestId, userId, { bagId: bag._id, status: "CANCELLED", reason });
}

function sealingIssues(manifest: IOperationsManifest, bags: Array<{ status: string; totalWeightKg?: number }>, consignments: Array<{ status: string; declaredValueMinor?: number | null }>) {
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
  if (consignments.some((item) => item.status !== "COMPLETE")) issues.push("Every consignment must be completely scanned.");
  if (consignments.some((item) => !item.declaredValueMinor)) issues.push("Enter the goods value for every consignment.");
  return issues;
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
      manifest.sealedSnapshot = JSON.parse(JSON.stringify({
        version: 1,
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
        consignments,
        sealedAt: new Date().toISOString(),
        sealedBy: userId
      }));
      manifest.status = "SEALED";
      manifest.sealedAt = new Date();
      manifest.sealedBy = userId;
      await manifest.save({ session });
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
  const manifest = await OperationsManifest.findById(asObjectId(manifestIdValue, "Operations manifest")).exec();
  if (!manifest || manifest.status !== "SEALED") throw new OperationsManifestServiceError("Only a sealed manifest can be dispatched.", 409);
  manifest.status = "DISPATCHED";
  manifest.dispatchedAt = new Date();
  manifest.dispatchedBy = userId;
  await manifest.save();
  await audit("OPERATIONS_MANIFEST_DISPATCHED", manifest._id as mongoose.Types.ObjectId, userId, { dispatchedAt: manifest.dispatchedAt });
  return manifest;
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
      $or: [{ parcelWeightSnapshots: { $exists: false } }, { parcelWeightSnapshots: { $size: 0 } }]
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
      consignment.parcelWeightSnapshots = snapshot.parcels.map((parcel) => ({
        parcelNumber: parcel.swiftlineParcelNumber.toUpperCase(),
        weightKg: roundWeight(parcel.actualWeightKg)
      }));
      consignment.weightKg = calculateScannedParcelWeight(consignment);
      await consignment.save();
      changed = true;
    }
  }

  if (changed) await recalculateTotals(manifest._id as mongoose.Types.ObjectId);
}

export async function getOperationsManifestDetail(manifestIdValue: string, options?: { latestScanId?: string }) {
  const manifestId = asObjectId(manifestIdValue, "Operations manifest");
  const manifestDocument = await OperationsManifest.findById(manifestId).exec();
  if (!manifestDocument) throw new OperationsManifestServiceError("Operations manifest was not found.", 404);
  await normalizeEditableManifestData(manifestDocument);
  const [manifest, bags, consignments, scans] = await Promise.all([
    OperationsManifest.findById(manifestId).lean().exec(),
    OperationsManifestBag.find({ manifestId }).sort({ sequence: 1 }).lean().exec(),
    OperationsManifestConsignment.find({ manifestId, status: { $ne: "REMOVED" } }).sort({ createdAt: 1 }).lean().exec(),
    OperationsManifestScan.find({ manifestId }).sort({ scannedAt: -1 }).limit(50).lean().exec()
  ]);
  if (!manifest) throw new OperationsManifestServiceError("Operations manifest was not found.", 404);
  const branch = await Branch.findById(manifest.branchId).select("name code address contact").lean().exec();
  const latestScan = options?.latestScanId
    ? scans.find((scan) => String(scan._id) === options.latestScanId)
    : scans[0];
  return {
    manifest: { ...serializeManifest(manifest as unknown as IOperationsManifest), branch },
    bags: bags.map((bag) => ({ ...bag, id: String(bag._id), manifestId: String(bag.manifestId) })),
    consignments: consignments.map((item) => ({
      ...item,
      id: String(item._id),
      manifestId: String(item.manifestId),
      bagId: String(item.bagId),
      shipmentDraftId: String(item.shipmentDraftId),
      dpdShipmentId: String(item.dpdShipmentId),
      businessAccountId: String(item.businessAccountId),
      displayConsignmentNumber: formatManifestConsignmentNumber(item.consignmentNumber),
      goodsValueRequired: !item.declaredValueMinor,
      dpdWarning: item.dpdLabelGenerated ? "" : "DPD label has not been generated. This shipment uses Swiftline internal labels only."
    })),
    scans: scans.map((scan) => ({ ...scan, id: String(scan._id), manifestId: String(scan.manifestId), bagId: scan.bagId ? String(scan.bagId) : null })),
    latestScan: latestScan ? { ...latestScan, id: String(latestScan._id) } : null,
    sealingIssues: sealingIssues(
      manifest as unknown as IOperationsManifest,
      bags.filter((bag) => bag.status !== "CANCELLED"),
      consignments
    )
  };
}

type SealedSnapshot = {
  manifestNumber: string;
  header: IOperationsManifest["header"];
  branch: Record<string, unknown>;
  totals: { totalBags: number; totalConsignments: number; totalPhysicalParcels: number; totalWeightKg: number };
  bags: Array<Record<string, unknown> & { _id: unknown; bagNumber: string }>;
  consignments: Array<Record<string, unknown> & {
    bagId: unknown;
    shipmentDraftId: mongoose.Types.ObjectId;
    dpdShipmentId: mongoose.Types.ObjectId;
    consignmentNumber: string;
    manifestPieces: number;
    weightKg: number;
    consignorSnapshot: Record<string, unknown>;
    consigneeSnapshot: Record<string, unknown>;
    description: string;
    declaredValueMinor: number;
    currency: "INR";
    serviceInfo: string;
  }>;
  sealedAt: string;
};

function readSealedSnapshot(manifest: IOperationsManifest) {
  const snapshot = manifest.sealedSnapshot as Partial<SealedSnapshot>;
  if (!snapshot || !snapshot.header || !snapshot.branch || !snapshot.totals || !Array.isArray(snapshot.bags) || !Array.isArray(snapshot.consignments)) {
    throw new OperationsManifestServiceError("The sealed manifest snapshot is unavailable.", 409);
  }
  return snapshot as SealedSnapshot;
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
  return spread;
}

export async function buildOperationsManifestExcel(manifest: IOperationsManifest) {
  const snapshot = readSealedSnapshot(manifest);
  const bagById = new Map(snapshot.bags.map((bag) => [String(bag._id), bag.bagNumber]));
  const virtualManifest = {
    manifestNumber: snapshot.manifestNumber,
    businessAccountId: new mongoose.Types.ObjectId(),
    branchId: manifest.branchId,
    shipmentDraftIds: snapshot.consignments.map((item) => item.shipmentDraftId),
    headerSnapshot: {
      originBranch: [String(snapshot.branch.name ?? ""), String(snapshot.branch.code ?? "")].filter(Boolean).join(" - "),
      originAddress: formatManifestOrigin(snapshot.branch),
      destinationAgent: snapshot.header.destinationAgent,
      flightNumber: snapshot.header.flightNumber,
      departureDate: snapshot.header.departureDate,
      mawbNumber: snapshot.header.mawbNumber,
      originIataCode: snapshot.header.originIataCode,
      destinationIataCode: snapshot.header.destinationIataCode,
      valueType: snapshot.header.valueType
    },
    lineSnapshots: snapshot.consignments.map((item) => ({
      shipmentDraftId: item.shipmentDraftId,
      dpdShipmentId: item.dpdShipmentId,
      consignmentNumber: item.consignmentNumber,
      pieces: 1,
      weightKg: item.weightKg,
      consignor: { formatted: normalizedManifestAddress(item.consignorSnapshot.formatted) },
      consignee: { formatted: normalizedManifestAddress(item.consigneeSnapshot.formatted) },
      description: item.description,
      declaredValueMinor: item.declaredValueMinor,
      currency: item.currency,
      bagNumber: bagById.get(String(item.bagId)) ?? "",
      serviceInfo: item.serviceInfo
    })),
    totalPieces: snapshot.totals.totalConsignments,
    totalWeightKg: snapshot.totals.totalWeightKg,
    totalBags: snapshot.totals.totalBags,
    actorRole: "admin",
    generatedAt: new Date(snapshot.sealedAt)
  };
  return buildShipmentManifestWorkbook(virtualManifest as never);
}

export async function buildOperationsManifestPdf(manifest: IOperationsManifest) {
  const snapshot = readSealedSnapshot(manifest);
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
    const bagById = new Map(snapshot.bags.map((bag) => [String(bag._id), bag.bagNumber]));
    snapshot.consignments.forEach((item, index) => {
      const blockHeight = 112;
      if (y + blockHeight > document.page.height - 28) { document.addPage(); y = document.page.margins.top; headers.forEach((header, column) => drawCell(column, y, 30, header, { bold: true })); y += 30; }
      const consignorLines = spacedPdfAddress(item.consignorSnapshot.formatted);
      const consigneeLines = spacedPdfAddress(item.consigneeSnapshot.formatted);
      for (let row = 0; row < 10; row += 1) {
        const values = row === 0
          ? [index + 1, formatManifestConsignmentNumber(item.consignmentNumber), 1, item.weightKg.toFixed(3), consignorLines[0] ?? "", consigneeLines[0] ?? "", item.description, (item.declaredValueMinor / 100).toFixed(2), item.currency, bagById.get(String(item.bagId)) ?? "", item.serviceInfo]
          : ["", "", "", "", consignorLines[row] ?? "", consigneeLines[row] ?? "", "", "", "", "", ""];
        values.forEach((value, column) => drawCell(column, y, 11.2, value, { align: column === 4 || column === 5 || column === 6 ? "center" : "center", size: 6.5 }));
        y += 11.2;
      }
    });
    document.font("Helvetica").fontSize(7).text("Swiftline Portal | Computer Generated Operations Manifest", left, document.page.height - 18, { width: totalWidth, align: "center" });
    document.end();
  });
}
