import crypto from "crypto";
import mongoose from "mongoose";
import { AuditLog } from "../models/auditLog.model.js";
import { Branch } from "../models/branch.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { BusinessAccountMember, shipmentBookingRoles } from "../models/businessAccountMember.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { DriverProfile } from "../models/driverProfile.model.js";
import { PickupAttempt } from "../models/pickupAttempt.model.js";
import { PickupCounter } from "../models/pickupCounter.model.js";
import { PickupProof, PickupScan } from "../models/pickupEvidence.model.js";
import { PickupRequest, reschedulablePickupStatuses } from "../models/pickupRequest.model.js";
import { PickupRequestShipment } from "../models/pickupRequestShipment.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentEvent, type ShipmentEventStatus } from "../models/shipmentEvent.model.js";
import { User } from "../models/user.model.js";
import { sendPickupOtpEmail } from "./mail.service.js";
import { notifyBusinessShipmentMembers, notifyOperationsStaff, notifyPortalUsers } from "./portalNotification.service.js";

const pickupBlockedStatuses: ShipmentEventStatus[] = [
  "SHIPMENT_CANCELLED", "PARCEL_COLLECTED", "WAREHOUSE_SCAN_IN", "EXPORT_CUSTOMS_CLEARED",
  "FLIGHT_ASSIGNED", "FLIGHT_DEPARTED", "DESTINATION_ARRIVED", "IMPORT_CUSTOMS_CLEARANCE",
  "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED", "LOST", "DAMAGED"
];

export class PickupServiceError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
    this.name = "PickupServiceError";
  }
}

async function notifyPickupSafely(task: () => Promise<void>) {
  try { await task(); }
  catch (error) { console.error("Pickup notification failed.", { message: error instanceof Error ? error.message : "Unknown error" }); }
}

function asObjectId(value: string, label: string) {
  if (!mongoose.Types.ObjectId.isValid(value)) throw new PickupServiceError(`${label} was not found.`, 404);
  return new mongoose.Types.ObjectId(value);
}

function normalized(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

type PickupAddressInput = {
  addressLine1: string;
  addressLine2?: string;
  townOrCity: string;
  county?: string;
  postcode: string;
  countryCode: string;
  countryName?: string;
  googlePlaceId?: string;
};

async function loadClientPickupAccess(userId: mongoose.Types.ObjectId) {
  const memberships = await BusinessAccountMember.find({
    user: userId,
    status: "active",
    role: { $in: shipmentBookingRoles }
  }).select("businessAccount assignedBranches").lean().exec();
  const accounts = await BusinessAccount.find({ _id: { $in: memberships.map((membership) => membership.businessAccount) } })
    .select("assignedBranch")
    .lean()
    .exec();
  const defaultBranchByAccount = new Map(accounts.map((account) => [String(account._id), account.assignedBranch ? String(account.assignedBranch) : ""]));
  const branchesByAccount = new Map<string, Set<string>>();
  for (const membership of memberships) {
    const explicitBranches = (membership.assignedBranches ?? []).map(String);
    const branchIds = explicitBranches.length ? explicitBranches : [defaultBranchByAccount.get(String(membership.businessAccount)) ?? ""];
    branchesByAccount.set(String(membership.businessAccount), new Set(branchIds.filter(Boolean)));
  }
  return (draft: { businessAccountId: unknown; branchId: unknown }) => branchesByAccount.get(String(draft.businessAccountId))?.has(String(draft.branchId)) ?? false;
}

export function pickupAddressFingerprint(address: Record<string, unknown>) {
  return ["countryCode", "postcode", "addressLine1", "addressLine2", "townOrCity", "county"]
    .map((field) => normalized(address[field]))
    .join("|");
}

function indiaDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "2-digit"
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { display: `${value("day")}${value("month")}${value("year")}`, key: `${value("year")}${value("month")}${value("day")}` };
}

async function allocatePickupNumber(branchId: mongoose.Types.ObjectId, session: mongoose.ClientSession) {
  const branch = await Branch.findById(branchId).select("labelCode code").session(session).lean().exec();
  if (!branch) throw new PickupServiceError("Pickup branch was not found.", 409);
  const stationCode = normalized(branch.labelCode || branch.code).slice(0, 4);
  if (!stationCode) throw new PickupServiceError("Configure the branch station code before creating pickups.", 409);
  const date = indiaDateParts();
  const counter = await PickupCounter.findOneAndUpdate(
    { stationCode, dateKey: date.key },
    { $inc: { sequence: 1 }, $setOnInsert: { stationCode, dateKey: date.key } },
    { upsert: true, returnDocument: "after", session }
  ).exec();
  return `SLP${stationCode}${date.display}${String(counter?.sequence ?? 1).padStart(3, "0")}`;
}

async function latestBlockingEvents(draftIds: mongoose.Types.ObjectId[]) {
  const events = await ShipmentEvent.find({ shipmentDraftId: { $in: draftIds } })
    .sort({ eventAt: -1, createdAt: -1 })
    .lean()
    .exec();
  const byDraft = new Map<string, ShipmentEventStatus[]>();
  for (const event of events) {
    const key = String(event.shipmentDraftId);
    byDraft.set(key, [...(byDraft.get(key) ?? []), event.status]);
  }
  return byDraft;
}

