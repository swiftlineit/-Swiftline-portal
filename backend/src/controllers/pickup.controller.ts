import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog } from "../models/auditLog.model.js";
import { BusinessAccountMember } from "../models/businessAccountMember.model.js";
import { DriverProfile } from "../models/driverProfile.model.js";
import { PickupAttempt } from "../models/pickupAttempt.model.js";
import { PickupProof, pickupProofTypeValues } from "../models/pickupEvidence.model.js";
import { PickupRequest } from "../models/pickupRequest.model.js";
import { User } from "../models/user.model.js";
import { isSupportedImage } from "../services/storage/fileSignature.js";
import {
  StorageObjectNotFoundError,
  deleteObject,
  pickupProofKey,
  putObject,
  streamObjectToResponse
} from "../services/storage/storage.service.js";
import {
  PickupServiceError, assignPickupDriver, cancelPickup, completePickupAttempt, confirmPickup,
  createClientPickup, driverPickupAttempts, getDriverPickupAttempt, getPickupDetail, listEligiblePickupShipments,
  listPickupRequests, markPickupMissed, recordPickupParcelException, reschedulePickup, scanPickupParcel, sendPickupOtp,
  requestPickupOtpException, reviewPickupOtpException, transitionDriverAttempt, verifyPickupOtp
} from "../services/pickup.service.js";
import { emailValidationMessage, isValidBusinessContactEmail } from "../services/businessAccountRules.js";
import { operationsBranchIds } from "../middleware/operationsBranchAccess.middleware.js";
import { pickupRequestStatusValues } from "../models/pickupRequest.model.js";
import { pickupExportColumns } from "../services/export/exportColumns.js";
import { describeFilters, exportFormat, sendTableExport, type TableExportFormat } from "../services/export/tableExportHttp.js";

const windowSchema = z.object({
  startAt: z.coerce.date(), endAt: z.coerce.date(), timezone: z.string().trim().min(1).max(80).default("Asia/Kolkata")
});
const createSchema = z.object({
  shipmentDraftIds: z.array(z.string()).min(1).max(100), requestedWindow: windowSchema,
  contact: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().toLowerCase().refine(isValidBusinessContactEmail, emailValidationMessage),
    phone: z.string().trim().min(6).max(30)
  }),
  pickupAddress: z.object({
    addressLine1: z.string().trim().min(3).max(180),
    addressLine2: z.string().trim().max(180).optional().default(""),
    townOrCity: z.string().trim().min(2).max(100),
    county: z.string().trim().max(100).optional().default(""),
    postcode: z.string().trim().min(3).max(20),
    countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
    countryName: z.string().trim().max(100).optional().default(""),
    googlePlaceId: z.string().trim().max(300).optional().default("")
  }),
  instructions: z.string().trim().max(500).optional().default("")
});
const cancellationSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const confirmSchema = z.object({ scheduledWindow: windowSchema });
const assignSchema = z.object({
  attemptId: z.string(), driverProfileId: z.string(),
  vehicle: z.object({ source: z.enum(["COMPANY_OWNED", "DRIVER_OWNED", "HIRED", "VENDOR_OWNED"]).optional(), type: z.string().trim().max(60).optional(), registrationNumber: z.string().trim().max(30).optional() }).default({})
});
const locationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).nullable().optional()
});

function actor(request: Request) {
  const user = (request as Request & { user?: { _id?: unknown; role?: string; assignedBranches?: mongoose.Types.ObjectId[] } }).user;
  return user?._id && mongoose.Types.ObjectId.isValid(String(user._id))
    ? { id: new mongoose.Types.ObjectId(String(user._id)), role: user.role ?? "", assignedBranches: user.assignedBranches ?? [] }
    : null;
}

/**
 * The id behind a reference, whether or not it was populated. `getPickupDetail`
 * populates `branchId` into a branch document, so comparing it directly would
 * stringify to "[object Object]" and silently fail every branch check.
 */
function refId(value: unknown) {
  return String((value as { _id?: unknown } | null)?._id ?? value);
}

