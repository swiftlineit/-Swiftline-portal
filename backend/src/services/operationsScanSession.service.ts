import crypto from "crypto";
import mongoose from "mongoose";
import bwipjs from "bwip-js";
import { env } from "../config/env.js";
import { OperationsManifest } from "../models/operationsManifest.model.js";
import { OperationsManifestBag } from "../models/operationsManifestBag.model.js";
import {
  OperationsManifestScanSession,
  type IOperationsManifestScanSession
} from "../models/operationsManifestScanSession.model.js";

export class OperationsScanSessionError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

type SessionActor = {
  userId: mongoose.Types.ObjectId;
  role: string;
  assignedBranchIds: string[];
};

function objectId(value: string, label: string) {
  if (!mongoose.Types.ObjectId.isValid(value)) throw new OperationsScanSessionError(`${label} was not found.`, 404);
  return new mongoose.Types.ObjectId(value);
}

function tokenHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function actorCanAccessBranch(actor: SessionActor, branchId: mongoose.Types.ObjectId) {
  return actor.role === "admin" || actor.assignedBranchIds.includes(String(branchId));
}

async function endExpiredSession(session: IOperationsManifestScanSession) {
  const now = new Date();
  const pairingExpired = session.status === "PENDING" && session.pairingExpiresAt <= now;
  if (session.status !== "ENDED" && (session.sessionExpiresAt <= now || pairingExpired)) {
    session.status = "ENDED";
    session.endedAt = now;
    session.endedReason = pairingExpired ? "Phone pairing code expired." : "Scanner session expired.";
    session.activeBagId = null;
    await session.save();
  }
  return session;
}

async function sessionDetail(session: IOperationsManifestScanSession) {
  const [manifest, bag] = await Promise.all([
    OperationsManifest.findById(session.manifestId).select("manifestNumber header status totalPhysicalParcels totalWeightKg").lean().exec(),
    session.activeBagId
      ? OperationsManifestBag.findById(session.activeBagId).select("bagNumber status totalPhysicalParcels totalWeightKg").lean().exec()
      : null
  ]);
  return {
    id: String(session._id),
    manifestId: String(session.manifestId),
    branchId: String(session.branchId),
    status: session.status,
    pairingExpiresAt: session.pairingExpiresAt,
    sessionExpiresAt: session.sessionExpiresAt,
    connectedAt: session.connectedAt ?? null,
    lastSeenAt: session.lastSeenAt ?? null,
    lastScanAt: session.lastScanAt ?? null,
    endedReason: session.endedReason,
    manifest: manifest ? {
      manifestNumber: manifest.manifestNumber,
      status: manifest.status,
      destinationCountryCode: manifest.header.destinationCountryCode,
      destinationCountryName: manifest.header.destinationCountryName,
      totalPhysicalParcels: manifest.totalPhysicalParcels,
      totalWeightKg: manifest.totalWeightKg
    } : null,
    activeBag: bag ? {
      id: String(bag._id),
      bagNumber: bag.bagNumber,
      status: bag.status,
      totalPhysicalParcels: bag.totalPhysicalParcels,
      totalWeightKg: bag.totalWeightKg
    } : null
  };
}

