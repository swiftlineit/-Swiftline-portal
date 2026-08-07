import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog } from "../models/auditLog.model.js";
import {
  DriverProfile,
  deliverySubroleValues,
  driverEngagementTypeValues,
  driverProfileStatusValues
} from "../models/driverProfile.model.js";
import { User } from "../models/user.model.js";
import { DeliveryPartner } from "../models/deliveryPartner.model.js";
import { createDriverInvitation } from "../services/driverInvitation.service.js";
import { normalizeUserEmail, normalizeUserPhone } from "../services/userIdentity.service.js";
import { validateAssignedBranches } from "../utils/assignedBranches.js";
import { emailValidationMessage, isValidBusinessContactEmail } from "../services/businessAccountRules.js";

const createSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  email: z.string().trim().email().max(160).refine(isValidBusinessContactEmail, emailValidationMessage),
  phone: z.string().trim().min(8).max(30),
  deliverySubrole: z.enum(deliverySubroleValues).default("DRIVER"),
  engagementType: z.enum(driverEngagementTypeValues),
  assignedBranches: z.array(z.string()).min(1, "Assign at least one branch."),
  licenceNumber: z.string().trim().max(80).optional().default(""),
  licenceExpiry: z.coerce.date().nullable().optional().default(null),
  approvedVehicleTypes: z.array(z.string().trim().min(1).max(60)).optional().default([]),
  notes: z.string().trim().max(500).optional().default(""),
  deliveryPartnerId: z.string().nullable().optional().default(null)
}).superRefine((value, context) => {
  if (value.engagementType === "VENDOR" && value.deliverySubrole !== "DELIVERY_PERSON") context.addIssue({ code: "custom", path: ["deliverySubrole"], message: "Partner personnel must use international delivery-person access." });
  if (value.engagementType === "VENDOR" && !value.deliveryPartnerId) context.addIssue({ code: "custom", path: ["deliveryPartnerId"], message: "Select the delivery partner for this person." });
});

const statusSchema = z.object({ status: z.enum(driverProfileStatusValues) });

function actorId(request: Request) {
  const value = (request as Request & { user?: { _id?: unknown } }).user?._id;
  return value && mongoose.Types.ObjectId.isValid(String(value)) ? new mongoose.Types.ObjectId(String(value)) : null;
}

function serialize(profile: any) {
  if (!profile) return null;
  const user = profile.userId as unknown as { _id: unknown; firstName?: string; lastName?: string; email?: string; phone?: string; userStatus?: string; assignedBranches?: unknown[] };
  return {
    id: String(profile._id),
    userId: String(user._id),
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    email: user.email ?? "",
    phone: user.phone ?? "",
    userStatus: user.userStatus ?? "invited",
    assignedBranches: user.assignedBranches ?? [],
    deliverySubrole: profile.deliverySubrole,
    engagementType: profile.engagementType,
    status: profile.status,
    licenceNumber: profile.licenceNumber ?? "",
    licenceExpiry: profile.licenceExpiry ?? null,
    approvedVehicleTypes: profile.approvedVehicleTypes ?? [],
    notes: profile.notes ?? "",
    deliveryPartnerId: profile.deliveryPartnerId ?? null,
    approvedAt: profile.approvedAt ?? null,
    createdAt: profile.createdAt
  };
}

function loadDriver(id: string) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return DriverProfile.findById(id)
    .populate("userId", "firstName lastName email phone userStatus assignedBranches profileImage")
    .populate({ path: "userId", populate: { path: "assignedBranches", select: "name code status" } })
    .exec();
}

export async function createDriver(request: Request, response: Response) {
  const actor = actorId(request);
  if (!actor) return response.status(401).json({ success: false, message: "Unauthorized" });
  const parsed = createSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Check the driver details." });

  const email = normalizeUserEmail(parsed.data.email);
  const phone = normalizeUserPhone(parsed.data.phone);
  if (!phone) return response.status(400).json({ success: false, message: "Enter the phone number in international format." });
  if (await User.exists({ $or: [{ email }, { phone }] })) {
    return response.status(409).json({ success: false, message: "A portal user already uses this email address or phone number." });
  }
  const branches = await validateAssignedBranches(parsed.data.assignedBranches);
  if (!branches?.length) return response.status(400).json({ success: false, message: "Assign at least one active branch." });
  if (parsed.data.deliveryPartnerId && !await DeliveryPartner.exists({ _id: parsed.data.deliveryPartnerId, status: "ACTIVE" })) return response.status(400).json({ success: false, message: "Select an active delivery partner." });

  const session = await mongoose.startSession();
  let profileId: mongoose.Types.ObjectId | null = null;
  try {
    await session.withTransaction(async () => {
      const [user] = await User.create([{
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        name: `${parsed.data.firstName} ${parsed.data.lastName}`.trim(),
        email,
        phone,
        role: "delivery",
        assignedBranches: branches,
        userStatus: "invited",
        isVerified: false,
        invitedBy: actor
      }], { session });
      if (!user) throw new Error("Driver user could not be created.");
      const [profile] = await DriverProfile.create([{
        userId: user._id,
        deliverySubrole: parsed.data.deliverySubrole,
        engagementType: parsed.data.engagementType,
        status: "INVITED",
        licenceNumber: parsed.data.licenceNumber,
        licenceExpiry: parsed.data.licenceExpiry,
        approvedVehicleTypes: parsed.data.approvedVehicleTypes,
        notes: parsed.data.notes,
        deliveryPartnerId: parsed.data.deliveryPartnerId,
        createdBy: actor
      }], { session });
      if (!profile) throw new Error("Driver profile could not be created.");
      profileId = profile._id as mongoose.Types.ObjectId;
      await AuditLog.create([{
        action: "DRIVER_PROFILE_CREATED",
        entityType: "DRIVER_PROFILE",
        entityId: profile._id,
        performedBy: actor,
        performedAt: new Date(),
        metadata: { engagementType: profile.engagementType, deliverySubrole: profile.deliverySubrole }
      }], { session });
    });
  } finally {
    await session.endSession();
  }
  const profile = profileId ? await loadDriver(String(profileId)) : null;
  return response.status(201).json({ success: true, message: "Driver created. Generate the invitation link to share it by email or WhatsApp.", driver: serialize(profile) });
}