export async function listEligiblePickupShipments(userId: mongoose.Types.ObjectId) {
  const bookings = await DpdShipment.find({ status: "LABEL_RECEIVED" }).select("shipmentDraftId swiftlineTrackingNumber dpdShipmentId parcelNumbers snapshotRevision createdAt").lean().exec();
  if (!bookings.length) return [];
  const drafts = await ShipmentDraft.find({ _id: { $in: bookings.map((booking) => booking.shipmentDraftId) }, bookingState: "BOOKED" })
    .select("businessAccountId branchId consignorAddress parcelList parcelCount createdAt")
    .sort({ createdAt: -1 })
    .lean()
    .exec();
  const [activeLinks, events, canAccess] = await Promise.all([
    PickupRequestShipment.find({ shipmentDraftId: { $in: drafts.map((draft) => draft._id) }, active: true }).select("shipmentDraftId").lean().exec(),
    latestBlockingEvents(drafts.map((draft) => draft._id)),
    loadClientPickupAccess(userId)
  ]);
  const activeIds = new Set(activeLinks.map((link) => String(link.shipmentDraftId)));
  const bookingByDraft = new Map(bookings.map((booking) => [String(booking.shipmentDraftId), booking]));
  const result = [];
  for (const draft of drafts) {
    if (!canAccess(draft)) continue;
    const statuses = events.get(String(draft._id)) ?? [];
    if (activeIds.has(String(draft._id)) || statuses.some((status) => pickupBlockedStatuses.includes(status)) || statuses[0] === "ON_HOLD") continue;
    const booking = bookingByDraft.get(String(draft._id));
    const parcelNumbers = Array.isArray(booking?.parcelNumbers)
      ? booking.parcelNumbers.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const parcelList = Array.isArray(draft.parcelList) ? draft.parcelList : [];
    const pickupAddress = draft.consignorAddress && typeof draft.consignorAddress === "object"
      ? draft.consignorAddress as unknown as Record<string, unknown>
      : null;
    if (!booking || !parcelNumbers.length || !pickupAddress) continue;
    result.push({
      shipmentDraftId: String(draft._id),
      businessAccountId: String(draft.businessAccountId),
      branchId: String(draft.branchId),
      trackingNumber: booking.swiftlineTrackingNumber || booking.dpdShipmentId || String(booking._id),
      parcelNumbers,
      parcelCount: parcelNumbers.length,
      totalWeightKg: parcelList.reduce((sum, parcel) => sum + Number(parcel.weightKg || 0), 0),
      pickupAddress,
      addressFingerprint: pickupAddressFingerprint(pickupAddress),
      bookedAt: booking.createdAt
    });
  }
  return result;
}

export async function createClientPickup(input: {
  userId: mongoose.Types.ObjectId;
  shipmentDraftIds: string[];
  requestedWindow: { startAt: Date; endAt: Date; timezone: string };
  contact: { name: string; email?: string; phone: string };
  pickupAddress: PickupAddressInput;
  instructions?: string;
}) {
  const uniqueIds = [...new Set(input.shipmentDraftIds)];
  if (!uniqueIds.length || uniqueIds.length > 100) throw new PickupServiceError("Select between 1 and 100 booked shipments.");
  if (uniqueIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) throw new PickupServiceError("One or more selected shipments are invalid.");
  if (input.requestedWindow.startAt >= input.requestedWindow.endAt || input.requestedWindow.endAt <= new Date()) {
    throw new PickupServiceError("Select a valid future pickup window.");
  }

  const ids = uniqueIds.map((id) => new mongoose.Types.ObjectId(id));
  const drafts = await ShipmentDraft.find({ _id: { $in: ids }, bookingState: "BOOKED" }).exec();
  if (drafts.length !== ids.length) throw new PickupServiceError("Every selected shipment must be fully booked before pickup can be requested.", 409);
  const canAccess = await loadClientPickupAccess(input.userId);
  if (drafts.some((draft) => !canAccess(draft))) throw new PickupServiceError("One or more selected shipments are not available to your login.", 403);
  const accountIds = new Set(drafts.map((draft) => String(draft.businessAccountId)));
  const branchIds = new Set(drafts.map((draft) => String(draft.branchId)));
  if (accountIds.size !== 1 || branchIds.size !== 1) throw new PickupServiceError("A pickup request can contain shipments from one account and branch only.");

  const bookings = await DpdShipment.find({ shipmentDraftId: { $in: ids }, status: "LABEL_RECEIVED" }).exec();
  if (bookings.length !== ids.length || bookings.some((booking) => !booking.parcelNumbers.length)) {
    throw new PickupServiceError("Every selected shipment needs current parcel labels before pickup can be requested.", 409);
  }
  const events = await latestBlockingEvents(ids);
  if (ids.some((id) => {
    const statuses = events.get(String(id)) ?? [];
    return statuses.some((status) => pickupBlockedStatuses.includes(status)) || statuses[0] === "ON_HOLD";
  })) throw new PickupServiceError("A selected shipment is cancelled, on hold, or has already entered operations.", 409);

  const session = await mongoose.startSession();
  let pickupId: mongoose.Types.ObjectId | null = null;
  try {
    await session.withTransaction(async () => {
      if (await PickupRequestShipment.exists({ shipmentDraftId: { $in: ids }, active: true }).session(session)) {
        throw new PickupServiceError("A selected shipment already belongs to an active pickup request.", 409);
      }
      const branchId = drafts[0]!.branchId;
      const requestNumber = await allocatePickupNumber(branchId, session);
      const parcelCount = bookings.reduce((sum, booking) => sum + booking.parcelNumbers.length, 0);
      const totalWeightKg = drafts.reduce((sum, draft) => sum + draft.parcelList.reduce((parcelSum, parcel) => parcelSum + Number(parcel.weightKg || 0), 0), 0);
      const pickup = new PickupRequest({
        requestNumber,
        businessAccountId: drafts[0]!.businessAccountId,
        branchId,
        requestedBy: input.userId,
        source: "CLIENT_PORTAL",
        status: "REQUESTED",
        addressFingerprint: pickupAddressFingerprint(input.pickupAddress),
        pickupAddress: input.pickupAddress,
        pickupContact: input.contact,
        requestedWindow: input.requestedWindow,
        instructions: input.instructions ?? "",
        shipmentCount: drafts.length,
        parcelCount,
        totalWeightKg
      });
      await pickup.save({ session });
      pickupId = pickup._id as mongoose.Types.ObjectId;
      const bookingByDraft = new Map(bookings.map((booking) => [String(booking.shipmentDraftId), booking]));
      await PickupRequestShipment.insertMany(drafts.map((draft) => {
        const booking = bookingByDraft.get(String(draft._id))!;
        return {
          pickupRequestId: pickup._id,
          shipmentDraftId: draft._id,
          dpdShipmentId: booking._id,
          trackingNumber: booking.swiftlineTrackingNumber || booking.dpdShipmentId || String(booking._id),
          snapshotRevision: booking.snapshotRevision || 1,
          shipmentSnapshot: { consignorAddress: draft.consignorAddress, parcelList: draft.parcelList },
          parcels: booking.parcelNumbers.map((parcelNumber, index) => ({
            parcelNumber,
            weightKg: Number(draft.parcelList[index]?.weightKg || 0),
            status: "PENDING"
          })),
          status: "PENDING",
          active: true
        };
      }), { session });
      await AuditLog.create([{
        action: "PICKUP_REQUEST_CREATED", entityType: "PICKUP_REQUEST", entityId: pickup._id,
        performedBy: input.userId, performedAt: new Date(), metadata: { requestNumber, shipmentCount: drafts.length, parcelCount }
      }], { session });
    });
  } finally {
    await session.endSession();
  }
  if (!pickupId) throw new PickupServiceError("Pickup request could not be created.", 500);
  const detail = await getPickupDetail(String(pickupId));
  await notifyPickupSafely(() => notifyOperationsStaff({
    type: "PICKUP_REQUESTED",
    title: "New pickup request",
    message: `${detail.requestNumber} contains ${detail.shipmentCount} shipment${detail.shipmentCount === 1 ? "" : "s"} and ${detail.parcelCount} parcel${detail.parcelCount === 1 ? "" : "s"}.`,
    href: "/dashboard/pickups",
    idempotencyKey: `PICKUP_REQUESTED:${String(pickupId)}:STAFF`,
    businessAccountId: detail.businessAccountId,
    metadata: { pickupRequestId: pickupId, branchId: detail.branchId }
  }));
  return detail;
}