async function clientCanAccessPickup(
  userId: mongoose.Types.ObjectId,
  pickup: { businessAccountId: unknown; branchId: unknown }
) {
  const membership = await BusinessAccountMember.findOne({ user: userId, businessAccount: refId(pickup.businessAccountId), status: "active" }).select("assignedBranches").lean().exec();
  if (!membership) return false;
  const assignedBranches = membership.assignedBranches ?? [];
  return !assignedBranches.length || assignedBranches.some((id) => String(id) === refId(pickup.branchId));
}

function handle(error: unknown, response: Response, next: NextFunction) {
  if (error instanceof PickupServiceError) return response.status(error.statusCode).json({ success: false, message: error.message });
  return next(error);
}

export async function listClientEligiblePickups(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false, message: "Unauthorized" });
    return response.status(200).json({ success: true, shipments: await listEligiblePickupShipments(user.id) });
  } catch (error) { return handle(error, response, next); }
}

export async function createClientPickupRequest(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false, message: "Unauthorized" });
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Check the pickup details." });
    const pickup = await createClientPickup({ userId: user.id, ...parsed.data });
    return response.status(201).json({ success: true, message: "Pickup request submitted.", pickup });
  } catch (error) { return handle(error, response, next); }
}

/**
 * Status and requested-window filters, shared by both audiences.
 *
 * The window is matched on `requestedWindow.startAt` rather than createdAt:
 * someone filtering pickups by date means the day of collection, not the day
 * the request happened to be typed.
 */
function pickupQueryFilters(request: Request) {
  const filter: Record<string, unknown> = {};
  const status = typeof request.query.status === "string" ? request.query.status : "";
  if (pickupRequestStatusValues.includes(status as never)) filter.status = status;

  const from = typeof request.query.dateFrom === "string" ? request.query.dateFrom : "";
  const to = typeof request.query.dateTo === "string" ? request.query.dateTo : "";
  if (from || to) {
    filter["requestedWindow.startAt"] = {
      ...(from ? { $gte: new Date(from) } : {}),
      // Inclusive of the whole end day, which is what picking a date means.
      ...(to ? { $lte: new Date(`${to}T23:59:59.999Z`) } : {})
    };
  }
  return filter;
}

function sendPickupExport(request: Request, response: Response, format: TableExportFormat, pickups: unknown[]) {
  return sendTableExport(response, format, {
    title: "Pickups",
    columns: pickupExportColumns,
    rows: pickups as never[],
    appliedFilters: describeFilters({
      Status: request.query.status,
      From: request.query.dateFrom,
      To: request.query.dateTo
    })
  });
}

export async function listClientPickupRequests(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false, message: "Unauthorized" });
    const memberships = await BusinessAccountMember.find({ user: user.id, status: "active" }).select("businessAccount").lean().exec();
    const pickups = await listPickupRequests({
      businessAccountId: { $in: memberships.map((item) => item.businessAccount) },
      ...pickupQueryFilters(request)
    });
    const format = exportFormat(request);
    if (format) return sendPickupExport(request, response, format, pickups);
    return response.status(200).json({ success: true, pickups });
  } catch (error) { return handle(error, response, next); }
}

const rescheduleSchema = z.object({
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  timezone: z.string().trim().min(1).max(80).default("Asia/Kolkata")
});

export async function rescheduleClientPickupRequest(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false, message: "Unauthorized" });
    const pickupId = String(request.params.pickupId ?? "");
    const pickup = await PickupRequest.findById(pickupId).select("businessAccountId branchId").lean().exec();
    if (!pickup || !await clientCanAccessPickup(user.id, pickup)) {
      return response.status(404).json({ success: false, message: "Pickup request was not found." });
    }
    const parsed = rescheduleSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ success: false, message: "Choose a valid pickup window." });
    return response.status(200).json({
      success: true,
      message: "Pickup rescheduled.",
      pickup: await reschedulePickup({ pickupId, actorId: user.id, source: "CLIENT", ...parsed.data })
    });
  } catch (error) { return handle(error, response, next); }
}