export async function listDrivers(request: Request, response: Response) {
  const status = typeof request.query.status === "string" ? request.query.status : "";
  const filter: Record<string, unknown> = {};
  if (status && driverProfileStatusValues.includes(status as (typeof driverProfileStatusValues)[number])) filter.status = status;
  const profiles = await DriverProfile.find(filter)
    .sort({ createdAt: -1 })
    .populate("userId", "firstName lastName email phone userStatus assignedBranches profileImage")
    .populate({ path: "userId", populate: { path: "assignedBranches", select: "name code status" } })
    .exec();
  return response.status(200).json({ success: true, drivers: profiles.map((profile) => serialize(profile)) });
}

export async function getDriver(request: Request, response: Response) {
  const profile = await loadDriver(String(request.params.driverId ?? ""));
  if (!profile) return response.status(404).json({ success: false, message: "Driver not found." });
  return response.status(200).json({ success: true, driver: serialize(profile) });
}

export async function createDriverInvitationLink(request: Request, response: Response) {
  const actor = actorId(request);
  const profile = await loadDriver(String(request.params.driverId ?? ""));
  if (!actor) return response.status(401).json({ success: false, message: "Unauthorized" });
  if (!profile) return response.status(404).json({ success: false, message: "Driver not found." });
  if (!(["INVITED", "PENDING_APPROVAL"] as string[]).includes(profile.status)) {
    return response.status(409).json({ success: false, message: "Invitation links are only available before driver approval." });
  }
  const { activationUrl } = await createDriverInvitation({
    userId: profile.userId._id as mongoose.Types.ObjectId,
    driverProfileId: profile._id as mongoose.Types.ObjectId,
    createdBy: actor
  });
  await AuditLog.create({ action: "DRIVER_INVITATION_CREATED", entityType: "DRIVER_PROFILE", entityId: profile._id, performedBy: actor, performedAt: new Date(), metadata: {} });
  return response.status(200).json({ success: true, activationUrl, expiresInHours: 24 });
}

export async function updateDriverStatus(request: Request, response: Response) {
  const actor = actorId(request);
  if (!actor) return response.status(401).json({ success: false, message: "Unauthorized" });
  const parsed = statusSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, message: "Select a valid driver status." });
  const profile = await DriverProfile.findById(request.params.driverId).exec();
  if (!profile) return response.status(404).json({ success: false, message: "Driver not found." });
  if (parsed.data.status === "ACTIVE") {
    const user = await User.findById(profile.userId).select("userStatus passwordHash").exec();
    if (!user?.passwordHash || user.userStatus !== "active") {
      return response.status(409).json({ success: false, message: "The driver must activate their invitation before approval." });
    }
    profile.approvedBy = actor;
    profile.approvedAt = new Date();
  }
  profile.status = parsed.data.status;
  await profile.save();
  if (["SUSPENDED", "DISABLED"].includes(profile.status)) {
    await User.findByIdAndUpdate(profile.userId, { $set: { userStatus: profile.status === "SUSPENDED" ? "suspended" : "disabled" } }).exec();
  }
  await AuditLog.create({ action: "DRIVER_PROFILE_UPDATED", entityType: "DRIVER_PROFILE", entityId: profile._id, performedBy: actor, performedAt: new Date(), metadata: { status: profile.status } });
  const populated = await loadDriver(String(profile._id));
  return response.status(200).json({ success: true, message: "Driver status updated.", driver: serialize(populated) });
}

export async function getMyDriverProfile(request: Request, response: Response) {
  const userId = actorId(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });
  const profile = await DriverProfile.findOne({ userId })
    .populate("userId", "firstName lastName email phone userStatus assignedBranches profileImage")
    .populate({ path: "userId", populate: { path: "assignedBranches", select: "name code status" } })
    .exec();
  if (!profile) return response.status(404).json({ success: false, message: "Driver profile not found." });
  return response.status(200).json({ success: true, driver: serialize(profile) });
}