export async function getPickupDetail(id: string) {
  const request = await PickupRequest.findById(asObjectId(id, "Pickup request"))
    .populate("branchId", "name code labelCode")
    .populate("cancelledBy", "firstName lastName name role")
    .lean()
    .exec();
  if (!request) throw new PickupServiceError("Pickup request was not found.", 404);
  const [shipments, attempts, proofs] = await Promise.all([
    PickupRequestShipment.find({ pickupRequestId: request._id }).sort({ createdAt: 1 }).lean().exec(),
    PickupAttempt.find({ pickupRequestId: request._id }).sort({ sequence: -1 })
      .populate("assignedDriverProfileId", "deliverySubrole engagementType status")
      .populate("assignedDriverUserId", "firstName lastName name phone profileImage")
      .lean().exec(),
    PickupProof.find({ pickupRequestId: request._id }).select("pickupAttemptId type originalName size capturedAt").lean().exec()
  ]);
  const proofsByAttempt = new Map<string, Array<{ id: string; type: string; originalName: string; size: number; capturedAt: Date }>>();
  for (const proof of proofs) {
    const key = String(proof.pickupAttemptId);
    proofsByAttempt.set(key, [...(proofsByAttempt.get(key) ?? []), { id: String(proof._id), type: proof.type, originalName: proof.originalName, size: proof.size, capturedAt: proof.capturedAt }]);
  }
  return {
    ...request,
    id: String(request._id),
    shipments,
    attempts: attempts.map((attempt) => ({ ...attempt, proofs: proofsByAttempt.get(String(attempt._id)) ?? [] }))
  };
}

export async function listPickupRequests(filter: Record<string, unknown>) {
  const items = await PickupRequest.find(filter).sort({ createdAt: -1 }).limit(200)
    .populate("branchId", "name code labelCode")
    .populate("cancelledBy", "firstName lastName name role")
    .lean().exec();
  return items.map((item) => ({ ...item, id: String(item._id) }));
}

export async function cancelPickup(input: {
  pickupId: string;
  actorId: mongoose.Types.ObjectId;
  source: "CLIENT" | "ADMIN";
  reason: string;
}) {
  const requestId = asObjectId(input.pickupId, "Pickup request");
  const request = await PickupRequest.findById(requestId).exec();
  if (!request) throw new PickupServiceError("Pickup request was not found.", 404);
  // A driver being assigned, or a pickup being missed, is still before any
  // collection work- both remain cancellable.
  if (!["REQUESTED", "CONFIRMED", "DRIVER_ASSIGNED", "ACTION_REQUIRED", "MISSED"].includes(request.status)) {
    throw new PickupServiceError("This pickup can no longer be cancelled because collection work has started.", 409);
  }
  const attempt = request.currentAttemptId ? await PickupAttempt.findById(request.currentAttemptId).exec() : null;
  if (attempt && !["SCHEDULED", "ASSIGNED"].includes(attempt.status)) {
    throw new PickupServiceError("This pickup can no longer be cancelled because the driver has started the assignment.", 409);
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const now = new Date();
      request.status = "CANCELLED";
      request.cancelledBy = input.actorId;
      request.cancelledAt = now;
      request.cancellationReason = input.reason.trim();
      request.cancellationSource = input.source;
      request.version += 1;
      await request.save({ session });
      if (attempt) {
        attempt.status = "CANCELLED";
        await attempt.save({ session });
      }
      await PickupRequestShipment.updateMany({ pickupRequestId: request._id, active: true }, { $set: { active: false, status: "CANCELLED" } }, { session }).exec();
      await AuditLog.create([{
        action: "PICKUP_REQUEST_UPDATED",
        entityType: "PICKUP_REQUEST",
        entityId: request._id,
        performedBy: input.actorId,
        performedAt: now,
        metadata: { status: "CANCELLED", cancellationSource: input.source, reason: request.cancellationReason }
      }], { session });
    });
  } finally { await session.endSession(); }

  if (input.source === "CLIENT") {
    await notifyPickupSafely(() => notifyOperationsStaff({
      type: "PICKUP_CANCELLED",
      title: "Pickup cancelled by client",
      message: `${request.requestNumber} was cancelled by the client.`,
      href: "/dashboard/pickups",
      idempotencyKey: `PICKUP_CANCELLED:${String(request._id)}:STAFF`,
      businessAccountId: request.businessAccountId,
      metadata: { pickupRequestId: request._id, cancellationSource: input.source }
    }));
  } else {
    await notifyPickupSafely(() => notifyBusinessShipmentMembers(request.businessAccountId, {
      type: "PICKUP_CANCELLED",
      title: "Pickup cancelled",
      message: `${request.requestNumber} was cancelled by Swiftline.`,
      href: "/client/pickups",
      idempotencyKey: `PICKUP_CANCELLED:${String(request._id)}:CLIENT`,
      businessAccountId: request.businessAccountId,
      metadata: { pickupRequestId: request._id, cancellationSource: input.source }
    }));
  }
  if (attempt?.assignedDriverUserId) await notifyPickupSafely(() => notifyPortalUsers([attempt.assignedDriverUserId as mongoose.Types.ObjectId], {
    type: "PICKUP_CANCELLED",
    title: "Assigned pickup cancelled",
    message: `${request.requestNumber} is no longer scheduled for collection.`,
    href: "/driver",
    idempotencyKey: `PICKUP_CANCELLED:${String(request._id)}:DRIVER`,
    businessAccountId: request.businessAccountId,
    metadata: { pickupRequestId: request._id }
  }));
  return getPickupDetail(input.pickupId);
}

