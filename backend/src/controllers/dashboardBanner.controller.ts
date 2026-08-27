import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog } from "../models/auditLog.model.js";
import { DashboardBanner, type IDashboardBanner } from "../models/dashboardBanner.model.js";
import { assertValidStorageKey, dashboardBannerKey } from "../services/storage/keys.js";
import {
  deleteObject,
  putObject,
  streamObjectToResponse,
  StorageObjectNotFoundError
} from "../services/storage/storage.service.js";

function parseDate(value: string, endOfDay: boolean) {
  const date = new Date(`${value}T00:00:00`);
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date;
}

function optionalDate(endOfDay = false) {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? parseDate(value, endOfDay) : null))
    .refine((value) => value === null || !Number.isNaN(value.getTime()), "Enter a valid date.");
}

const bannerPayloadSchema = z.object({
  heading: z.string().trim().max(120, "Heading must be 120 characters or fewer.").default(""),
  description: z.string().trim().max(500, "Description must be 500 characters or fewer.").default(""),
  startsAt: optionalDate(),
  endsAt: optionalDate(true),
  active: z.union([z.boolean(), z.string()]).transform((value) => value === true || value === "true").default(true)
}).refine((value) => !value.startsAt || !value.endsAt || value.endsAt >= value.startsAt, {
  message: "The end date cannot be before the start date.",
  path: ["endsAt"]
});

function actor(request: Request) {
  const id = (request as Request & { user?: { _id?: unknown } }).user?._id;
  return id && mongoose.Types.ObjectId.isValid(String(id))
    ? new mongoose.Types.ObjectId(String(id))
    : null;
}

function role(request: Request) {
  return (request as Request & { user?: { role?: string } }).user?.role ?? "";
}

function isVisible(banner: IDashboardBanner, now = new Date()) {
  return banner.active
    && (!banner.startsAt || banner.startsAt <= now)
    && (!banner.endsAt || banner.endsAt >= now);
}

function serialize(banner: IDashboardBanner) {
  return {
    id: String(banner._id),
    heading: banner.heading,
    description: banner.description,
    order: banner.order,
    startsAt: banner.startsAt ?? null,
    endsAt: banner.endsAt ?? null,
    active: banner.active,
    imageName: banner.image.originalName,
    updatedAt: banner.updatedAt,
    visible: isVisible(banner)
  };
}

export async function getDashboardBanner(request: Request, response: Response) {
  const banners = await DashboardBanner.find().sort({ order: 1, createdAt: 1 }).exec();
  const visible = role(request) === "client" ? banners.filter((banner) => isVisible(banner)) : banners;
  return response.status(200).json({ success: true, banners: visible.map(serialize) });
}

export async function getDashboardBannerImage(request: Request, response: Response) {
  const bannerId = typeof request.params.id === "string" ? request.params.id : "";
  if (!mongoose.Types.ObjectId.isValid(bannerId)) {
    return response.status(404).json({ success: false, message: "Banner not found." });
  }
  const banner = await DashboardBanner.findById(bannerId).exec();
  if (!banner || (role(request) === "client" && !isVisible(banner))) {
    return response.status(404).json({ success: false, message: "No active dashboard banner." });
  }

  try {
    assertValidStorageKey(banner.image.storageKey);
    await streamObjectToResponse({
      response,
      key: banner.image.storageKey,
      contentType: banner.image.mimeType,
      filename: banner.image.originalName,
      disposition: "inline"
    });
  } catch (error) {
    if (error instanceof StorageObjectNotFoundError) {
      return response.status(404).json({ success: false, message: "Banner image not found." });
    }
    throw error;
  }
}

async function parseBannerBody(request: Request) {
  return bannerPayloadSchema.safeParse({
    heading: request.body.heading ?? "",
    description: request.body.description ?? "",
    startsAt: request.body.startsAt ?? "",
    endsAt: request.body.endsAt ?? "",
    active: request.body.active ?? "true"
  });
}