export async function reschedulePickupRequest(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false, message: "Unauthorized" });
    const parsed = rescheduleSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ success: false, message: "Choose a valid pickup window." });
    return response.status(200).json({
      success: true,
      message: "Pickup rescheduled.",
      pickup: await reschedulePickup({
        pickupId: String(request.params.pickupId ?? ""), actorId: user.id, source: "ADMIN", ...parsed.data
      })
    });
  } catch (error) { return handle(error, response, next); }
}

export async function markPickupRequestMissed(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false, message: "Unauthorized" });
    const parsed = z.object({ reason: z.string().trim().min(3).max(500) }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ success: false, message: "Enter why the pickup was missed." });
    return response.status(200).json({
      success: true,
      message: "Pickup marked as missed.",
      pickup: await markPickupMissed({
        pickupId: String(request.params.pickupId ?? ""), actorId: user.id, reason: parsed.data.reason
      })
    });
  } catch (error) { return handle(error, response, next); }
}

export async function getClientPickupRequest(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false, message: "Unauthorized" });
    const pickup = await getPickupDetail(String(request.params.pickupId ?? ""));
    if (!await clientCanAccessPickup(user.id, pickup)) return response.status(404).json({ success: false, message: "Pickup request was not found." });
    return response.status(200).json({ success: true, pickup });
  } catch (error) { return handle(error, response, next); }
}

export async function cancelClientPickupRequest(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false, message: "Unauthorized" });
    const pickupId = String(request.params.pickupId ?? "");
    const pickup = await PickupRequest.findById(pickupId).select("businessAccountId branchId").lean().exec();
    if (!pickup || !await clientCanAccessPickup(user.id, pickup)) return response.status(404).json({ success: false, message: "Pickup request was not found." });
    const parsed = cancellationSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ success: false, message: "Enter a cancellation reason." });
    return response.status(200).json({ success: true, message: "Pickup request cancelled.", pickup: await cancelPickup({ pickupId, actorId: user.id, source: "CLIENT", reason: parsed.data.reason }) });
  } catch (error) { return handle(error, response, next); }
}

export async function listInternalPickupRequests(request: Request, response: Response, next: NextFunction) {
  try {
    const allowed = operationsBranchIds(request);
    const filter: Record<string, unknown> = { ...pickupQueryFilters(request) };
    if (allowed !== null) filter.branchId = { $in: allowed };
    const pickups = await listPickupRequests(filter);
    const format = exportFormat(request);
    if (format) return sendPickupExport(request, response, format, pickups);
    return response.status(200).json({ success: true, pickups });
  } catch (error) { return handle(error, response, next); }
}

export async function listAvailablePickupDrivers(request: Request, response: Response, next: NextFunction) {
  try {
    const allowed = operationsBranchIds(request);
    const users = await User.find({
      role: "delivery",
      userStatus: "active",
      ...(allowed === null ? {} : { assignedBranches: { $in: allowed } })
    }).select("firstName lastName name phone assignedBranches").populate("assignedBranches", "name code").lean().exec();
    const userById = new Map(users.map((user) => [String(user._id), user]));
    const profiles = await DriverProfile.find({ userId: { $in: users.map((user) => user._id) }, deliverySubrole: "DRIVER", status: "ACTIVE" }).lean().exec();
    const drivers = profiles.flatMap((profile) => {
      const user = userById.get(String(profile.userId));
      return user ? [{
        id: String(profile._id),
        userId: String(user._id),
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        phone: user.phone ?? "",
        assignedBranches: user.assignedBranches ?? [],
        deliverySubrole: profile.deliverySubrole,
        engagementType: profile.engagementType,
        status: profile.status
      }] : [];
    });
    return response.status(200).json({ success: true, drivers });
  } catch (error) { return handle(error, response, next); }
}

async function internalPickupAccess(request: Request, pickupId: string) {
  const pickup = await PickupRequest.findById(pickupId).select("branchId").lean().exec();
  if (!pickup) return null;
  const allowed = operationsBranchIds(request);
  return allowed === null || allowed.includes(String(pickup.branchId)) ? pickup : null;
}