/**
 * Records that nobody collected.
 *
 * Staff-only and deliberately not terminal: the request stays alive so it can
 * be rescheduled, which is what a customer wants after a missed collection.
 * Ending it instead would force them to raise the whole request again.
 */
export async function markPickupMissed(input: {
  pickupId: string;
  actorId: mongoose.Types.ObjectId;
  reason: string;
}) {
  const request = await PickupRequest.findById(asObjectId(input.pickupId, "Pickup request")).exec();
  if (!request) throw new PickupServiceError("Pickup request was not found.", 404);
  if (!["REQUESTED", "CONFIRMED", "DRIVER_ASSIGNED", "IN_PROGRESS", "ACTION_REQUIRED"].includes(request.status)) {
    throw new PickupServiceError("Only a pickup still awaiting collection can be marked missed.", 409);
  }

  request.status = "MISSED";
  request.version += 1;
  await request.save();

  // The attempt is closed off too, or the driver keeps an assignment for a
  // collection everyone agrees did not happen.
  if (request.currentAttemptId) {
    await PickupAttempt.findByIdAndUpdate(request.currentAttemptId, { $set: { status: "FAILED" } }).exec();
  }

  await AuditLog.create({
    action: "PICKUP_REQUEST_UPDATED",
    entityType: "PICKUP_REQUEST",
    entityId: request._id,
    performedBy: input.actorId,
    performedAt: new Date(),
    metadata: { status: "MISSED", reason: input.reason.trim() }
  });

  await notifyPickupSafely(() => notifyPortalUsers([request.requestedBy], {
    type: "PICKUP_MISSED",
    title: "Pickup missed",
    message: `${request.requestNumber} was not collected. ${input.reason.trim()}`,
    href: "/client/pickups",
    idempotencyKey: `PICKUP_MISSED:${String(request._id)}:${request.version}`,
    businessAccountId: request.businessAccountId
  }));

  return getPickupDetail(input.pickupId);
}

/**
 * Moves a pickup to a new window.
 *
 * Reschedule replaces the requested window and returns the request to
 * REQUESTED, because a new window has not been confirmed by anyone yet-
 * leaving it CONFIRMED would assert an agreement to a time nobody agreed to.
 * Any existing attempt is cancelled: it was scheduled against the old window.
 */
export async function reschedulePickup(input: {
  pickupId: string;
  actorId: mongoose.Types.ObjectId;
  source: "CLIENT" | "ADMIN";
  startAt: Date;
  endAt: Date;
  timezone: string;
}) {
  const request = await PickupRequest.findById(asObjectId(input.pickupId, "Pickup request")).exec();
  if (!request) throw new PickupServiceError("Pickup request was not found.", 404);
  if (!reschedulablePickupStatuses.includes(request.status)) {
    throw new PickupServiceError("This pickup can no longer be rescheduled.", 409);
  }
  if (input.endAt <= input.startAt) {
    throw new PickupServiceError("The pickup window must end after it starts.", 400);
  }
  if (input.startAt.getTime() < Date.now()) {
    throw new PickupServiceError("Choose a pickup window in the future.", 400);
  }

  const previous = { ...request.requestedWindow };
  request.requestedWindow = { startAt: input.startAt, endAt: input.endAt, timezone: input.timezone };
  request.confirmedWindow = null;
  request.status = "REQUESTED";
  request.version += 1;
  await request.save();

  if (request.currentAttemptId) {
    await PickupAttempt.findByIdAndUpdate(
      request.currentAttemptId,
      { $set: { status: "CANCELLED" } }
    ).exec();
    request.currentAttemptId = null;
    await request.save();
  }

  await AuditLog.create({
    action: "PICKUP_REQUEST_UPDATED",
    entityType: "PICKUP_REQUEST",
    entityId: request._id,
    performedBy: input.actorId,
    performedAt: new Date(),
    metadata: {
      status: "RESCHEDULED",
      source: input.source,
      from: { startAt: previous.startAt, endAt: previous.endAt },
      to: { startAt: input.startAt, endAt: input.endAt }
    }
  });

  await notifyPickupSafely(() => notifyOperationsStaff({
    type: "PICKUP_RESCHEDULED",
    title: "Pickup rescheduled",
    message: `${request.requestNumber} moved to a new window.`,
    href: `/dashboard/pickups`,
    idempotencyKey: `PICKUP_RESCHEDULED:${String(request._id)}:${request.version}`,
    businessAccountId: request.businessAccountId
  }));

  return getPickupDetail(input.pickupId);
}