export async function createOperationsScanSession(input: {
  manifestId: string;
  activeBagId: string;
  actor: SessionActor;
}) {
  const manifestId = objectId(input.manifestId, "Operations manifest");
  const activeBagId = objectId(input.activeBagId, "Bag");
  const [manifest, bag] = await Promise.all([
    OperationsManifest.findById(manifestId).exec(),
    OperationsManifestBag.findOne({ _id: activeBagId, manifestId }).exec()
  ]);
  if (!manifest || !["DRAFT", "PACKING", "READY_TO_SEAL"].includes(manifest.status)) {
    throw new OperationsScanSessionError("This manifest cannot start a phone scanner.", 409);
  }
  if (!actorCanAccessBranch(input.actor, manifest.branchId)) {
    throw new OperationsScanSessionError("You do not have access to this manifest's branch.", 403);
  }
  if (!bag || !["OPEN", "REOPENED"].includes(bag.status)) {
    throw new OperationsScanSessionError("Select an open bag before connecting a phone.", 409);
  }

  const now = new Date();
  await OperationsManifestScanSession.updateMany(
    {
      manifestId,
      status: "PENDING"
    },
    { $set: { status: "ENDED", endedAt: now, endedReason: "A new pairing code was created.", activeBagId: null } }
  ).exec();
  const active = await OperationsManifestScanSession.findOne({ manifestId, status: "ACTIVE" }).exec();
  if (active) {
    await endExpiredSession(active);
    if (active.status === "ACTIVE") throw new OperationsScanSessionError("A phone scanner is already connected to this manifest.", 409);
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const pairingExpiresAt = new Date(now.getTime() + 2 * 60 * 1000);
  const sessionExpiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const session = await OperationsManifestScanSession.create({
    manifestId,
    branchId: manifest.branchId,
    activeBagId,
    pairingTokenHash: tokenHash(rawToken),
    pairingExpiresAt,
    sessionExpiresAt,
    purgeAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    desktopUserId: input.actor.userId,
    status: "PENDING"
  });

  const connectUrl = new URL("/manifest-scanner/connect", env.CLIENT_URL);
  connectUrl.hash = `token=${encodeURIComponent(rawToken)}`;
  const qrBuffer = await bwipjs.toBuffer({
    bcid: "qrcode",
    text: connectUrl.toString(),
    scale: 4,
    paddingwidth: 4,
    paddingheight: 4,
    backgroundcolor: "FFFFFF",
    barcolor: "0D1282"
  });

  return {
    session: await sessionDetail(session),
    qrDataUri: `data:image/png;base64,${qrBuffer.toString("base64")}`
  };
}

export async function pairOperationsScanSession(input: { token: string; actor: SessionActor }) {
  const session = await OperationsManifestScanSession.findOne({
    pairingTokenHash: tokenHash(input.token),
    status: "PENDING"
  }).select("+pairingTokenHash").exec();
  if (!session) throw new OperationsScanSessionError("This phone pairing code is invalid or has already been used.", 404);
  if (session.pairingExpiresAt <= new Date() || session.sessionExpiresAt <= new Date()) {
    session.status = "ENDED";
    session.endedAt = new Date();
    session.endedReason = "Phone pairing code expired.";
    session.activeBagId = null;
    await session.save();
    throw new OperationsScanSessionError("This phone pairing code has expired. Create a new one on the laptop.", 410);
  }
  if (!actorCanAccessBranch(input.actor, session.branchId)) {
    throw new OperationsScanSessionError("You do not have access to this manifest's branch.", 403);
  }

  session.phoneUserId = input.actor.userId;
  session.status = "ACTIVE";
  session.connectedAt = new Date();
  session.lastSeenAt = new Date();
  await session.save();
  return sessionDetail(session);
}

export async function getOperationsScanSession(input: { sessionId: string; actor: SessionActor }) {
  const session = await OperationsManifestScanSession.findById(objectId(input.sessionId, "Scanner session")).exec();
  if (!session) throw new OperationsScanSessionError("Scanner session was not found.", 404);
  await endExpiredSession(session);
  const isParticipant = [session.desktopUserId, session.phoneUserId].some((id) => id && String(id) === String(input.actor.userId));
  if (!isParticipant && input.actor.role !== "admin") throw new OperationsScanSessionError("You do not have access to this scanner session.", 403);
  if (!actorCanAccessBranch(input.actor, session.branchId)) throw new OperationsScanSessionError("You do not have access to this branch.", 403);
  if (session.status === "ACTIVE" && session.phoneUserId && String(session.phoneUserId) === String(input.actor.userId)) {
    session.lastSeenAt = new Date();
    await session.save();
  }
  return sessionDetail(session);
}

export async function getActiveOperationsScanSession(input: { manifestId: string; actor: SessionActor }) {
  const manifestId = objectId(input.manifestId, "Operations manifest");
  const session = await OperationsManifestScanSession.findOne({
    manifestId,
    status: "ACTIVE"
  }).sort({ connectedAt: -1 }).exec();
  if (!session) return null;
  await endExpiredSession(session);
  if (session.status !== "ACTIVE") return null;
  const isParticipant = [session.desktopUserId, session.phoneUserId].some((id) => id && String(id) === String(input.actor.userId));
  if (!isParticipant && input.actor.role !== "admin") throw new OperationsScanSessionError("You do not have access to this scanner session.", 403);
  if (!actorCanAccessBranch(input.actor, session.branchId)) throw new OperationsScanSessionError("You do not have access to this branch.", 403);
  return sessionDetail(session);
}

export async function updateOperationsScanSessionBag(input: {
  sessionId: string;
  manifestId: string;
  activeBagId: string;
  actor: SessionActor;
}) {
  const session = await OperationsManifestScanSession.findOne({
    _id: objectId(input.sessionId, "Scanner session"),
    manifestId: objectId(input.manifestId, "Operations manifest")
  }).exec();
  if (!session) throw new OperationsScanSessionError("Scanner session was not found.", 404);
  if (String(session.desktopUserId) !== String(input.actor.userId) && input.actor.role !== "admin") {
    throw new OperationsScanSessionError("Only the connected laptop can change the active bag.", 403);
  }
  if (session.status === "ENDED") throw new OperationsScanSessionError("This scanner session has ended.", 409);
  const bag = await OperationsManifestBag.findOne({
    _id: objectId(input.activeBagId, "Bag"),
    manifestId: session.manifestId,
    status: { $in: ["OPEN", "REOPENED"] }
  }).exec();
  if (!bag) throw new OperationsScanSessionError("Select an open bag from this manifest.", 409);
  session.activeBagId = bag._id as mongoose.Types.ObjectId;
  await session.save();
  return sessionDetail(session);
}

export async function endOperationsScanSession(input: {
  sessionId: string;
  manifestId: string;
  actor: SessionActor;
  reason?: string;
}) {
  const session = await OperationsManifestScanSession.findOne({
    _id: objectId(input.sessionId, "Scanner session"),
    manifestId: objectId(input.manifestId, "Operations manifest")
  }).exec();
  if (!session) throw new OperationsScanSessionError("Scanner session was not found.", 404);
  const isParticipant = [session.desktopUserId, session.phoneUserId].some((id) => id && String(id) === String(input.actor.userId));
  if (!isParticipant && input.actor.role !== "admin") throw new OperationsScanSessionError("You cannot disconnect this scanner.", 403);
  session.status = "ENDED";
  session.activeBagId = null;
  session.endedAt = new Date();
  session.endedReason = input.reason?.trim() || "Scanner disconnected.";
  await session.save();
  return sessionDetail(session);
}

export async function assertCameraScanSession(input: {
  sessionId: string;
  manifestId: string;
  bagId: string;
  actor: SessionActor;
}) {
  const session = await OperationsManifestScanSession.findOne({
    _id: objectId(input.sessionId, "Scanner session"),
    manifestId: objectId(input.manifestId, "Operations manifest"),
    status: "ACTIVE"
  }).exec();
  if (!session || session.sessionExpiresAt <= new Date()) {
    throw new OperationsScanSessionError("The phone scanner session has expired or disconnected.", 409);
  }
  if (!session.phoneUserId || String(session.phoneUserId) !== String(input.actor.userId)) {
    throw new OperationsScanSessionError("This phone is not paired with the manifest.", 403);
  }
  if (!session.activeBagId || String(session.activeBagId) !== input.bagId) {
    throw new OperationsScanSessionError("The active bag changed on the laptop. Refresh the phone and scan this parcel again.", 409);
  }
  session.lastSeenAt = new Date();
  session.lastScanAt = new Date();
  await session.save();
  return session;
}