async function writeBannerAudit(
  action: "DASHBOARD_BANNER_CREATED" | "DASHBOARD_BANNER_UPDATED" | "DASHBOARD_BANNER_DELETED",
  banner: IDashboardBanner,
  userId: mongoose.Types.ObjectId,
  replacedImage = false
) {
  await AuditLog.create({
    action,
    entityType: "DASHBOARD_BANNER",
    entityId: banner._id,
    performedBy: userId,
    performedAt: new Date(),
    metadata: {
      replacedImage,
      hasHeading: Boolean(banner.heading),
      hasDescription: Boolean(banner.description),
      startsAt: banner.startsAt,
      endsAt: banner.endsAt,
      active: banner.active
    }
  });
}

async function storeBannerImage(file: Express.Multer.File) {
  const stored = await putObject({
    key: dashboardBannerKey(file.originalname),
    body: file.buffer,
    contentType: file.mimetype,
    originalName: file.originalname
  });
  return {
    originalName: file.originalname,
    storageKey: stored.key,
    mimeType: file.mimetype,
    size: file.size,
    uploadedAt: new Date()
  };
}

export async function createDashboardBanner(request: Request, response: Response) {
  const userId = actor(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = await parseBannerBody(request);
  if (!parsed.success) {
    return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid banner details." });
  }
  const file = request.file;
  if (!file) return response.status(400).json({ success: false, message: "Upload a banner image before saving." });

  const maxOrder = await DashboardBanner.findOne().sort({ order: -1 }).select("order").lean().exec();
  const banner = await DashboardBanner.create({
    image: await storeBannerImage(file),
    order: (maxOrder?.order ?? -1) + 1,
    createdBy: userId,
    updatedBy: userId,
    heading: parsed.data.heading,
    description: parsed.data.description,
    startsAt: parsed.data.startsAt,
    endsAt: parsed.data.endsAt,
    active: parsed.data.active
  });
  await writeBannerAudit("DASHBOARD_BANNER_CREATED", banner, userId, true);
  return response.status(201).json({ success: true, message: "Dashboard banner slide created.", banner: serialize(banner) });
}

export async function updateDashboardBanner(request: Request, response: Response) {
  const userId = actor(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });

  const parsed = await parseBannerBody(request);
  if (!parsed.success) {
    return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid banner details." });
  }
  const bannerId = typeof request.params.id === "string" ? request.params.id : "";
  if (!mongoose.Types.ObjectId.isValid(bannerId)) return response.status(404).json({ success: false, message: "Banner not found." });
  const banner = await DashboardBanner.findById(bannerId).exec();
  if (!banner) return response.status(404).json({ success: false, message: "Banner not found." });

  const file = request.file;
  const previousKey = banner.image.storageKey;
  if (file) banner.image = await storeBannerImage(file);
  banner.heading = parsed.data.heading;
  banner.description = parsed.data.description;
  banner.startsAt = parsed.data.startsAt;
  banner.endsAt = parsed.data.endsAt;
  banner.active = parsed.data.active;
  banner.updatedBy = userId;
  await banner.save();

  if (file && previousKey && previousKey !== banner.image.storageKey) {
    await deleteObject(previousKey).catch(() => undefined);
  }
  await writeBannerAudit("DASHBOARD_BANNER_UPDATED", banner, userId, Boolean(file));
  return response.status(200).json({ success: true, message: "Dashboard banner slide saved.", banner: serialize(banner) });
}

export async function deleteDashboardBanner(request: Request, response: Response) {
  const userId = actor(request);
  if (!userId) return response.status(401).json({ success: false, message: "Unauthorized" });
  const bannerId = typeof request.params.id === "string" ? request.params.id : "";
  if (!mongoose.Types.ObjectId.isValid(bannerId)) return response.status(404).json({ success: false, message: "Banner not found." });
  const banner = await DashboardBanner.findByIdAndDelete(bannerId).exec();
  if (!banner) return response.status(404).json({ success: false, message: "Banner not found." });
  await deleteObject(banner.image.storageKey).catch(() => undefined);
  await writeBannerAudit("DASHBOARD_BANNER_DELETED", banner, userId);

  return response.status(200).json({ success: true, message: "Dashboard banner slide deleted." });
}