export async function getInternalPickupRequest(request: Request, response: Response, next: NextFunction) {
  try {
    const pickupId = String(request.params.pickupId ?? "");
    if (!mongoose.Types.ObjectId.isValid(pickupId) || !await internalPickupAccess(request, pickupId)) return response.status(404).json({ success: false, message: "Pickup request was not found." });
    return response.status(200).json({ success: true, pickup: await getPickupDetail(pickupId) });
  } catch (error) { return handle(error, response, next); }
}

export async function confirmPickupRequest(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false, message: "Unauthorized" });
    const pickupId = String(request.params.pickupId ?? "");
    if (!mongoose.Types.ObjectId.isValid(pickupId) || !await internalPickupAccess(request, pickupId)) return response.status(404).json({ success: false, message: "Pickup request was not found." });
    const parsed = confirmSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ success: false, message: "Select a valid confirmed pickup window." });
    const result = await confirmPickup({ pickupId, actorId: user.id, ...parsed.data });
    return response.status(200).json({ success: true, message: "Pickup confirmed and attempt scheduled.", pickup: result.detail, attemptId: result.attemptId });
  } catch (error) { return handle(error, response, next); }
}

export async function assignPickupRequestDriver(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false, message: "Unauthorized" });
    const pickupId = String(request.params.pickupId ?? "");
    if (!mongoose.Types.ObjectId.isValid(pickupId) || !await internalPickupAccess(request, pickupId)) return response.status(404).json({ success: false, message: "Pickup request was not found." });
    const parsed = assignSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Check the assignment." });
    const pickup = await assignPickupDriver({ pickupId, actorId: user.id, ...parsed.data, vehicle: parsed.data.vehicle as Record<string, string> });
    return response.status(200).json({ success: true, message: "Driver assigned.", pickup });
  } catch (error) { return handle(error, response, next); }
}

export async function cancelInternalPickupRequest(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false, message: "Unauthorized" });
    const pickupId = String(request.params.pickupId ?? "");
    if (!mongoose.Types.ObjectId.isValid(pickupId) || !await internalPickupAccess(request, pickupId)) return response.status(404).json({ success: false, message: "Pickup request was not found." });
    const parsed = cancellationSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ success: false, message: "Enter a cancellation reason." });
    return response.status(200).json({ success: true, message: "Pickup request cancelled.", pickup: await cancelPickup({ pickupId, actorId: user.id, source: "ADMIN", reason: parsed.data.reason }) });
  } catch (error) { return handle(error, response, next); }
}

async function sendProofFile(proofId: string, pickupId: string, response: Response) {
  if (!mongoose.Types.ObjectId.isValid(proofId)) throw new PickupServiceError("Pickup proof was not found.", 404);
  const proof = await PickupProof.findOne({ _id: proofId, pickupRequestId: pickupId }).lean().exec();
  if (!proof) throw new PickupServiceError("Pickup proof was not found.", 404);
  try {
    return await streamObjectToResponse({
      response,
      key: proof.storageKey,
      contentType: proof.mimeType,
      filename: proof.originalName,
      disposition: "inline"
    });
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      throw new PickupServiceError("Pickup proof file was not found.", 404);
    }
    throw error;
  }
}

export async function viewClientPickupProof(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false, message: "Unauthorized" });
    if (!mongoose.Types.ObjectId.isValid(String(request.params.pickupId ?? ""))) return response.status(404).json({ success: false, message: "Pickup proof was not found." });
    const pickup = await PickupRequest.findById(request.params.pickupId).select("businessAccountId branchId status").lean().exec();
    if (!pickup || !["COLLECTED", "PARTIALLY_COLLECTED"].includes(pickup.status) || !await clientCanAccessPickup(user.id, pickup)) return response.status(404).json({ success: false, message: "Pickup proof was not found." });
    return await sendProofFile(String(request.params.proofId ?? ""), String(pickup._id), response);
  } catch (error) { return handle(error, response, next); }
}