export async function confirmPickup(input: {
  pickupId: string; actorId: mongoose.Types.ObjectId;
  scheduledWindow: { startAt: Date; endAt: Date; timezone: string };
}) {
  if (input.scheduledWindow.startAt >= input.scheduledWindow.endAt || input.scheduledWindow.endAt <= new Date()) throw new PickupServiceError("Select a valid future pickup window.");
  const session = await mongoose.startSession();
  let attemptId: mongoose.Types.ObjectId | null = null;
  try {
    await session.withTransaction(async () => {
      const request = await PickupRequest.findOne({ _id: asObjectId(input.pickupId, "Pickup request"), status: { $in: ["REQUESTED", "ACTION_REQUIRED", "PARTIALLY_COLLECTED"] } }).session(session).exec();
      if (!request) throw new PickupServiceError("This pickup cannot be scheduled in its current status.", 409);
      if (request.status === "PARTIALLY_COLLECTED") {
        const remainingLinks = await PickupRequestShipment.find({ pickupRequestId: request._id, active: true }).session(session).exec();
        for (const link of remainingLinks) {
          for (const parcel of link.parcels) {
            if (parcel.status !== "COLLECTED") {
              parcel.status = "PENDING";
              parcel.exceptionReason = "";
            }
          }
          link.status = link.parcels.some((parcel) => parcel.status === "COLLECTED") ? "PARTIAL" : "PENDING";
          await link.save({ session });
        }
      }
      const sequence = await PickupAttempt.countDocuments({ pickupRequestId: request._id }).session(session) + 1;
      const [attempt] = await PickupAttempt.create([{
        pickupRequestId: request._id, sequence, status: "SCHEDULED", scheduledWindow: input.scheduledWindow
      }], { session });
      if (!attempt) throw new PickupServiceError("Pickup attempt could not be scheduled.", 500);
      attemptId = attempt._id as mongoose.Types.ObjectId;
      request.confirmedWindow = input.scheduledWindow;
      request.currentAttemptId = attempt._id as mongoose.Types.ObjectId;
      request.status = "CONFIRMED";
      request.version += 1;
      await request.save({ session });
      await AuditLog.create([{ action: "PICKUP_ATTEMPT_CREATED", entityType: "PICKUP_ATTEMPT", entityId: attempt._id, performedBy: input.actorId, performedAt: new Date(), metadata: { pickupRequestId: request._id, sequence } }], { session });
    });
  } finally { await session.endSession(); }
  const detail = await getPickupDetail(input.pickupId);
  await notifyPickupSafely(() => notifyBusinessShipmentMembers(detail.businessAccountId, {
    type: "PICKUP_CONFIRMED",
    title: "Pickup confirmed",
    message: `${detail.requestNumber} is confirmed for ${input.scheduledWindow.startAt.toLocaleString("en-IN", { timeZone: input.scheduledWindow.timezone })}.`,
    href: "/client/pickups",
    idempotencyKey: `PICKUP_CONFIRMED:${String(attemptId)}`,
    businessAccountId: detail.businessAccountId,
    metadata: { pickupRequestId: detail._id, attemptId }
  }));
  return { detail, attemptId: String(attemptId) };
}

export async function assignPickupDriver(input: { pickupId: string; attemptId: string; driverProfileId: string; actorId: mongoose.Types.ObjectId; vehicle: Record<string, string> }) {
  const request = await PickupRequest.findById(asObjectId(input.pickupId, "Pickup request")).exec();
  const attempt = await PickupAttempt.findOne({ _id: asObjectId(input.attemptId, "Pickup attempt"), pickupRequestId: request?._id, status: { $in: ["SCHEDULED", "ASSIGNED"] } }).exec();
  if (!request || !attempt) throw new PickupServiceError("Pickup attempt was not found or cannot be assigned.", 409);
  const profile = await DriverProfile.findOne({ _id: asObjectId(input.driverProfileId, "Driver"), status: "ACTIVE", deliverySubrole: "DRIVER" }).exec();
  if (!profile) throw new PickupServiceError("Select an active approved driver.", 409);
  const user = await User.findOne({ _id: profile.userId, role: "delivery", userStatus: "active", assignedBranches: request.branchId }).exec();
  if (!user) throw new PickupServiceError("The selected driver is not active for this pickup branch.", 409);
  attempt.assignedDriverProfileId = profile._id as mongoose.Types.ObjectId;
  attempt.assignedDriverUserId = user._id as mongoose.Types.ObjectId;
  attempt.assignedBy = input.actorId;
  attempt.vehicle = input.vehicle;
  attempt.status = "ASSIGNED";
  await attempt.save();
  /**
   * The request follows the attempt.
   *
   * Assignment used to be visible only on the attempt, so a customer watching
   * the request saw "Scheduled" while a driver was already on the way. Guarded
   * so a pickup already in progress is not dragged backwards by a reassignment.
   */
  if (["REQUESTED", "CONFIRMED", "ACTION_REQUIRED", "MISSED"].includes(request.status)) {
    request.status = "DRIVER_ASSIGNED";
    request.version += 1;
    await request.save();
  }
  await AuditLog.create({ action: "PICKUP_ATTEMPT_ASSIGNED", entityType: "PICKUP_ATTEMPT", entityId: attempt._id, performedBy: input.actorId, performedAt: new Date(), metadata: { pickupRequestId: request._id, driverProfileId: profile._id, engagementType: profile.engagementType } });
  await notifyPickupSafely(() => notifyPortalUsers([user._id as mongoose.Types.ObjectId], {
    type: "PICKUP_ASSIGNED",
    title: "Pickup assigned",
    message: `${request.requestNumber} has been assigned to you.`,
    href: "/driver",
    idempotencyKey: `PICKUP_ASSIGNED:${String(attempt._id)}:${String(user._id)}`,
    businessAccountId: request.businessAccountId,
    metadata: { pickupRequestId: request._id, attemptId: attempt._id }
  }));
  return getPickupDetail(input.pickupId);
}

const allowedAttemptTransitions: Record<string, string[]> = {
  ASSIGNED: ["ACCEPTED"], ACCEPTED: ["EN_ROUTE"], EN_ROUTE: ["ARRIVED"], ARRIVED: ["COLLECTING"]
};