export async function viewInternalPickupProof(request: Request, response: Response, next: NextFunction) {
  try {
    const pickupId = String(request.params.pickupId ?? "");
    if (!mongoose.Types.ObjectId.isValid(pickupId) || !await internalPickupAccess(request, pickupId)) return response.status(404).json({ success: false, message: "Pickup proof was not found." });
    return await sendProofFile(String(request.params.proofId ?? ""), pickupId, response);
  } catch (error) { return handle(error, response, next); }
}

export async function viewMyPickupProof(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false, message: "Unauthorized" });
    const attempt = await PickupAttempt.findOne({ _id: request.params.attemptId, assignedDriverUserId: user.id }).select("pickupRequestId").lean().exec();
    if (!attempt) return response.status(404).json({ success: false, message: "Pickup proof was not found." });
    return await sendProofFile(String(request.params.proofId ?? ""), String(attempt.pickupRequestId), response);
  } catch (error) { return handle(error, response, next); }
}

export async function listMyPickupAttempts(request: Request, response: Response, next: NextFunction) {
  try { const user = actor(request); if (!user) return response.status(401).json({ success: false }); return response.status(200).json({ success: true, attempts: await driverPickupAttempts(user.id) }); }
  catch (error) { return handle(error, response, next); }
}

export async function getMyPickupAttempt(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false });
    return response.status(200).json({ success: true, pickup: await getDriverPickupAttempt({ attemptId: String(request.params.attemptId ?? ""), driverUserId: user.id }) });
  } catch (error) { return handle(error, response, next); }
}

export async function updateMyPickupAttemptStatus(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false });
    const parsed = z.object({ status: z.enum(["ACCEPTED", "EN_ROUTE", "ARRIVED", "COLLECTING"]), location: locationSchema.optional() }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ success: false, message: "Select a valid pickup status." });
    return response.status(200).json({ success: true, pickup: await transitionDriverAttempt({ attemptId: String(request.params.attemptId ?? ""), driverUserId: user.id, status: parsed.data.status, location: parsed.data.location }) });
  } catch (error) { return handle(error, response, next); }
}

export async function requestMyPickupOtp(request: Request, response: Response, next: NextFunction) {
  try { const user = actor(request); if (!user) return response.status(401).json({ success: false }); return response.status(200).json({ success: true, ...(await sendPickupOtp({ attemptId: String(request.params.attemptId ?? ""), driverUserId: user.id })) }); }
  catch (error) { return handle(error, response, next); }
}

export async function verifyMyPickupOtp(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false });
    const parsed = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ success: false, message: "Enter the 6-digit pickup code." });
    return response.status(200).json({ success: true, ...(await verifyPickupOtp({ attemptId: String(request.params.attemptId ?? ""), driverUserId: user.id, code: parsed.data.code })) });
  } catch (error) { return handle(error, response, next); }
}

export async function requestMyPickupOtpException(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false });
    const parsed = z.object({ reason: z.string().trim().min(5).max(500) }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ success: false, message: "Explain why the pickup OTP cannot be completed." });
    return response.status(200).json({
      success: true,
      message: "OTP exception sent for supervisor review.",
      pickup: await requestPickupOtpException({ attemptId: String(request.params.attemptId ?? ""), driverUserId: user.id, reason: parsed.data.reason })
    });
  } catch (error) { return handle(error, response, next); }
}

export async function reviewPickupRequestOtpException(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false });
    const pickupId = String(request.params.pickupId ?? "");
    if (!mongoose.Types.ObjectId.isValid(pickupId) || !await internalPickupAccess(request, pickupId)) return response.status(404).json({ success: false, message: "Pickup request was not found." });
    const parsed = z.object({ attemptId: z.string(), approved: z.boolean(), reviewNote: z.string().trim().max(500).optional() }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ success: false, message: "Choose an OTP exception decision." });
    return response.status(200).json({
      success: true,
      message: parsed.data.approved ? "OTP exception approved." : "OTP exception rejected.",
      pickup: await reviewPickupOtpException({ pickupId, actorId: user.id, ...parsed.data })
    });
  } catch (error) { return handle(error, response, next); }
}