type PickupLocation = { latitude: number; longitude: number; accuracy?: number | null };

export async function transitionDriverAttempt(input: { attemptId: string; driverUserId: mongoose.Types.ObjectId; status: string; location?: PickupLocation }) {
  const attempt = await PickupAttempt.findOne({ _id: asObjectId(input.attemptId, "Pickup attempt"), assignedDriverUserId: input.driverUserId }).exec();
  if (!attempt) throw new PickupServiceError("Assigned pickup attempt was not found.", 404);
  if (!(allowedAttemptTransitions[attempt.status] ?? []).includes(input.status)) throw new PickupServiceError(`Pickup cannot move from ${attempt.status} to ${input.status}.`, 409);
  const now = new Date();
  attempt.status = input.status as typeof attempt.status;
  if (input.status === "ACCEPTED") attempt.acceptedAt = now;
  if (input.status === "EN_ROUTE") attempt.enRouteAt = now;
  if (input.status === "ARRIVED") {
    attempt.arrivedAt = now;
    if (input.location) attempt.arrivalLocation = { ...input.location, capturedAt: now };
  }
  if (input.status === "COLLECTING") attempt.collectionStartedAt = now;
  await attempt.save();
  if (["EN_ROUTE", "ARRIVED", "COLLECTING"].includes(input.status)) await PickupRequest.findByIdAndUpdate(attempt.pickupRequestId, { $set: { status: "IN_PROGRESS" }, $inc: { version: 1 } }).exec();
  await AuditLog.create({ action: "PICKUP_ATTEMPT_STATUS_UPDATED", entityType: "PICKUP_ATTEMPT", entityId: attempt._id, performedBy: input.driverUserId, performedAt: now, metadata: { status: input.status } });
  if (input.status === "EN_ROUTE") {
    const request = await PickupRequest.findById(attempt.pickupRequestId).select("businessAccountId requestNumber").lean().exec();
    if (request) await notifyPickupSafely(() => notifyBusinessShipmentMembers(request.businessAccountId, {
      type: "PICKUP_EN_ROUTE",
      title: "Driver en route",
      message: `The driver is on the way for ${request.requestNumber}.`,
      href: "/client/pickups",
      idempotencyKey: `PICKUP_EN_ROUTE:${String(attempt._id)}`,
      businessAccountId: request.businessAccountId,
      metadata: { pickupRequestId: request._id, attemptId: attempt._id }
    }));
  }
  return getPickupDetail(String(attempt.pickupRequestId));
}

export async function sendPickupOtp(input: { attemptId: string; driverUserId: mongoose.Types.ObjectId }) {
  const attempt = await PickupAttempt.findOne({ _id: asObjectId(input.attemptId, "Pickup attempt"), assignedDriverUserId: input.driverUserId, status: { $in: ["ARRIVED", "COLLECTING"] } }).select("+otpHash +otpExpiresAt +otpAttempts +otpSentAt").exec();
  if (!attempt) throw new PickupServiceError("Arrive at the assigned pickup before requesting the verification code.", 409);
  if (attempt.otpSentAt && Date.now() - attempt.otpSentAt.getTime() < 60_000) throw new PickupServiceError("Wait one minute before requesting another code.", 429);
  const request = await PickupRequest.findById(attempt.pickupRequestId).exec();
  if (!request?.pickupContact.email) throw new PickupServiceError("The pickup contact does not have an email address. Request a supervisor-approved OTP exception.", 409);
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  attempt.otpHash = crypto.createHash("sha256").update(code).digest("hex");
  attempt.otpExpiresAt = expiresAt;
  attempt.otpAttempts = 0;
  attempt.otpSentAt = new Date();
  await attempt.save();
  const delivery = await sendPickupOtpEmail({ to: request.pickupContact.email, name: request.pickupContact.name, code, requestNumber: request.requestNumber, expiresAt });
  return { sent: delivery.sent, skipped: delivery.skipped, expiresAt };
}

export async function verifyPickupOtp(input: { attemptId: string; driverUserId: mongoose.Types.ObjectId; code: string }) {
  const attempt = await PickupAttempt.findOne({ _id: asObjectId(input.attemptId, "Pickup attempt"), assignedDriverUserId: input.driverUserId }).select("+otpHash +otpExpiresAt +otpAttempts").exec();
  if (!attempt?.otpHash || !attempt.otpExpiresAt) throw new PickupServiceError("Request a pickup verification code first.", 409);
  if (attempt.otpExpiresAt <= new Date()) throw new PickupServiceError("The verification code has expired. Request a new one.", 409);
  if (attempt.otpAttempts >= 5) throw new PickupServiceError("Too many incorrect attempts. Request a new code.", 429);
  attempt.otpAttempts += 1;
  const supplied = crypto.createHash("sha256").update(input.code).digest();
  const expected = Buffer.from(attempt.otpHash, "hex");
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    await attempt.save();
    throw new PickupServiceError("The verification code is incorrect.", 400);
  }
  attempt.otpVerifiedAt = new Date();
  attempt.otpHash = "";
  attempt.otpExpiresAt = null;
  await attempt.save();
  return { verifiedAt: attempt.otpVerifiedAt };
}

export async function requestPickupOtpException(input: { attemptId: string; driverUserId: mongoose.Types.ObjectId; reason: string }) {
  const attempt = await PickupAttempt.findOne({
    _id: asObjectId(input.attemptId, "Pickup attempt"),
    assignedDriverUserId: input.driverUserId,
    status: { $in: ["ARRIVED", "COLLECTING"] }
  }).exec();
  if (!attempt) throw new PickupServiceError("Arrive at the assigned pickup before requesting an OTP exception.", 409);
  const now = new Date();
  attempt.otpExceptionReason = input.reason.trim();
  attempt.otpExceptionRequestedAt = now;
  attempt.otpExceptionApprovedBy = null;
  attempt.otpExceptionApprovedAt = null;
  attempt.otpExceptionRejectedBy = null;
  attempt.otpExceptionRejectedAt = null;
  attempt.otpExceptionReviewNote = "";
  await attempt.save();
  await PickupRequest.findByIdAndUpdate(attempt.pickupRequestId, { $set: { status: "ACTION_REQUIRED" }, $inc: { version: 1 } }).exec();
  await AuditLog.create({
    action: "PICKUP_ATTEMPT_STATUS_UPDATED",
    entityType: "PICKUP_ATTEMPT",
    entityId: attempt._id,
    performedBy: input.driverUserId,
    performedAt: now,
    metadata: { status: attempt.status, otpExceptionRequested: true, reason: attempt.otpExceptionReason }
  });
  const request = await PickupRequest.findById(attempt.pickupRequestId).select("businessAccountId requestNumber").lean().exec();
  if (request) await notifyPickupSafely(() => notifyOperationsStaff({
    type: "PICKUP_ACTION_REQUIRED",
    title: "Pickup OTP exception",
    message: `${request.requestNumber} needs an OTP exception decision.`,
    href: "/dashboard/pickups",
    idempotencyKey: `PICKUP_OTP_EXCEPTION:${String(attempt._id)}:${now.getTime()}`,
    businessAccountId: request.businessAccountId,
    metadata: { pickupRequestId: request._id, attemptId: attempt._id }
  }));
  return getPickupDetail(String(attempt.pickupRequestId));
}

export async function reviewPickupOtpException(input: {
  pickupId: string;
  attemptId: string;
  actorId: mongoose.Types.ObjectId;
  approved: boolean;
  reviewNote?: string;
}) {
  const attempt = await PickupAttempt.findOne({
    _id: asObjectId(input.attemptId, "Pickup attempt"),
    pickupRequestId: asObjectId(input.pickupId, "Pickup request"),
    otpExceptionRequestedAt: { $ne: null },
    status: { $in: ["ARRIVED", "COLLECTING"] }
  }).exec();
  if (!attempt) throw new PickupServiceError("A pending OTP exception was not found for this pickup.", 409);
  const now = new Date();
  attempt.otpExceptionReviewNote = input.reviewNote?.trim() ?? "";
  if (input.approved) {
    attempt.otpExceptionApprovedBy = input.actorId;
    attempt.otpExceptionApprovedAt = now;
    attempt.otpExceptionRejectedBy = null;
    attempt.otpExceptionRejectedAt = null;
  } else {
    attempt.otpExceptionApprovedBy = null;
    attempt.otpExceptionApprovedAt = null;
    attempt.otpExceptionRejectedBy = input.actorId;
    attempt.otpExceptionRejectedAt = now;
  }
  await attempt.save();
  await PickupRequest.findByIdAndUpdate(attempt.pickupRequestId, { $set: { status: "IN_PROGRESS" }, $inc: { version: 1 } }).exec();
  await AuditLog.create({
    action: "PICKUP_ATTEMPT_STATUS_UPDATED",
    entityType: "PICKUP_ATTEMPT",
    entityId: attempt._id,
    performedBy: input.actorId,
    performedAt: now,
    metadata: { status: attempt.status, otpExceptionApproved: input.approved, reviewNote: attempt.otpExceptionReviewNote }
  });
  return getPickupDetail(input.pickupId);
}

export async function scanPickupParcel(input: { attemptId: string; driverUserId: mongoose.Types.ObjectId; parcelNumber: string; scanRequestId: string }) {
  const existing = await PickupScan.findOne({ scanRequestId: input.scanRequestId }).lean().exec();
  if (existing) return getPickupDetail(String(existing.pickupRequestId));
  const attempt = await PickupAttempt.findOne({ _id: asObjectId(input.attemptId, "Pickup attempt"), assignedDriverUserId: input.driverUserId, status: "COLLECTING" }).exec();
  if (!attempt) throw new PickupServiceError("Start collection before scanning parcels.", 409);
  const parcelNumber = normalized(input.parcelNumber);
  const link = await PickupRequestShipment.findOne({ pickupRequestId: attempt.pickupRequestId, "parcels.parcelNumber": parcelNumber, active: true }).exec();
  if (!link) {
    await PickupScan.create({ pickupRequestId: attempt.pickupRequestId, pickupAttemptId: attempt._id, shipmentDraftId: null, parcelNumber, scanRequestId: input.scanRequestId, status: "REJECTED", message: "This parcel is not expected for the assigned pickup.", scannedBy: input.driverUserId });
    throw new PickupServiceError("This parcel is not expected for the assigned pickup.", 409);
  }
  const duplicate = await PickupScan.exists({ parcelNumber, status: "ACCEPTED" });
  if (duplicate) throw new PickupServiceError("This parcel has already been collected.", 409);
  const parcel = link.parcels.find((item) => normalized(item.parcelNumber) === parcelNumber);
  if (!parcel || parcel.status === "COLLECTED") throw new PickupServiceError("This parcel has already been collected.", 409);
  parcel.status = "COLLECTED";
  parcel.collectedAt = new Date();
  link.status = link.parcels.every((item) => item.status === "COLLECTED") ? "COLLECTED" : "PARTIAL";
  await Promise.all([
    link.save(),
    PickupScan.create({ pickupRequestId: attempt.pickupRequestId, pickupAttemptId: attempt._id, shipmentDraftId: link.shipmentDraftId, parcelNumber, scanRequestId: input.scanRequestId, status: "ACCEPTED", message: "Parcel collected.", scannedBy: input.driverUserId }),
    AuditLog.create({ action: "PICKUP_PARCEL_SCANNED", entityType: "PICKUP_ATTEMPT", entityId: attempt._id, performedBy: input.driverUserId, performedAt: new Date(), metadata: { parcelNumber, shipmentDraftId: link.shipmentDraftId } })
  ]);
  return getPickupDetail(String(attempt.pickupRequestId));
}