export async function scanMyPickupParcel(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false });
    const parsed = z.object({ parcelNumber: z.string().trim().min(1).max(80), scanRequestId: z.string().trim().min(8).max(100) }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ success: false, message: "Scan a valid parcel label." });
    return response.status(200).json({ success: true, pickup: await scanPickupParcel({ attemptId: String(request.params.attemptId ?? ""), driverUserId: user.id, ...parsed.data }) });
  } catch (error) { return handle(error, response, next); }
}

export async function addMyPickupException(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false });
    const parsed = z.object({ parcelNumber: z.string().trim().min(1).max(80), status: z.string(), reason: z.string().trim().min(3).max(500) }).safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ success: false, message: "Enter the parcel exception and reason." });
    return response.status(200).json({ success: true, pickup: await recordPickupParcelException({ attemptId: String(request.params.attemptId ?? ""), driverUserId: user.id, ...parsed.data }) });
  } catch (error) { return handle(error, response, next); }
}


export async function uploadMyPickupProof(request: Request, response: Response, next: NextFunction) {
  const file = request.file;
  // Set once the object is written, so a later failure can unwind it. Nothing
  // before that point needs cleanup: the upload is only an in-memory buffer.
  let storedKey = "";
  try {
    const user = actor(request); if (!user) throw new PickupServiceError("Unauthorized", 401);
    const type = String(request.params.proofType ?? "").toUpperCase();
    if (!pickupProofTypeValues.includes(type as (typeof pickupProofTypeValues)[number])) throw new PickupServiceError("Select photo or signature proof.");
    if (!file) throw new PickupServiceError("Choose a proof image.");
    const attempt = await PickupAttempt.findOne({ _id: request.params.attemptId, assignedDriverUserId: user.id, status: "COLLECTING" }).exec();
    if (!attempt) throw new PickupServiceError("Start the assigned collection before adding proof.", 409);
    if (!isSupportedImage(file.buffer)) throw new PickupServiceError("The proof is not a valid JPG, PNG, or WebP image.");

    storedKey = pickupProofKey(String(attempt.pickupRequestId), file.originalname);
    await putObject({ key: storedKey, body: file.buffer, contentType: file.mimetype, originalName: file.originalname });

    const proof = new PickupProof({ pickupRequestId: attempt.pickupRequestId, pickupAttemptId: attempt._id, type: type as (typeof pickupProofTypeValues)[number], originalName: file.originalname, storageKey: storedKey, mimeType: file.mimetype, size: file.size, capturedBy: user.id });
    await proof.save();
    await AuditLog.create({ action: "PICKUP_PROOF_CAPTURED", entityType: "PICKUP_ATTEMPT", entityId: attempt._id, performedBy: user.id, performedAt: new Date(), metadata: { type, proofId: proof._id } });
    return response.status(201).json({ success: true, message: type === "PHOTO" ? "Pickup photograph saved." : "Customer signature saved." });
  } catch (error) {
    if (storedKey) await deleteObject(storedKey).catch(() => undefined);
    return handle(error, response, next);
  }
}

export async function completeMyPickupAttempt(request: Request, response: Response, next: NextFunction) {
  try {
    const user = actor(request); if (!user) return response.status(401).json({ success: false });
    const parsed = z.object({ location: locationSchema.optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return response.status(400).json({ success: false, message: "The captured GPS location is invalid." });
    return response.status(200).json({ success: true, message: "Pickup completed.", pickup: await completePickupAttempt({ attemptId: String(request.params.attemptId ?? ""), driverUserId: user.id, location: parsed.data.location }) });
  }
  catch (error) { return handle(error, response, next); }
}

export async function requirePickupManager(request: Request, response: Response, next: NextFunction) {
  const user = actor(request);
  if (!user) return response.status(401).json({ success: false, message: "Unauthorized" });
  if (["admin", "operations"].includes(user.role)) return next();
  if (user.role === "delivery" && await DriverProfile.exists({ userId: user.id, deliverySubrole: "SUPERVISOR", status: "ACTIVE" })) return next();
  return response.status(403).json({ success: false, message: "Delivery supervisor access is required." });
}