export async function recordPickupParcelException(input: { attemptId: string; driverUserId: mongoose.Types.ObjectId; parcelNumber: string; status: string; reason: string }) {
  const allowed = ["NOT_READY", "NOT_FOUND", "DAMAGED_AT_HANDOVER", "LABEL_INVALID", "CUSTOMER_REFUSED"];
  if (!allowed.includes(input.status) || !input.reason.trim()) throw new PickupServiceError("Select an exception and enter the reason.");
  const attempt = await PickupAttempt.findOne({ _id: asObjectId(input.attemptId, "Pickup attempt"), assignedDriverUserId: input.driverUserId, status: "COLLECTING" }).exec();
  if (!attempt) throw new PickupServiceError("Start collection before recording exceptions.", 409);
  const link = await PickupRequestShipment.findOne({ pickupRequestId: attempt.pickupRequestId, "parcels.parcelNumber": normalized(input.parcelNumber), active: true }).exec();
  const parcel = link?.parcels.find((item) => normalized(item.parcelNumber) === normalized(input.parcelNumber));
  if (!link || !parcel || parcel.status === "COLLECTED") throw new PickupServiceError("The parcel is not available for an exception.", 409);
  parcel.status = input.status as typeof parcel.status;
  parcel.exceptionReason = input.reason.trim();
  link.status = "PARTIAL";
  await link.save();
  return getPickupDetail(String(attempt.pickupRequestId));
}

export async function completePickupAttempt(input: { attemptId: string; driverUserId: mongoose.Types.ObjectId; location?: PickupLocation }) {
  const attempt = await PickupAttempt.findOne({ _id: asObjectId(input.attemptId, "Pickup attempt"), assignedDriverUserId: input.driverUserId, status: "COLLECTING" }).exec();
  if (!attempt) throw new PickupServiceError("Active pickup attempt was not found.", 409);
  if (!attempt.otpVerifiedAt && !attempt.otpExceptionApprovedBy) throw new PickupServiceError("Verify the pickup OTP before completing collection.", 409);
  const proofs = await PickupProof.find({ pickupAttemptId: attempt._id }).select("type").lean().exec();
  const proofTypes = new Set(proofs.map((proof) => proof.type));
  if (!proofTypes.has("SIGNATURE")) throw new PickupServiceError("Capture the customer signature before completing pickup.", 409);
  if (!proofTypes.has("PHOTO")) throw new PickupServiceError("Capture at least one pickup photograph before completing pickup.", 409);
  const links = await PickupRequestShipment.find({ pickupRequestId: attempt.pickupRequestId, active: true }).exec();
  if (links.some((link) => link.parcels.some((parcel) => parcel.status === "PENDING"))) throw new PickupServiceError("Scan every expected parcel or record an exception.", 409);
  const collectedLinks = links.filter((link) => link.parcels.every((parcel) => parcel.status === "COLLECTED"));
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const now = new Date();
      attempt.status = "COMPLETED";
      attempt.completedAt = now;
      if (input.location) attempt.completionLocation = { ...input.location, capturedAt: now };
      await attempt.save({ session });
      const request = await PickupRequest.findById(attempt.pickupRequestId).session(session).exec();
      if (!request) throw new PickupServiceError("Pickup request was not found.", 404);
      request.status = collectedLinks.length === links.length ? "COLLECTED" : "PARTIALLY_COLLECTED";
      request.version += 1;
      await request.save({ session });
      for (const link of links) {
        link.active = !link.parcels.every((parcel) => parcel.status === "COLLECTED");
        await link.save({ session });
      }
      if (collectedLinks.length) await ShipmentEvent.insertMany(collectedLinks.map((link) => ({
        shipmentDraftId: link.shipmentDraftId,
        dpdShipmentId: link.dpdShipmentId,
        status: "PARCEL_COLLECTED",
        note: `Collected under pickup ${request.requestNumber}.`,
        customerVisible: true,
        createdBy: input.driverUserId,
        eventAt: now
      })), { session });
      await AuditLog.create([{ action: "PICKUP_COMPLETED", entityType: "PICKUP_REQUEST", entityId: request._id, performedBy: input.driverUserId, performedAt: now, metadata: { attemptId: attempt._id, collectedShipments: collectedLinks.length, totalShipments: links.length } }], { session });
    });
  } finally { await session.endSession(); }
  const detail = await getPickupDetail(String(attempt.pickupRequestId));
  await notifyPickupSafely(() => notifyBusinessShipmentMembers(detail.businessAccountId, {
    type: "PICKUP_COMPLETED",
    title: "Pickup completed",
    message: `${detail.requestNumber} is ${detail.status === "COLLECTED" ? "fully collected" : "partially collected"}.`,
    href: "/client/pickups",
    idempotencyKey: `PICKUP_COMPLETED:${String(attempt._id)}`,
    businessAccountId: detail.businessAccountId,
    metadata: { pickupRequestId: detail._id, attemptId: attempt._id, status: detail.status }
  }));
  return detail;
}

export async function driverPickupAttempts(driverUserId: mongoose.Types.ObjectId) {
  const attempts = await PickupAttempt.find({ assignedDriverUserId: driverUserId, status: { $nin: ["CANCELLED"] } }).sort({ "scheduledWindow.startAt": 1 }).lean().exec();
  const requests = await PickupRequest.find({ _id: { $in: attempts.map((attempt) => attempt.pickupRequestId) } }).lean().exec();
  const requestById = new Map(requests.map((request) => [String(request._id), request]));
  return attempts.map((attempt) => ({ ...attempt, id: String(attempt._id), pickup: requestById.get(String(attempt.pickupRequestId)) ?? null }));
}

export async function getDriverPickupAttempt(input: { attemptId: string; driverUserId: mongoose.Types.ObjectId }) {
  const attempt = await PickupAttempt.findOne({
    _id: asObjectId(input.attemptId, "Pickup attempt"),
    assignedDriverUserId: input.driverUserId
  }).select("pickupRequestId").lean().exec();
  if (!attempt) throw new PickupServiceError("Assigned pickup attempt was not found.", 404);
  return getPickupDetail(String(attempt.pickupRequestId));
}
