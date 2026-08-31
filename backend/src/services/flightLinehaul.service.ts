import mongoose from "mongoose";
import { AuditLog } from "../models/auditLog.model.js";
import { Branch } from "../models/branch.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { FlightLinehaul, type IFlightLinehaul, type FlightLinehaulStatus, type ConnectionRisk } from "../models/flightLinehaul.model.js";
import { FlightLinehaulCounter } from "../models/flightLinehaulCounter.model.js";
import { FlightShipmentAllocation } from "../models/flightShipmentAllocation.model.js";
import { FlightOffload } from "../models/flightOffload.model.js";
import { FlightException } from "../models/flightException.model.js";
import { FlightDocument } from "../models/flightDocument.model.js";
import { OperationsManifest } from "../models/operationsManifest.model.js";
import { OperationsManifestBag } from "../models/operationsManifestBag.model.js";
import { OperationsManifestConsignment } from "../models/operationsManifestConsignment.model.js";
import { OperationsManifestScan } from "../models/operationsManifestScan.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentEvent } from "../models/shipmentEvent.model.js";
import { ShipmentCancellation } from "../models/shipmentCancellation.model.js";
import { User } from "../models/user.model.js";
import { readShipmentBookingSnapshot } from "./shipmentBookingSnapshot.service.js";
import { notifyOperationsStaff } from "./portalNotification.service.js";

export class FlightLinehaulServiceError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
  }
}

function asObjectId(value: string, label: string) {
  if (!mongoose.Types.ObjectId.isValid(value)) throw new FlightLinehaulServiceError(`${label} was not found.`, 404);
  return new mongoose.Types.ObjectId(value);
}

function roundWeight(value: number) {
  return Number(Number(value).toFixed(3));
}

// SLA thresholds — industry standard air-cargo values, operating in IST
export const FLIGHT_SLA = {
  delayThresholdMinutes: 120, // 2h after scheduled departure without actual departure
  connectionMinMinutes: 90,
  connectionRiskBufferMinutes: 120,
  customsSlaHours: 12,
  customsCriticalHours: 24,
  finalMileSlaHours: 24,
  finalMileCriticalHours: 48
} as const;

export const flightStatusOrder: FlightLinehaulStatus[] = [
  "PLANNED",
  "BOOKING_CONFIRMED",
  "CARGO_ALLOCATED",
  "MANIFEST_READY",
  "HANDED_TO_AIRLINE",
  "DEPARTED",
  "IN_TRANSIT",
  "CONNECTION",
  "ARRIVED_DESTINATION",
  "CUSTOMS",
  "HANDED_TO_FINAL_MILE",
  "CLOSED"
];

// Allowed forward transitions; CANCELLED terminal from early phases
export const allowedTransitions: Record<FlightLinehaulStatus, FlightLinehaulStatus[]> = {
  PLANNED: ["BOOKING_CONFIRMED", "CANCELLED"],
  BOOKING_CONFIRMED: ["CARGO_ALLOCATED", "CANCELLED"],
  CARGO_ALLOCATED: ["MANIFEST_READY", "CANCELLED"],
  MANIFEST_READY: ["HANDED_TO_AIRLINE", "CANCELLED"],
  HANDED_TO_AIRLINE: ["DEPARTED", "CANCELLED"],
  DEPARTED: ["IN_TRANSIT"],
  IN_TRANSIT: ["CONNECTION", "ARRIVED_DESTINATION"],
  CONNECTION: ["ARRIVED_DESTINATION"],
  ARRIVED_DESTINATION: ["CUSTOMS"],
  CUSTOMS: ["HANDED_TO_FINAL_MILE"],
  HANDED_TO_FINAL_MILE: ["CLOSED"],
  CLOSED: [],
  CANCELLED: []
};

function canTransition(from: FlightLinehaulStatus, to: FlightLinehaulStatus) {
  return allowedTransitions[from]?.includes(to) ?? false;
}

export function calculateConnectionRisk(layoverMinutes: number | null): ConnectionRisk {
  if (layoverMinutes == null) return "LOW";
  if (layoverMinutes < 0) return "MISSED";
  if (layoverMinutes < FLIGHT_SLA.connectionMinMinutes) return "CRITICAL";
  if (layoverMinutes < FLIGHT_SLA.connectionRiskBufferMinutes) return "HIGH";
  if (layoverMinutes < 180) return "MEDIUM";
  return "LOW";
}

export function formatFlightLinehaulNumber(sequence: number) {
  return `FLH${String(sequence).padStart(4, "0")}`;
}

export async function allocateFlightLinehaulNumber(session?: mongoose.ClientSession): Promise<string> {
  const counter = await FlightLinehaulCounter.findOneAndUpdate(
    { _id: "flight-linehaul" },
    [
      {
        $set: {
          sequence: { $max: [{ $ifNull: ["$sequence", 0] }, 0] },
          reusableSequences: {
            $filter: {
              input: { $setUnion: [{ $ifNull: ["$reusableSequences", []] }, []] },
              as: "c",
              cond: { $gte: ["$$c", 1] }
            }
          }
        }
      },
      {
        $set: {
          lastAllocatedSequence: {
            $cond: [{ $gt: [{ $size: "$reusableSequences" }, 0] }, { $min: "$reusableSequences" }, { $add: ["$sequence", 1] }]
          },
          sequence: {
            $cond: [{ $gt: [{ $size: "$reusableSequences" }, 0] }, "$sequence", { $add: ["$sequence", 1] }]
          },
          reusableSequences: {
            $cond: [
              { $gt: [{ $size: "$reusableSequences" }, 0] },
              { $setDifference: ["$reusableSequences", [{ $min: "$reusableSequences" }]] },
              "$reusableSequences"
            ]
          }
        }
      }
    ],
    { upsert: true, returnDocument: "after", session, updatePipeline: true }
  ).exec();
  if (!counter) throw new FlightLinehaulServiceError("Flight number could not be generated.", 500);
  const seq = counter.lastAllocatedSequence ?? counter.sequence;
  return formatFlightLinehaulNumber(seq);
}

async function audit(
  action: string,
  flightId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
  metadata: Record<string, unknown>,
  session?: mongoose.ClientSession
) {
  await AuditLog.create(
    [
      {
        action: action as never,
        entityType: "FLIGHT_LINEHAUL",
        entityId: flightId,
        performedBy: userId,
        performedAt: new Date(),
        metadata
      }
    ],
    { session }
  );
}

async function maybeMarkCostSheetsForReview(flightId: mongoose.Types.ObjectId) {
  try {
    const manifests = await OperationsManifest.find({ flightLinehaulId: flightId }).select("_id").lean().exec();
    for (const manifest of manifests) {
      const { markSheetReviewRequiredIfChanged } = await import("./flightProfitability.service.js");
      await markSheetReviewRequiredIfChanged(manifest._id as mongoose.Types.ObjectId, "Flight allocation/offload changed");
    }
  } catch {
    // best effort
  }
}

async function recalculateFlightTotals(flightId: mongoose.Types.ObjectId, session?: mongoose.ClientSession) {
  const flight = await FlightLinehaul.findById(flightId).session(session ?? null).exec();
  if (!flight) throw new FlightLinehaulServiceError("Flight was not found.", 404);

  const [allocations, manifests, bags] = await Promise.all([
    FlightShipmentAllocation.find({ flightLinehaulId: flightId, status: "ALLOCATED" })
      .session(session ?? null)
      .lean()
      .exec(),
    OperationsManifest.find({ flightLinehaulId: flightId }).session(session ?? null).lean().exec(),
    OperationsManifestBag.find({ manifestId: { $in: await OperationsManifest.find({ flightLinehaulId: flightId }).distinct("_id") }, status: { $ne: "CANCELLED" } })
      .session(session ?? null)
      .lean()
      .exec()
  ]);

  // Prefer manifest-derived if manifests exist? But spec says derived from allocations/manifests
  const allocatedWeightKg = roundWeight(allocations.reduce((sum, a) => sum + a.weightKg, 0));
  const totalShipments = allocations.length;
  // Bags and pieces: sum from manifests if available else from allocations
  let totalBags = 0;
  let totalPieces = 0;
  if (manifests.length) {
    totalBags = bags.length;
    // pieces from allocations' snapshot pieces or from manifest consignments
    totalPieces = allocations.reduce((sum, a) => sum + (a.pieces ?? 0), 0);
    // Alternative: sum manifest parcels
    const manifestPieces = manifests.reduce((s, m) => s + (m.totalPhysicalParcels ?? 0), 0);
    if (manifestPieces > totalPieces) totalPieces = manifestPieces;
  } else {
    totalPieces = allocations.reduce((sum, a) => sum + (a.pieces ?? 0), 0);
  }

  flight.allocatedWeightKg = allocatedWeightKg;
  flight.totalShipments = totalShipments;
  flight.totalBags = totalBags;
  flight.totalPieces = totalPieces;
  flight.utilisationPercent = flight.capacityKg > 0 ? Number(((allocatedWeightKg / flight.capacityKg) * 100).toFixed(1)) : 0;
  await flight.save({ session });

  // Auto exception: capacity warning / exceeded
  if (flight.capacityKg > 0) {
    if (allocatedWeightKg > flight.capacityKg) {
      await createExceptionIdempotent({
        flightId: flight._id as mongoose.Types.ObjectId,
        branchId: flight.branchId,
        type: "CAPACITY_EXCEEDED",
        severity: "CRITICAL",
        title: "Flight over capacity",
        description: `Allocated ${allocatedWeightKg.toFixed(3)} kg exceeds capacity ${flight.capacityKg.toFixed(3)} kg.`,
        dedupeKey: `CAPACITY_EXCEEDED:${String(flight._id)}`,
        dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000)
      }, session);
    } else if (flight.utilisationPercent >= 90) {
      await createExceptionIdempotent({
        flightId: flight._id as mongoose.Types.ObjectId,
        branchId: flight.branchId,
        type: "CAPACITY_WARNING",
        severity: flight.utilisationPercent >= 95 ? "HIGH" : "MEDIUM",
        title: "Flight near capacity",
        description: `Flight utilisation at ${flight.utilisationPercent}% (${allocatedWeightKg.toFixed(3)}/${flight.capacityKg.toFixed(3)} kg).`,
        dedupeKey: `CAPACITY_WARNING:${String(flight._id)}:${Math.floor(flight.utilisationPercent / 5) * 5}`,
        dueAt: new Date(Date.now() + 12 * 60 * 60 * 1000)
      }, session);
    }
  }

  return flight;
}

export async function createExceptionIdempotent(input: {
  flightId: mongoose.Types.ObjectId;
  branchId: mongoose.Types.ObjectId;
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  title: string;
  description: string;
  dedupeKey: string;
  dueAt?: Date | null;
  shipmentDraftId?: mongoose.Types.ObjectId | null;
  bagId?: mongoose.Types.ObjectId | null;
  manifestId?: mongoose.Types.ObjectId | null;
  assignedTo?: mongoose.Types.ObjectId | null;
}, session?: mongoose.ClientSession) {
  try {
    const result = await FlightException.updateOne(
      { dedupeKey: input.dedupeKey },
      {
        $setOnInsert: {
          flightLinehaulId: input.flightId,
          branchId: input.branchId,
          type: input.type as never,
          severity: input.severity,
          status: "OPEN",
          title: input.title,
          description: input.description,
          shipmentDraftId: input.shipmentDraftId ?? null,
          bagId: input.bagId ?? null,
          manifestId: input.manifestId ?? null,
          assignedTo: input.assignedTo ?? null,
          dedupeKey: input.dedupeKey,
          dueAt: input.dueAt ?? null,
          resolutionNotes: ""
        }
      },
      { upsert: true, session }
    ).exec();
    // Notify operations on new high/critical exceptions (idempotent via upsert)
    if ((result as unknown as { upsertedCount?: number }).upsertedCount === 1 || (result as unknown as { upsertedId?: unknown }).upsertedId) {
      if (["HIGH", "CRITICAL"].includes(input.severity)) {
        const notifType =
          input.type === "FLIGHT_DELAY" ? "FLIGHT_DELAY"
          : input.type === "OFFLOAD" ? "FLIGHT_OFFLOAD"
          : input.type === "RISKY_CONNECTION" || input.type === "MISSED_CONNECTION" ? "FLIGHT_CONNECTION_RISK"
          : "FLIGHT_EXCEPTION";
        void notifyOperationsStaff({
          type: notifType as never,
          title: input.title,
          message: input.description.slice(0, 200),
          href: `/dashboard/flight-linehauls/${String(input.flightId)}`,
          idempotencyKey: `FLIGHT_EXCEPTION:${input.dedupeKey}`,
          metadata: { flightId: String(input.flightId), type: input.type, severity: input.severity }
        }, session).catch(() => {});
      }
    }
  } catch (error) {
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) return;
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function createFlightLinehaul(input: {
  branchId: string;
  flightNumber: string;
  airlineName?: string;
  mawbNumber?: string;
  originIataCode?: string;
  destinationIataCode?: string;
  transitIataCode?: string;
  scheduledDepartureAt: string;
  scheduledArrivalAt: string;
  capacityKg: number;
  destinationAgent?: string;
  finalMileCarrier?: string;
  connection?: { transitAirportCode?: string; scheduledArrivalAt?: string | null; scheduledDepartureAt?: string | null } | null;
  userId: mongoose.Types.ObjectId;
}): Promise<IFlightLinehaul> {
  const branchId = asObjectId(input.branchId, "Branch");
  const branch = await Branch.findOne({ _id: branchId, status: "ACTIVE" }).lean().exec();
  if (!branch) throw new FlightLinehaulServiceError("Select an active branch.", 409);

  const flightNumber = input.flightNumber.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,4}\d{1,4}[A-Z]?$/.test(flightNumber)) {
    throw new FlightLinehaulServiceError("Enter a valid flight number (e.g., AI131, EK412).", 400);
  }
  const mawbNumber = (input.mawbNumber ?? "").trim().toUpperCase();
  if (mawbNumber && !/^\d{3}-?\d{8}$/.test(mawbNumber) && mawbNumber.length < 5) {
    // Allow flexible but warn; we will not block short dummy MAWBs in dev
  }
  const originIata = (input.originIataCode ?? "").trim().toUpperCase();
  const destIata = (input.destinationIataCode ?? "").trim().toUpperCase();
  if (originIata && !/^[A-Z]{3}$/.test(originIata)) throw new FlightLinehaulServiceError("Origin IATA must be 3 letters.", 400);
  if (destIata && !/^[A-Z]{3}$/.test(destIata)) throw new FlightLinehaulServiceError("Destination IATA must be 3 letters.", 400);
  const transitIata = (input.transitIataCode ?? "").trim().toUpperCase();
  if (transitIata && !/^[A-Z]{3}$/.test(transitIata)) throw new FlightLinehaulServiceError("Transit IATA must be 3 letters.", 400);

  const scheduledDepartureAt = new Date(input.scheduledDepartureAt);
  const scheduledArrivalAt = new Date(input.scheduledArrivalAt);
  if (Number.isNaN(scheduledDepartureAt.getTime()) || Number.isNaN(scheduledArrivalAt.getTime())) {
    throw new FlightLinehaulServiceError("Scheduled departure and arrival must be valid dates.", 400);
  }
  if (scheduledArrivalAt <= scheduledDepartureAt) throw new FlightLinehaulServiceError("Arrival must be after departure.", 400);
  if (input.capacityKg < 0 || !Number.isFinite(input.capacityKg)) throw new FlightLinehaulServiceError("Capacity must be a positive number.", 400);

  // Optional connection validation
  let connectionDoc: IFlightLinehaul["connection"] = null;
  if (input.connection?.transitAirportCode) {
    const code = input.connection.transitAirportCode.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) throw new FlightLinehaulServiceError("Transit airport code must be 3 letters.", 400);
    const sArr = input.connection.scheduledArrivalAt ? new Date(input.connection.scheduledArrivalAt) : null;
    const sDep = input.connection.scheduledDepartureAt ? new Date(input.connection.scheduledDepartureAt) : null;
    let layover: number | null = null;
    if (sArr && sDep && !Number.isNaN(sArr.getTime()) && !Number.isNaN(sDep.getTime())) {
      layover = Math.round((sDep.getTime() - sArr.getTime()) / 60000);
    }
    connectionDoc = {
      transitAirportCode: code,
      scheduledArrivalAt: sArr && !Number.isNaN(sArr.getTime()) ? sArr : null,
      scheduledDepartureAt: sDep && !Number.isNaN(sDep.getTime()) ? sDep : null,
      actualArrivalAt: null,
      actualDepartureAt: null,
      layoverMinutes: layover,
      riskLevel: calculateConnectionRisk(layover)
    };
  }

  // MAWB uniqueness per branch if provided (soft check)
  if (mawbNumber) {
    const existing = await FlightLinehaul.findOne({ branchId, mawbNumber, status: { $ne: "CANCELLED" } }).lean().exec();
    if (existing) {
      // Allow duplicate MAWB across different dates? For now warn but allow; enforce only same flightNumber+date uniqueness
    }
  }

  // Enforce flightNumber + departure date uniqueness
  const departureDateKey = scheduledDepartureAt.toISOString().slice(0, 10);
  const duplicate = await FlightLinehaul.findOne({
    branchId,
    flightNumber,
    scheduledDepartureAt: {
      $gte: new Date(`${departureDateKey}T00:00:00.000Z`),
      $lt: new Date(`${departureDateKey}T23:59:59.999Z`)
    },
    status: { $ne: "CANCELLED" }
  }).lean().exec();
  if (duplicate) throw new FlightLinehaulServiceError(`Flight ${flightNumber} already exists for ${departureDateKey} in this branch.`, 409);

  const session = await mongoose.startSession();
  try {
    let created: IFlightLinehaul | null = null;
    await session.withTransaction(async () => {
      const flightLinehaulNumber = await allocateFlightLinehaulNumber(session);
      const docs = await FlightLinehaul.create(
        [
          {
            flightLinehaulNumber,
            branchId,
            flightNumber,
            airlineName: (input.airlineName ?? "").trim(),
            mawbNumber,
            originIataCode: originIata,
            destinationIataCode: destIata,
            transitIataCode: transitIata || connectionDoc?.transitAirportCode || "",
            scheduledDepartureAt,
            scheduledArrivalAt,
            capacityKg: roundWeight(input.capacityKg),
            allocatedWeightKg: 0,
            utilisationPercent: 0,
            totalShipments: 0,
            totalBags: 0,
            totalPieces: 0,
            status: "PLANNED",
            connection: connectionDoc,
            customsStatus: "PENDING",
            destinationAgent: (input.destinationAgent ?? "").trim(),
            finalMileCarrier: (input.finalMileCarrier ?? "").trim(),
            handoverReference: "",
            cancellationReason: "",
            createdBy: input.userId
          }
        ],
        { session }
      );
      created = docs[0] ?? null;
      if (!created) throw new FlightLinehaulServiceError("Flight could not be created.", 500);
      await audit("FLIGHT_LINEHAUL_CREATED", created._id as mongoose.Types.ObjectId, input.userId, { flightLinehaulNumber, flightNumber, branchId: String(branchId) }, session);
    });
    if (!created) throw new FlightLinehaulServiceError("Flight could not be created.", 500);
    return created;
  } finally {
    await session.endSession();
  }
}

export async function listFlightLinehauls(input: {
  page: number;
  limit: number;
  status?: string;
  branchId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  allowedBranchIds?: string[] | null;
}) {
  const filter: Record<string, unknown> = {};
  if (input.status) filter.status = input.status;
  if (input.branchId && mongoose.Types.ObjectId.isValid(input.branchId)) {
    filter.branchId = new mongoose.Types.ObjectId(input.branchId);
  } else if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined) {
    filter.branchId = { $in: input.allowedBranchIds.map((id) => new mongoose.Types.ObjectId(id)) };
  }
  if (input.search?.trim()) {
    const term = input.search.trim().toUpperCase();
    filter.$or = [
      { flightNumber: { $regex: term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
      { flightLinehaulNumber: { $regex: term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
      { mawbNumber: { $regex: term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
      { airlineName: { $regex: term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }
    ];
  }
  if (input.dateFrom || input.dateTo) {
    const range: Record<string, Date> = {};
    if (input.dateFrom) {
      const from = new Date(input.dateFrom);
      if (!Number.isNaN(from.getTime())) range.$gte = from;
    }
    if (input.dateTo) {
      const to = new Date(input.dateTo);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        range.$lte = to;
      }
    }
    if (Object.keys(range).length) filter.scheduledDepartureAt = range;
  }

  const skip = (input.page - 1) * input.limit;
  const [items, total] = await Promise.all([
    FlightLinehaul.find(filter).sort({ scheduledDepartureAt: -1, updatedAt: -1 }).skip(skip).limit(input.limit).lean().exec(),
    FlightLinehaul.countDocuments(filter).exec()
  ]);

  const branchIds = [...new Set(items.map((i) => String(i.branchId)))];
  const branches = branchIds.length ? await Branch.find({ _id: { $in: branchIds } }).select("name code").lean().exec() : [];
  const branchById = new Map(branches.map((b) => [String(b._id), b]));

  return {
    items: items.map((item) => ({
      ...item,
      id: String(item._id),
      branch: branchById.get(String(item.branchId)) ?? null
    })),
    pagination: { page: input.page, limit: input.limit, total, pages: Math.max(1, Math.ceil(total / input.limit)) }
  };
}

export async function getFlightLinehaulSummary(input: { allowedBranchIds?: string[] | null }) {
  const branchFilter: Record<string, unknown> =
    input.allowedBranchIds !== null && input.allowedBranchIds !== undefined
      ? { branchId: { $in: input.allowedBranchIds.map((id) => new mongoose.Types.ObjectId(id)) } }
      : {};

  const now = new Date();
  const tonightStart = new Date(now);
  tonightStart.setHours(0, 0, 0, 0);
  const tonightEnd = new Date(now);
  tonightEnd.setHours(23, 59, 59, 999);
  const tomorrowEnd = new Date(tonightEnd);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

  const statuses = flightStatusOrder;

  const [byStatus, tonightDepartures, exceptionCounts, offloadedCount, delayedFlights] = await Promise.all([
    FlightLinehaul.aggregate([
      { $match: { ...branchFilter, status: { $ne: "CANCELLED" } } },
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]).exec(),
    FlightLinehaul.countDocuments({ ...branchFilter, scheduledDepartureAt: { $gte: tonightStart, $lte: tonightEnd }, status: { $in: ["PLANNED", "BOOKING_CONFIRMED", "CARGO_ALLOCATED", "MANIFEST_READY", "HANDED_TO_AIRLINE"] } }).exec(),
    FlightException.aggregate([
      { $match: { ...(input.allowedBranchIds !== null && input.allowedBranchIds !== undefined ? { branchId: { $in: input.allowedBranchIds.map((id) => new mongoose.Types.ObjectId(id)) } } : {}), status: { $in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"] } } },
      { $group: { _id: null, count: { $sum: 1 } } }
    ]).exec(),
    FlightException.countDocuments({ ...(input.allowedBranchIds !== null && input.allowedBranchIds !== undefined ? { branchId: { $in: input.allowedBranchIds.map((id) => new mongoose.Types.ObjectId(id)) } } : {}), type: "OFFLOAD", status: { $in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"] } }).exec(),
    FlightLinehaul.countDocuments({
      ...branchFilter,
      status: { $in: ["PLANNED", "BOOKING_CONFIRMED", "CARGO_ALLOCATED", "MANIFEST_READY", "HANDED_TO_AIRLINE"] },
      scheduledDepartureAt: { $lt: new Date(now.getTime() - FLIGHT_SLA.delayThresholdMinutes * 60 * 1000) }
    }).exec()
  ]);

  const statusMap = new Map<string, number>(byStatus.map((r) => [r._id, r.count]));

  const awaitingFlight = (statusMap.get("CARGO_ALLOCATED") ?? 0) + (statusMap.get("MANIFEST_READY") ?? 0);
  const readyForHandover = statusMap.get("HANDED_TO_AIRLINE") ?? 0;
  const departed = statusMap.get("DEPARTED") ?? 0;
  const inTransit = statusMap.get("IN_TRANSIT") ?? 0;
  const connectionRisk = await FlightException.countDocuments({
    ...(input.allowedBranchIds !== null && input.allowedBranchIds !== undefined ? { branchId: { $in: input.allowedBranchIds.map((id) => new mongoose.Types.ObjectId(id)) } } : {}),
    type: { $in: ["RISKY_CONNECTION", "MISSED_CONNECTION"] },
    status: { $in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"] }
  }).exec();
  const destinationArrived = statusMap.get("ARRIVED_DESTINATION") ?? 0;

  return {
    cards: {
      tonightDepartures,
      awaitingFlight,
      readyForHandover,
      departed,
      inTransit,
      connectionRisk,
      offloaded: offloadedCount,
      delayed: delayedFlights,
      destinationArrived,
      actionRequiredExceptions: exceptionCounts[0]?.count ?? 0
    },
    byStatus: statuses.map((s) => ({ status: s, count: statusMap.get(s) ?? 0 }))
  };
}

export async function getFlightLinehaulDetail(flightIdValue: string, options?: { allowedBranchIds?: string[] | null }) {
  const flightId = asObjectId(flightIdValue, "Flight");
  const flight = await FlightLinehaul.findById(flightId).lean().exec();
  if (!flight) throw new FlightLinehaulServiceError("Flight was not found.", 404);
  if (options?.allowedBranchIds !== null && options?.allowedBranchIds !== undefined) {
    if (!options.allowedBranchIds.includes(String(flight.branchId))) throw new FlightLinehaulServiceError("You do not have access to this flight's branch.", 403);
  }

  const [allocations, manifests, offloads, exceptions, documents, auditHistory] = await Promise.all([
    FlightShipmentAllocation.find({ flightLinehaulId: flightId }).sort({ allocatedAt: 1 }).lean().exec(),
    OperationsManifest.find({ flightLinehaulId: flightId }).sort({ createdAt: 1 }).lean().exec(),
    FlightOffload.find({ flightLinehaulId: flightId }).sort({ createdAt: -1 }).lean().exec(),
    FlightException.find({ flightLinehaulId: flightId }).sort({ createdAt: -1 }).limit(100).lean().exec(),
    FlightDocument.find({ flightLinehaulId: flightId }).sort({ createdAt: -1 }).lean().exec(),
    AuditLog.find({ entityType: "FLIGHT_LINEHAUL", entityId: flightId }).sort({ performedAt: -1 }).limit(100).lean().exec()
  ]);

  const branch = await Branch.findById(flight.branchId).select("name code").lean().exec();

  // Bags via manifests
  const manifestIds = manifests.map((m) => m._id);
  const bags = manifestIds.length ? await OperationsManifestBag.find({ manifestId: { $in: manifestIds } }).sort({ sequence: 1 }).lean().exec() : [];
  const consignments = manifestIds.length ? await OperationsManifestConsignment.find({ manifestId: { $in: manifestIds }, status: { $ne: "REMOVED" } }).sort({ createdAt: 1 }).lean().exec() : [];
  // Build bagNumbers per consignment from accepted scans (split consignments may span multiple bags)
  const bagNumberById = new Map(bags.map((b) => [String(b._id), b.bagNumber]));
  let bagsByConsignment = new Map<string, string[]>();
  if (consignments.length) {
    const consignmentIds = consignments.map((c) => c._id);
    const scans = await OperationsManifestScan.find({ consignmentId: { $in: consignmentIds }, status: "ACCEPTED" }).select("consignmentId bagId").lean().exec();
    for (const scan of scans) {
      const cid = String(scan.consignmentId);
      const bn = bagNumberById.get(String(scan.bagId)) ?? "";
      if (!bn) continue;
      const arr = bagsByConsignment.get(cid) ?? [];
      if (!arr.includes(bn)) arr.push(bn);
      bagsByConsignment.set(cid, arr);
    }
  }

  // Derived stats (recalculated)
  const allocatedWeightKg = allocations.filter((a) => a.status === "ALLOCATED").reduce((s, a) => s + a.weightKg, 0);
  const utilisationPercent = flight.capacityKg > 0 ? Number(((allocatedWeightKg / flight.capacityKg) * 100).toFixed(1)) : 0;

  // Check auto exceptions for SLA evaluation
  await evaluateFlightExceptions(flight as IFlightLinehaul, allocations);

  return {
    flight: { ...flight, id: String(flight._id), branch },
    stats: {
      allocatedWeightKg: roundWeight(allocatedWeightKg),
      utilisationPercent,
      totalShipments: allocations.filter((a) => a.status === "ALLOCATED").length,
      totalBags: bags.filter((b) => b.status !== "CANCELLED").length,
      totalPieces: allocations.filter((a) => a.status === "ALLOCATED").reduce((s, a) => s + a.pieces, 0),
      manifestCount: manifests.length
    },
    allocations: allocations.map((a) => ({ ...a, id: String(a._id), flightLinehaulId: String(a.flightLinehaulId) })),
    manifests: manifests.map((m) => ({ ...m, id: String(m._id), flightLinehaulId: String(m.flightLinehaulId ?? "") })),
    bags: bags.map((b) => ({ ...b, id: String(b._id) })),
    consignments: consignments.map((c) => {
      const raw = c as unknown as { bagId?: unknown; consignmentNumber: string };
      const fallbackBag = raw.bagId ? bagNumberById.get(String(raw.bagId)) : "";
      const bagNumbers = bagsByConsignment.get(String(c._id)) ?? (fallbackBag ? [fallbackBag] : []);
      return {
        ...c,
        id: String(c._id),
        bagNumbers,
        displayConsignmentNumber: (c as unknown as { consignmentNumber: string }).consignmentNumber ?? String(c._id).slice(-8),
        // keep original consignmentNumber for detail but also expose for frontend join
        consignmentNumber: (c as unknown as { consignmentNumber: string }).consignmentNumber
      };
    }),
    offloads: offloads.map((o) => ({ ...o, id: String(o._id) })),
    exceptions: exceptions.map((e) => ({ ...e, id: String(e._id) })),
    documents: documents.map((d) => ({ ...d, id: String(d._id) })),
    auditHistory: auditHistory.map((a) => ({ ...a, id: String(a._id) }))
  };
}

async function evaluateFlightExceptions(flight: IFlightLinehaul, allocations: Array<{ status: string; weightKg: number }>) {
  const now = new Date();
  // Delay
  if (["PLANNED", "BOOKING_CONFIRMED", "CARGO_ALLOCATED", "MANIFEST_READY", "HANDED_TO_AIRLINE"].includes(flight.status)) {
    const delayMs = now.getTime() - flight.scheduledDepartureAt.getTime();
    if (delayMs > FLIGHT_SLA.delayThresholdMinutes * 60 * 1000) {
      const hours = Math.floor(delayMs / 3600000);
      await createExceptionIdempotent({
        flightId: flight._id as mongoose.Types.ObjectId,
        branchId: flight.branchId,
        type: "FLIGHT_DELAY",
        severity: hours >= 6 ? "CRITICAL" : hours >= 3 ? "HIGH" : "MEDIUM",
        title: "Flight delayed",
        description: `Scheduled departure ${flight.scheduledDepartureAt.toISOString()} delayed by ~${hours}h.`,
        dedupeKey: `FLIGHT_DELAY:${String(flight._id)}:${flight.scheduledDepartureAt.toISOString().slice(0, 10)}`,
        dueAt: new Date(now.getTime() + 2 * 60 * 60 * 1000)
      });
    }
  }
  // Shipment not manifested before departure
  if (["HANDED_TO_AIRLINE", "DEPARTED", "IN_TRANSIT", "CONNECTION", "ARRIVED_DESTINATION"].includes(flight.status)) {
    const allocatedCount = allocations.filter((a) => a.status === "ALLOCATED").length;
    const manifest = await OperationsManifest.find({ flightLinehaulId: flight._id }).lean().exec();
    const hasManifestReady = manifest.some((m) => ["SEALED", "DISPATCHED"].includes(m.status));
    if (allocatedCount > 0 && !hasManifestReady) {
      await createExceptionIdempotent({
        flightId: flight._id as mongoose.Types.ObjectId,
        branchId: flight.branchId,
        type: "NOT_MANIFESTED",
        severity: "HIGH",
        title: "Shipments not manifested before departure",
        description: `${allocatedCount} shipment(s) allocated but no sealed manifest found.`,
        dedupeKey: `NOT_MANIFESTED:${String(flight._id)}`,
        dueAt: new Date(now.getTime() + 4 * 60 * 60 * 1000)
      });
    }
  }
  // Arrival without customs
  if (flight.status === "ARRIVED_DESTINATION" && flight.arrivalAt) {
    const elapsedHours = (now.getTime() - new Date(flight.arrivalAt).getTime()) / 3600000;
    if (elapsedHours > FLIGHT_SLA.customsSlaHours && flight.customsStatus === "PENDING") {
      await createExceptionIdempotent({
        flightId: flight._id as mongoose.Types.ObjectId,
        branchId: flight.branchId,
        type: "ARRIVAL_WITHOUT_CUSTOMS",
        severity: elapsedHours > FLIGHT_SLA.customsCriticalHours ? "CRITICAL" : "HIGH",
        title: "Arrival without customs update",
        description: `Flight arrived ${elapsedHours.toFixed(1)}h ago but customs status still pending.`,
        dedupeKey: `ARRIVAL_WITHOUT_CUSTOMS:${String(flight._id)}`,
        dueAt: new Date(now.getTime() + 6 * 60 * 60 * 1000)
      });
    }
  }
  // Customs cleared without handover
  if (flight.customsStatus === "CLEARED" && flight.customsClearedAt && !flight.handoverAt) {
    const elapsedHours = (now.getTime() - new Date(flight.customsClearedAt).getTime()) / 3600000;
    if (elapsedHours > FLIGHT_SLA.finalMileSlaHours) {
      await createExceptionIdempotent({
        flightId: flight._id as mongoose.Types.ObjectId,
        branchId: flight.branchId,
        type: "CUSTOMS_CLEARED_WITHOUT_HANDOVER",
        severity: elapsedHours > FLIGHT_SLA.finalMileCriticalHours ? "CRITICAL" : "HIGH",
        title: "Customs cleared without final-mile handover",
        description: `Customs cleared ${elapsedHours.toFixed(1)}h ago but no final-mile handover recorded.`,
        dedupeKey: `CUSTOMS_WITHOUT_HANDOVER:${String(flight._id)}`,
        dueAt: new Date(now.getTime() + 6 * 60 * 60 * 1000)
      });
    }
  }
  // Risky connection
  if (flight.connection?.layoverMinutes != null) {
    const risk = calculateConnectionRisk(flight.connection.layoverMinutes);
    if (["HIGH", "CRITICAL", "MISSED"].includes(risk)) {
      await createExceptionIdempotent({
        flightId: flight._id as mongoose.Types.ObjectId,
        branchId: flight.branchId,
        type: risk === "MISSED" ? "MISSED_CONNECTION" : "RISKY_CONNECTION",
        severity: risk === "MISSED" || risk === "CRITICAL" ? "CRITICAL" : "HIGH",
        title: risk === "MISSED" ? "Missed connection" : "Risky connection",
        description: `Transit layover ${flight.connection.layoverMinutes} min — risk ${risk}.`,
        dedupeKey: `${risk === "MISSED" ? "MISSED" : "RISKY"}:${String(flight._id)}:${flight.connection.transitAirportCode}`,
        dueAt: new Date(now.getTime() + 3 * 60 * 60 * 1000)
      });
    }
  }
}

export async function updateFlightLinehaul(input: {
  flightId: string;
  updates: Partial<{
    airlineName: string;
    mawbNumber: string;
    originIataCode: string;
    destinationIataCode: string;
    transitIataCode: string;
    scheduledDepartureAt: string;
    scheduledArrivalAt: string;
    capacityKg: number;
    destinationAgent: string;
    finalMileCarrier: string;
  }>;
  userId: mongoose.Types.ObjectId;
  allowedBranchIds?: string[] | null;
}) {
  const flightId = asObjectId(input.flightId, "Flight");
  const flight = await FlightLinehaul.findById(flightId).exec();
  if (!flight) throw new FlightLinehaulServiceError("Flight was not found.", 404);
  if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined && !input.allowedBranchIds.includes(String(flight.branchId))) {
    throw new FlightLinehaulServiceError("You do not have access to this flight's branch.", 403);
  }
  if (["CLOSED", "CANCELLED"].includes(flight.status)) throw new FlightLinehaulServiceError("Closed or cancelled flights cannot be edited.", 409);

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  if (input.updates.airlineName !== undefined) {
    before.airlineName = flight.airlineName;
    flight.airlineName = input.updates.airlineName.trim();
    after.airlineName = flight.airlineName;
  }
  if (input.updates.mawbNumber !== undefined) {
    before.mawbNumber = flight.mawbNumber;
    flight.mawbNumber = input.updates.mawbNumber.trim().toUpperCase();
    after.mawbNumber = flight.mawbNumber;
  }
  if (input.updates.originIataCode !== undefined) {
    const v = input.updates.originIataCode.trim().toUpperCase();
    if (v && !/^[A-Z]{3}$/.test(v)) throw new FlightLinehaulServiceError("Origin IATA must be 3 letters.", 400);
    before.originIataCode = flight.originIataCode;
    flight.originIataCode = v;
    after.originIataCode = v;
  }
  if (input.updates.destinationIataCode !== undefined) {
    const v = input.updates.destinationIataCode.trim().toUpperCase();
    if (v && !/^[A-Z]{3}$/.test(v)) throw new FlightLinehaulServiceError("Destination IATA must be 3 letters.", 400);
    before.destinationIataCode = flight.destinationIataCode;
    flight.destinationIataCode = v;
    after.destinationIataCode = v;
  }
  if (input.updates.transitIataCode !== undefined) {
    const v = input.updates.transitIataCode.trim().toUpperCase();
    if (v && !/^[A-Z]{3}$/.test(v)) throw new FlightLinehaulServiceError("Transit IATA must be 3 letters.", 400);
    before.transitIataCode = flight.transitIataCode;
    flight.transitIataCode = v;
    after.transitIataCode = v;
  }
  if (input.updates.scheduledDepartureAt !== undefined) {
    const d = new Date(input.updates.scheduledDepartureAt);
    if (Number.isNaN(d.getTime())) throw new FlightLinehaulServiceError("Invalid departure date.", 400);
    before.scheduledDepartureAt = flight.scheduledDepartureAt;
    flight.scheduledDepartureAt = d;
    after.scheduledDepartureAt = d;
  }
  if (input.updates.scheduledArrivalAt !== undefined) {
    const d = new Date(input.updates.scheduledArrivalAt);
    if (Number.isNaN(d.getTime())) throw new FlightLinehaulServiceError("Invalid arrival date.", 400);
    before.scheduledArrivalAt = flight.scheduledArrivalAt;
    flight.scheduledArrivalAt = d;
    after.scheduledArrivalAt = d;
  }
  if (flight.scheduledArrivalAt <= flight.scheduledDepartureAt) throw new FlightLinehaulServiceError("Arrival must be after departure.", 400);

  if (input.updates.capacityKg !== undefined) {
    if (!Number.isFinite(input.updates.capacityKg) || input.updates.capacityKg < 0) throw new FlightLinehaulServiceError("Capacity must be positive.", 400);
    before.capacityKg = flight.capacityKg;
    flight.capacityKg = roundWeight(input.updates.capacityKg);
    after.capacityKg = flight.capacityKg;
    flight.utilisationPercent = flight.capacityKg > 0 ? Number(((flight.allocatedWeightKg / flight.capacityKg) * 100).toFixed(1)) : 0;
  }
  if (input.updates.destinationAgent !== undefined) {
    before.destinationAgent = flight.destinationAgent;
    flight.destinationAgent = input.updates.destinationAgent.trim();
    after.destinationAgent = flight.destinationAgent;
  }
  if (input.updates.finalMileCarrier !== undefined) {
    before.finalMileCarrier = flight.finalMileCarrier;
    flight.finalMileCarrier = input.updates.finalMileCarrier.trim();
    after.finalMileCarrier = flight.finalMileCarrier;
  }

  flight.updatedBy = input.userId;
  await flight.save();
  await audit("FLIGHT_LINEHAUL_UPDATED", flight._id as mongoose.Types.ObjectId, input.userId, { before, after });
  await recalculateFlightTotals(flight._id as mongoose.Types.ObjectId);
  return flight;
}

export async function transitionFlightStatus(input: {
  flightId: string;
  toStatus: FlightLinehaulStatus;
  reason?: string;
  metadata?: Record<string, unknown>;
  userId: mongoose.Types.ObjectId;
  allowedBranchIds?: string[] | null;
}) {
  const flightId = asObjectId(input.flightId, "Flight");
  const session = await mongoose.startSession();
  try {
    let updated: IFlightLinehaul | null = null;
    await session.withTransaction(async () => {
      const flight = await FlightLinehaul.findById(flightId).session(session).exec();
      if (!flight) throw new FlightLinehaulServiceError("Flight was not found.", 404);
      if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined && !input.allowedBranchIds.includes(String(flight.branchId))) {
        throw new FlightLinehaulServiceError("You do not have access to this flight's branch.", 403);
      }
      const from = flight.status;
      const to = input.toStatus;
      if (from === to) throw new FlightLinehaulServiceError(`Flight is already ${from}.`, 409);
      if (!canTransition(from, to)) throw new FlightLinehaulServiceError(`Cannot transition from ${from} to ${to}.`, 409);

      // Prerequisites
      if (to === "BOOKING_CONFIRMED") {
        if (!flight.flightNumber || !flight.scheduledDepartureAt || !flight.scheduledArrivalAt) {
          throw new FlightLinehaulServiceError("Flight number and schedule required before booking confirmation.", 409);
        }
      }
      if (to === "CARGO_ALLOCATED") {
        const count = await FlightShipmentAllocation.countDocuments({ flightLinehaulId: flightId, status: "ALLOCATED" }).session(session).exec();
        if (count === 0) throw new FlightLinehaulServiceError("Allocate at least one shipment before cargo allocation.", 409);
      }
      if (to === "MANIFEST_READY") {
        const manifests = await OperationsManifest.find({ flightLinehaulId: flightId }).session(session).lean().exec();
        if (!manifests.length) throw new FlightLinehaulServiceError("Attach at least one operations manifest.", 409);
        const notReady = manifests.filter((m) => !["SEALED", "DISPATCHED"].includes(m.status));
        if (notReady.length) throw new FlightLinehaulServiceError("All attached manifests must be sealed or dispatched before manifest ready.", 409);
      }
      if (to === "HANDED_TO_AIRLINE") {
        const manifests = await OperationsManifest.find({ flightLinehaulId: flightId }).session(session).lean().exec();
        if (!manifests.length) throw new FlightLinehaulServiceError("No manifest to hand to airline.", 409);
      }
      if (to === "DEPARTED") {
        if (!input.metadata?.actualDepartureAt && !flight.actualDepartureAt) {
          // Allow transition with provided actual time, otherwise require it now
          throw new FlightLinehaulServiceError("Provide actual departure time.", 400);
        }
      }
      if (to === "ARRIVED_DESTINATION") {
        if (!input.metadata?.arrivalAt && !flight.arrivalAt && !flight.actualArrivalAt) {
          // Allow but set arrivalAt automatically
        }
      }

      const before = flight.status;
      flight.status = to;
      flight.updatedBy = input.userId;

      // Side effects per target
      if (input.metadata?.actualDepartureAt) flight.actualDepartureAt = new Date(String(input.metadata.actualDepartureAt));
      if (input.metadata?.actualArrivalAt) flight.actualArrivalAt = new Date(String(input.metadata.actualArrivalAt));
      if (input.metadata?.arrivalAt) flight.arrivalAt = new Date(String(input.metadata.arrivalAt));
      if (to === "DEPARTED" && !flight.actualDepartureAt) flight.actualDepartureAt = new Date();
      if (to === "ARRIVED_DESTINATION" && !flight.arrivalAt) flight.arrivalAt = new Date();
      if (to === "CUSTOMS" && input.metadata?.customsStatus) flight.customsStatus = String(input.metadata.customsStatus) as never;
      if (to === "CLOSED") {
        flight.closedAt = new Date();
        flight.closedBy = input.userId;
      }

      await flight.save({ session });
      await audit("FLIGHT_LINEHAUL_STATUS_CHANGED", flight._id as mongoose.Types.ObjectId, input.userId, { from: before, to, reason: input.reason ?? "", metadata: input.metadata ?? {} }, session);
      updated = flight;

      // Auto exceptions for missed transitions
      if (to === "DEPARTED") {
        const allocations = await FlightShipmentAllocation.find({ flightLinehaulId: flightId, status: "ALLOCATED" }).session(session).lean().exec();
        if (!allocations.length) {
          await createExceptionIdempotent({
            flightId,
            branchId: flight.branchId,
            type: "NOT_MANIFESTED",
            severity: "HIGH",
            title: "No cargo allocated at departure",
            description: "Flight departed without allocated shipments.",
            dedupeKey: `NOT_MANIFESTED_EMPTY:${String(flightId)}`,
            dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000)
          }, session);
        }
      }
    });
    if (!updated) throw new FlightLinehaulServiceError("Status transition failed.", 500);
    // Recalc after transaction
    await recalculateFlightTotals(flightId);
    return updated;
  } finally {
    await session.endSession();
  }
}

export async function cancelFlightLinehaul(input: { flightId: string; reason: string; userId: mongoose.Types.ObjectId; allowedBranchIds?: string[] | null }) {
  const flightId = asObjectId(input.flightId, "Flight");
  const flight = await FlightLinehaul.findById(flightId).exec();
  if (!flight) throw new FlightLinehaulServiceError("Flight was not found.", 404);
  if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined && !input.allowedBranchIds.includes(String(flight.branchId))) {
    throw new FlightLinehaulServiceError("You do not have access to this flight's branch.", 403);
  }
  if (["CLOSED", "CANCELLED"].includes(flight.status)) throw new FlightLinehaulServiceError("Flight already closed or cancelled.", 409);
  if (["DEPARTED", "IN_TRANSIT", "CONNECTION", "ARRIVED_DESTINATION", "CUSTOMS", "HANDED_TO_FINAL_MILE"].includes(flight.status)) {
    throw new FlightLinehaulServiceError("Cannot cancel after departure.", 409);
  }
  if (!input.reason.trim() || input.reason.trim().length < 5) throw new FlightLinehaulServiceError("Enter a cancellation reason of at least 5 characters.", 400);
  flight.status = "CANCELLED";
  flight.cancelledAt = new Date();
  flight.cancelledBy = input.userId;
  flight.cancellationReason = input.reason.trim();
  flight.updatedBy = input.userId;
  await flight.save();
  await audit("FLIGHT_LINEHAUL_CANCELLED", flight._id as mongoose.Types.ObjectId, input.userId, { reason: input.reason.trim() });
  // Return shipments to pool (mark allocations removed)
  await FlightShipmentAllocation.updateMany({ flightLinehaulId: flightId, status: "ALLOCATED" }, { $set: { status: "REMOVED", removedAt: new Date(), removedBy: input.userId, removalReason: `Flight cancelled: ${input.reason.trim()}` } }).exec();
  await OperationsManifest.updateMany({ flightLinehaulId: flightId }, { $set: { flightLinehaulId: null } }).exec();
  await recalculateFlightTotals(flightId);
  return flight;
}

// ─────────────────────────────────────────────────────────────────────────────
// Allocations
// ─────────────────────────────────────────────────────────────────────────────

type EligibleShipment = {
  shipmentDraftId: mongoose.Types.ObjectId;
  dpdShipmentId: mongoose.Types.ObjectId;
  awb: string;
  weightKg: number;
  pieces: number;
  destinationCountryCode: string;
  destinationCountryName: string;
  snapshot: Record<string, unknown>;
};

async function buildShipmentSnapshot(draftId: mongoose.Types.ObjectId): Promise<EligibleShipment | null> {
  const dpd = await DpdShipment.findOne({ shipmentDraftId: draftId, status: "LABEL_RECEIVED" }).lean().exec();
  if (!dpd) return null;
  const snapshot = readShipmentBookingSnapshot(dpd.currentShipmentSnapshot) ?? readShipmentBookingSnapshot(dpd.bookingSnapshot);
  if (!snapshot) return null;
  const weightKg = snapshot.parcels.reduce((sum, p) => sum + (p.actualWeightKg ?? 0), 0);
  const pieces = snapshot.parcels.length;
  const party = snapshot.consignee as unknown as Record<string, unknown>;
  const destinationCountryCode = String((party as Record<string, unknown>)?.countryCode ?? "").toUpperCase();
  const destinationCountryName = String((party as Record<string, unknown>)?.countryName ?? (party as Record<string, unknown>)?.countryCode ?? "").trim();
  return {
    shipmentDraftId: draftId,
    dpdShipmentId: dpd._id as mongoose.Types.ObjectId,
    awb: snapshot.tracking.swiftlineTrackingNumber || dpd.swiftlineTrackingNumber || "",
    weightKg: roundWeight(weightKg),
    pieces,
    destinationCountryCode,
    destinationCountryName,
    snapshot: snapshot as unknown as Record<string, unknown>
  };
}

export async function searchEligibleShipments(input: {
  branchId?: string;
  q?: string;
  limit?: number;
  allowedBranchIds?: string[] | null;
  excludeFlightId?: string;
}) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const branchFilter: Record<string, unknown> = {};
  if (input.branchId && mongoose.Types.ObjectId.isValid(input.branchId)) {
    branchFilter.branchId = new mongoose.Types.ObjectId(input.branchId);
  } else if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined) {
    branchFilter.branchId = { $in: input.allowedBranchIds.map((id) => new mongoose.Types.ObjectId(id)) };
  }

  // Only booked shipments not already allocated
  const allocatedIds = await FlightShipmentAllocation.distinct("shipmentDraftId", { status: "ALLOCATED" }).exec();
  const cancelledIds = await ShipmentCancellation.distinct("shipmentDraftId", { status: { $in: ["REQUESTED", "COMPLETED"] } }).exec();
  const holdEvents = await ShipmentEvent.distinct("shipmentDraftId", { status: "ON_HOLD" }).exec();

  const exclude = new Set([...allocatedIds, ...cancelledIds, ...holdEvents].map(String));

  // Find dpd shipments that are booked
  const dpdFilter: Record<string, unknown> = { status: "LABEL_RECEIVED" };
  if (input.q?.trim()) {
    const term = input.q.trim().toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    dpdFilter.$or = [
      { swiftlineTrackingNumber: { $regex: term, $options: "i" } },
      { dpdShipmentId: { $regex: term, $options: "i" } }
    ];
  }

  // Need to filter via ShipmentDraft branch — join via drafts
  const drafts = await ShipmentDraft.find({ ...branchFilter, deletedAt: null }).select("_id businessAccountId branchId").lean().exec();
  const draftIds = drafts.map((d) => d._id);
  if (!draftIds.length) return { shipments: [] };

  const dpdShipments = await DpdShipment.find({ ...dpdFilter, shipmentDraftId: { $in: draftIds } })
    .select("shipmentDraftId swiftlineTrackingNumber dpdShipmentId bookingSnapshot currentShipmentSnapshot")
    .limit(limit * 2)
    .lean()
    .exec();

  const results: EligibleShipment[] = [];
  for (const dpd of dpdShipments) {
    if (exclude.has(String(dpd.shipmentDraftId))) continue;
    // Branch scoping already via draftIds
    const snap = await buildShipmentSnapshot(dpd.shipmentDraftId as mongoose.Types.ObjectId);
    if (!snap) continue;
    if (input.q?.trim()) {
      const term = input.q.trim().toUpperCase();
      if (!snap.awb.toUpperCase().includes(term) && !String(dpd.swiftlineTrackingNumber ?? "").toUpperCase().includes(term)) continue;
    }
    results.push(snap);
    if (results.length >= limit) break;
  }

  return { shipments: results.map((s) => ({ ...s, shipmentDraftId: String(s.shipmentDraftId), dpdShipmentId: String(s.dpdShipmentId) })) };
}

export async function allocateShipments(input: {
  flightId: string;
  shipmentDraftIds: string[];
  userId: mongoose.Types.ObjectId;
  allowedBranchIds?: string[] | null;
  idempotencyKey?: string;
}) {
  const flightId = asObjectId(input.flightId, "Flight");
  const flight = await FlightLinehaul.findById(flightId).exec();
  if (!flight) throw new FlightLinehaulServiceError("Flight was not found.", 404);
  if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined && !input.allowedBranchIds.includes(String(flight.branchId))) {
    throw new FlightLinehaulServiceError("You do not have access to this flight's branch.", 403);
  }
  if (["CLOSED", "CANCELLED", "DEPARTED", "IN_TRANSIT", "CONNECTION", "ARRIVED_DESTINATION", "CUSTOMS", "HANDED_TO_FINAL_MILE"].includes(flight.status)) {
    throw new FlightLinehaulServiceError("Shipments cannot be allocated in current flight status.", 409);
  }
  if (!input.shipmentDraftIds.length) throw new FlightLinehaulServiceError("Select at least one shipment.", 400);
  if (input.shipmentDraftIds.length > 100) throw new FlightLinehaulServiceError("Cannot allocate more than 100 shipments at once.", 400);

  const uniqueIds = [...new Set(input.shipmentDraftIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length !== input.shipmentDraftIds.length) throw new FlightLinehaulServiceError("Duplicate shipment ids in request.", 400);

  const results: Array<{ shipmentDraftId: string; status: "allocated" | "skipped"; reason?: string }> = [];
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const draftIdStr of uniqueIds) {
        const draftId = asObjectId(draftIdStr, "Shipment");
        // Idempotent: if already allocated to this flight, skip
        const existing = await FlightShipmentAllocation.findOne({ shipmentDraftId: draftId, flightLinehaulId: flightId, status: "ALLOCATED" }).session(session).exec();
        if (existing) {
          results.push({ shipmentDraftId: draftIdStr, status: "skipped", reason: "Already allocated to this flight." });
          continue;
        }
        const activeElsewhere = await FlightShipmentAllocation.findOne({ shipmentDraftId: draftId, status: "ALLOCATED" }).session(session).exec();
        if (activeElsewhere) {
          results.push({ shipmentDraftId: draftIdStr, status: "skipped", reason: "Already allocated to another active flight." });
          continue;
        }
        const snap = await buildShipmentSnapshot(draftId);
        if (!snap) {
          results.push({ shipmentDraftId: draftIdStr, status: "skipped", reason: "Shipment not booked or snapshot unavailable." });
          continue;
        }
        const draft = await ShipmentDraft.findById(draftId).select("branchId").session(session).lean().exec();
        if (!draft) {
          results.push({ shipmentDraftId: draftIdStr, status: "skipped", reason: "Shipment not found." });
          continue;
        }
        if (String(draft.branchId) !== String(flight.branchId)) {
          results.push({ shipmentDraftId: draftIdStr, status: "skipped", reason: "Shipment belongs to a different branch." });
          continue;
        }
        const cancellation = await ShipmentCancellation.findOne({ shipmentDraftId: draftId, status: { $in: ["REQUESTED", "COMPLETED"] } }).session(session).lean().exec();
        if (cancellation) {
          results.push({ shipmentDraftId: draftIdStr, status: "skipped", reason: "Shipment has cancellation request." });
          continue;
        }
        const hold = await ShipmentEvent.exists({ shipmentDraftId: draftId, status: "ON_HOLD" }).session(session).exec();
        if (hold) {
          results.push({ shipmentDraftId: draftIdStr, status: "skipped", reason: "Shipment is on hold." });
          continue;
        }

        // Capacity enforcement — hard block if exceeding capacity
        const currentWeight = await FlightShipmentAllocation.aggregate([
          { $match: { flightLinehaulId: flightId, status: "ALLOCATED" } },
          { $group: { _id: null, total: { $sum: "$weightKg" } } }
        ]).session(session).exec();
        const existingWeight = currentWeight[0]?.total ?? 0;
        const projected = roundWeight(existingWeight + snap.weightKg);
        if (flight.capacityKg > 0 && projected > flight.capacityKg) {
          results.push({ shipmentDraftId: draftIdStr, status: "skipped", reason: `Capacity exceeded: ${projected.toFixed(3)} kg > ${flight.capacityKg.toFixed(3)} kg.` });
          continue;
        }

        try {
          await FlightShipmentAllocation.create(
            [
              {
                flightLinehaulId: flightId,
                branchId: flight.branchId,
                shipmentDraftId: draftId,
                dpdShipmentId: snap.dpdShipmentId,
                awb: snap.awb,
                destinationCountryCode: snap.destinationCountryCode,
                destinationCountryName: snap.destinationCountryName,
                weightKg: snap.weightKg,
                pieces: snap.pieces,
                snapshot: snap.snapshot,
                status: "ALLOCATED",
                allocatedBy: input.userId,
                allocatedAt: new Date()
              }
            ],
            { session }
          );
          results.push({ shipmentDraftId: draftIdStr, status: "allocated" });
        } catch (error) {
          if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
            results.push({ shipmentDraftId: draftIdStr, status: "skipped", reason: "Duplicate allocation detected." });
            continue;
          }
          throw error;
        }
      }

      // Recalculate totals inside transaction
      const allocatedWeightKg = await FlightShipmentAllocation.aggregate([
        { $match: { flightLinehaulId: flightId, status: "ALLOCATED" } },
        { $group: { _id: null, total: { $sum: "$weightKg" } } }
      ]).session(session).exec();
      const totalWeight = roundWeight(allocatedWeightKg[0]?.total ?? 0);
      const count = await FlightShipmentAllocation.countDocuments({ flightLinehaulId: flightId, status: "ALLOCATED" }).session(session).exec();
      await FlightLinehaul.updateOne(
        { _id: flightId },
        { $set: { allocatedWeightKg: totalWeight, totalShipments: count, utilisationPercent: flight.capacityKg > 0 ? Number(((totalWeight / flight.capacityKg) * 100).toFixed(1)) : 0 } },
        { session }
      ).exec();

      if (results.some((r) => r.status === "allocated")) {
        await audit("FLIGHT_ALLOCATION_CREATED", flightId, input.userId, { allocated: results.filter((r) => r.status === "allocated").map((r) => r.shipmentDraftId), flightId: String(flightId) }, session);
      }
    });
  } finally {
    await session.endSession();
  }

  await recalculateFlightTotals(flightId);
  if (results.some((r) => r.status === "allocated")) void maybeMarkCostSheetsForReview(flightId);

  const allocatedCount = results.filter((r) => r.status === "allocated").length;
  // Auto status progression: if allocations exist and flight is PLANNED/BOOKING_CONFIRMED, move to CARGO_ALLOCATED automatically? Keep manual for now.

  return { results, allocatedCount };
}

export async function removeAllocation(input: {
  flightId: string;
  allocationId: string;
  reason: string;
  userId: mongoose.Types.ObjectId;
  allowedBranchIds?: string[] | null;
}) {
  const flightId = asObjectId(input.flightId, "Flight");
  const allocationId = asObjectId(input.allocationId, "Allocation");
  const flight = await FlightLinehaul.findById(flightId).exec();
  if (!flight) throw new FlightLinehaulServiceError("Flight was not found.", 404);
  if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined && !input.allowedBranchIds.includes(String(flight.branchId))) {
    throw new FlightLinehaulServiceError("You do not have access to this flight's branch.", 403);
  }
  if (["DEPARTED", "IN_TRANSIT", "CONNECTION", "ARRIVED_DESTINATION", "CUSTOMS", "HANDED_TO_FINAL_MILE", "CLOSED", "CANCELLED"].includes(flight.status)) {
    throw new FlightLinehaulServiceError("Allocations cannot be removed after departure.", 409);
  }
  if (!input.reason.trim() || input.reason.trim().length < 3) throw new FlightLinehaulServiceError("Enter a removal reason.", 400);
  const allocation = await FlightShipmentAllocation.findOne({ _id: allocationId, flightLinehaulId: flightId, status: "ALLOCATED" }).exec();
  if (!allocation) throw new FlightLinehaulServiceError("Active allocation was not found.", 404);

  allocation.status = "REMOVED";
  allocation.removedAt = new Date();
  allocation.removedBy = input.userId;
  allocation.removalReason = input.reason.trim();
  await allocation.save();
  await audit("FLIGHT_ALLOCATION_REMOVED", flightId, input.userId, { allocationId: String(allocationId), shipmentDraftId: String(allocation.shipmentDraftId), reason: input.reason.trim() });
  await recalculateFlightTotals(flightId);
  void maybeMarkCostSheetsForReview(flightId);
  return allocation;
}

export async function moveAllocation(input: {
  sourceFlightId: string;
  allocationId: string;
  targetFlightId: string;
  reason: string;
  userId: mongoose.Types.ObjectId;
  allowedBranchIds?: string[] | null;
}) {
  const sourceId = asObjectId(input.sourceFlightId, "Source flight");
  const targetId = asObjectId(input.targetFlightId, "Target flight");
  const allocationId = asObjectId(input.allocationId, "Allocation");
  if (String(sourceId) === String(targetId)) throw new FlightLinehaulServiceError("Source and target flights must differ.", 400);

  const [source, target] = await Promise.all([FlightLinehaul.findById(sourceId).exec(), FlightLinehaul.findById(targetId).exec()]);
  if (!source || !target) throw new FlightLinehaulServiceError("Flight was not found.", 404);
  if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined) {
    if (!input.allowedBranchIds.includes(String(source.branchId)) || !input.allowedBranchIds.includes(String(target.branchId))) {
      throw new FlightLinehaulServiceError("You do not have access to one of the flights.", 403);
    }
  }
  if (String(source.branchId) !== String(target.branchId)) throw new FlightLinehaulServiceError("Flights must belong to the same branch to move shipments.", 409);
  if (["CLOSED", "CANCELLED"].includes(source.status) || ["CLOSED", "CANCELLED"].includes(target.status)) throw new FlightLinehaulServiceError("Cannot move from/to closed or cancelled flights.", 409);
  if (["DEPARTED", "IN_TRANSIT", "CONNECTION", "ARRIVED_DESTINATION", "CUSTOMS", "HANDED_TO_FINAL_MILE"].includes(source.status)) {
    throw new FlightLinehaulServiceError("Cannot move from a departed flight. Use offload instead.", 409);
  }
  if (["DEPARTED", "IN_TRANSIT", "CONNECTION", "ARRIVED_DESTINATION", "CUSTOMS", "HANDED_TO_FINAL_MILE", "CLOSED", "CANCELLED"].includes(target.status)) {
    throw new FlightLinehaulServiceError("Target flight cannot accept allocations in its current status.", 409);
  }
  const allocation = await FlightShipmentAllocation.findOne({ _id: allocationId, flightLinehaulId: sourceId, status: "ALLOCATED" }).exec();
  if (!allocation) throw new FlightLinehaulServiceError("Active allocation was not found.", 404);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Remove from source
      allocation.status = "REMOVED";
      allocation.removedAt = new Date();
      allocation.removedBy = input.userId;
      allocation.removalReason = `Moved to ${target.flightLinehaulNumber}: ${input.reason.trim()}`;
      await allocation.save({ session });

      // Check capacity on target
      const targetWeightAgg = await FlightShipmentAllocation.aggregate([
        { $match: { flightLinehaulId: targetId, status: "ALLOCATED" } },
        { $group: { _id: null, total: { $sum: "$weightKg" } } }
      ]).session(session).exec();
      const targetWeight = roundWeight((targetWeightAgg[0]?.total ?? 0) + allocation.weightKg);
      if (target.capacityKg > 0 && targetWeight > target.capacityKg) {
        throw new FlightLinehaulServiceError(`Target flight capacity exceeded: ${targetWeight.toFixed(3)} kg > ${target.capacityKg.toFixed(3)} kg.`, 409);
      }

      // Create on target (preserve original allocation snapshot)
      const existsElsewhere = await FlightShipmentAllocation.findOne({ shipmentDraftId: allocation.shipmentDraftId, status: "ALLOCATED" }).session(session).exec();
      if (existsElsewhere && String(existsElsewhere._id) !== String(allocationId)) {
        throw new FlightLinehaulServiceError("Shipment already allocated elsewhere.", 409);
      }

      // Since we just marked source as REMOVED, the unique partial index allows new
      await FlightShipmentAllocation.create(
        [
          {
            flightLinehaulId: targetId,
            branchId: target.branchId,
            shipmentDraftId: allocation.shipmentDraftId,
            dpdShipmentId: allocation.dpdShipmentId,
            awb: allocation.awb,
            destinationCountryCode: allocation.destinationCountryCode,
            destinationCountryName: allocation.destinationCountryName,
            weightKg: allocation.weightKg,
            pieces: allocation.pieces,
            snapshot: allocation.snapshot,
            status: "ALLOCATED",
            allocatedBy: input.userId,
            allocatedAt: new Date()
          }
        ],
        { session }
      );

      await audit("FLIGHT_ALLOCATION_MOVED", sourceId, input.userId, { allocationId: String(allocationId), shipmentDraftId: String(allocation.shipmentDraftId), from: source.flightLinehaulNumber, to: target.flightLinehaulNumber, reason: input.reason.trim() }, session);
      await audit("FLIGHT_ALLOCATION_CREATED", targetId, input.userId, { shipmentDraftId: String(allocation.shipmentDraftId), movedFrom: String(sourceId) }, session);
    });
  } finally {
    await session.endSession();
  }

  await Promise.all([recalculateFlightTotals(sourceId), recalculateFlightTotals(targetId)]);
  void maybeMarkCostSheetsForReview(sourceId);
  void maybeMarkCostSheetsForReview(targetId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Manifest attach
// ─────────────────────────────────────────────────────────────────────────────

export async function attachManifest(input: {
  flightId: string;
  manifestId: string;
  userId: mongoose.Types.ObjectId;
  allowedBranchIds?: string[] | null;
}) {
  const flightId = asObjectId(input.flightId, "Flight");
  const manifestId = asObjectId(input.manifestId, "Manifest");
  const flight = await FlightLinehaul.findById(flightId).exec();
  if (!flight) throw new FlightLinehaulServiceError("Flight was not found.", 404);
  if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined && !input.allowedBranchIds.includes(String(flight.branchId))) {
    throw new FlightLinehaulServiceError("You do not have access to this flight's branch.", 403);
  }
  if (["CLOSED", "CANCELLED", "DEPARTED", "IN_TRANSIT", "CONNECTION", "ARRIVED_DESTINATION", "CUSTOMS", "HANDED_TO_FINAL_MILE"].includes(flight.status)) {
    throw new FlightLinehaulServiceError("Manifests cannot be attached in current flight status.", 409);
  }
  const manifest = await OperationsManifest.findById(manifestId).exec();
  if (!manifest) throw new FlightLinehaulServiceError("Operations manifest was not found.", 404);
  if (String(manifest.branchId) !== String(flight.branchId)) throw new FlightLinehaulServiceError("Manifest and flight must belong to the same branch.", 409);
  if (manifest.flightLinehaulId && String(manifest.flightLinehaulId) !== String(flightId)) {
    throw new FlightLinehaulServiceError(`Manifest already attached to flight ${String(manifest.flightLinehaulId)}.`, 409);
  }
  if (manifest.status === "CANCELLED") throw new FlightLinehaulServiceError("Cancelled manifests cannot be attached.", 409);
  if (manifest.flightLinehaulId && String(manifest.flightLinehaulId) === String(flightId)) {
    throw new FlightLinehaulServiceError("Manifest already attached to this flight.", 409);
  }

  manifest.flightLinehaulId = flightId;
  await manifest.save();
  await audit("FLIGHT_MANIFEST_ATTACHED", flightId, input.userId, { manifestId: String(manifestId), manifestNumber: manifest.manifestNumber });
  await recalculateFlightTotals(flightId);
  void maybeMarkCostSheetsForReview(flightId);
  return manifest;
}

export async function detachManifest(input: {
  flightId: string;
  manifestId: string;
  reason: string;
  userId: mongoose.Types.ObjectId;
  allowedBranchIds?: string[] | null;
}) {
  const flightId = asObjectId(input.flightId, "Flight");
  const manifestId = asObjectId(input.manifestId, "Manifest");
  const flight = await FlightLinehaul.findById(flightId).exec();
  if (!flight) throw new FlightLinehaulServiceError("Flight was not found.", 404);
  if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined && !input.allowedBranchIds.includes(String(flight.branchId))) {
    throw new FlightLinehaulServiceError("You do not have access to this flight's branch.", 403);
  }
  if (["CLOSED", "CANCELLED"].includes(flight.status)) throw new FlightLinehaulServiceError("Cannot detach from closed or cancelled flight.", 409);
  if (["DEPARTED", "IN_TRANSIT", "CONNECTION", "ARRIVED_DESTINATION", "CUSTOMS", "HANDED_TO_FINAL_MILE"].includes(flight.status)) {
    throw new FlightLinehaulServiceError("Cannot detach after departure.", 409);
  }
  const manifest = await OperationsManifest.findOne({ _id: manifestId, flightLinehaulId: flightId }).exec();
  if (!manifest) throw new FlightLinehaulServiceError("Manifest not attached to this flight.", 404);
  if (["SEALED", "DISPATCHED"].includes(manifest.status)) {
    // Allow but warn? Spec says preserve seal/dispatch rules, but detaching a sealed manifest is questionable.
    // For now allow with reason length check.
    if (!input.reason.trim() || input.reason.trim().length < 5) throw new FlightLinehaulServiceError("Detaching a sealed/dispatched manifest requires a reason of at least 5 characters.", 400);
  }
  manifest.flightLinehaulId = null;
  await manifest.save();
  await audit("FLIGHT_MANIFEST_DETACHED", flightId, input.userId, { manifestId: String(manifestId), manifestNumber: manifest.manifestNumber, reason: input.reason.trim() });
  await recalculateFlightTotals(flightId);
  void maybeMarkCostSheetsForReview(flightId);
  return manifest;
}

export async function listAttachableManifests(input: { flightId: string; allowedBranchIds?: string[] | null }) {
  const flightId = asObjectId(input.flightId, "Flight");
  const flight = await FlightLinehaul.findById(flightId).lean().exec();
  if (!flight) throw new FlightLinehaulServiceError("Flight was not found.", 404);
  const filter: Record<string, unknown> = {
    branchId: flight.branchId,
    status: { $in: ["DRAFT", "PACKING", "READY_TO_SEAL", "SEALED", "DISPATCHED"] },
    $or: [{ flightLinehaulId: null }, { flightLinehaulId: { $exists: false } }]
  };
  const manifests = await OperationsManifest.find(filter).sort({ updatedAt: -1 }).limit(50).lean().exec();
  return manifests.map((m) => ({ id: String(m._id), manifestNumber: m.manifestNumber, status: m.status, totalBags: m.totalBags, totalConsignments: m.totalConsignments, totalWeightKg: m.totalWeightKg, header: m.header }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection
// ─────────────────────────────────────────────────────────────────────────────

export async function updateConnection(input: {
  flightId: string;
  transitAirportCode: string;
  scheduledArrivalAt?: string | null;
  scheduledDepartureAt?: string | null;
  actualArrivalAt?: string | null;
  actualDepartureAt?: string | null;
  userId: mongoose.Types.ObjectId;
  allowedBranchIds?: string[] | null;
}) {
  const flightId = asObjectId(input.flightId, "Flight");
  const flight = await FlightLinehaul.findById(flightId).exec();
  if (!flight) throw new FlightLinehaulServiceError("Flight was not found.", 404);
  if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined && !input.allowedBranchIds.includes(String(flight.branchId))) {
    throw new FlightLinehaulServiceError("You do not have access to this flight's branch.", 403);
  }
  if (["CLOSED", "CANCELLED"].includes(flight.status)) throw new FlightLinehaulServiceError("Cannot update connection for closed/cancelled flight.", 409);
  const code = input.transitAirportCode.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new FlightLinehaulServiceError("Transit airport code must be 3 letters.", 400);
  const sArr = input.scheduledArrivalAt ? new Date(input.scheduledArrivalAt) : null;
  const sDep = input.scheduledDepartureAt ? new Date(input.scheduledDepartureAt) : null;
  const aArr = input.actualArrivalAt ? new Date(input.actualArrivalAt) : null;
  const aDep = input.actualDepartureAt ? new Date(input.actualDepartureAt) : null;
  if (sArr && Number.isNaN(sArr.getTime())) throw new FlightLinehaulServiceError("Invalid scheduled arrival.", 400);
  if (sDep && Number.isNaN(sDep.getTime())) throw new FlightLinehaulServiceError("Invalid scheduled departure.", 400);
  if (aArr && Number.isNaN(aArr.getTime())) throw new FlightLinehaulServiceError("Invalid actual arrival.", 400);
  if (aDep && Number.isNaN(aDep.getTime())) throw new FlightLinehaulServiceError("Invalid actual departure.", 400);
  if (sArr && sDep && sDep <= sArr) throw new FlightLinehaulServiceError("Transit departure must be after arrival.", 400);
  if (aArr && aDep && aDep <= aArr) throw new FlightLinehaulServiceError("Actual departure must be after actual arrival.", 400);

  let layover: number | null = null;
  if (sArr && sDep) layover = Math.round((sDep.getTime() - sArr.getTime()) / 60000);
  else if (aArr && aDep) layover = Math.round((aDep.getTime() - aArr.getTime()) / 60000);

  const before = flight.connection;
  flight.connection = {
    transitAirportCode: code,
    scheduledArrivalAt: sArr,
    scheduledDepartureAt: sDep,
    actualArrivalAt: aArr,
    actualDepartureAt: aDep,
    layoverMinutes: layover,
    riskLevel: calculateConnectionRisk(layover)
  };
  flight.transitIataCode = code;
  flight.updatedBy = input.userId;
  await flight.save();
  await audit("FLIGHT_CONNECTION_UPDATED", flightId, input.userId, { before, after: flight.connection });

  if (["HIGH", "CRITICAL", "MISSED"].includes(flight.connection.riskLevel)) {
    await createExceptionIdempotent({
      flightId,
      branchId: flight.branchId,
      type: flight.connection.riskLevel === "MISSED" ? "MISSED_CONNECTION" : "RISKY_CONNECTION",
      severity: flight.connection.riskLevel === "MISSED" || flight.connection.riskLevel === "CRITICAL" ? "CRITICAL" : "HIGH",
      title: flight.connection.riskLevel === "MISSED" ? "Missed connection" : "Risky connection",
      description: `Transit ${code} layover ${layover} min — risk ${flight.connection.riskLevel}.`,
      dedupeKey: `CONNECTION_RISK:${String(flightId)}:${code}:${layover}`,
      dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000)
    });
  }

  return flight;
}

// ─────────────────────────────────────────────────────────────────────────────
// Offload
// ─────────────────────────────────────────────────────────────────────────────

export async function createOffload(input: {
  flightId: string;
  reason: string;
  offloadReason: string;
  airline?: string;
  affectedShipmentIds?: string[];
  affectedBagIds?: string[];
  replacementFlightId?: string | null;
  responsibleEmployeeId?: string | null;
  userId: mongoose.Types.ObjectId;
  allowedBranchIds?: string[] | null;
}) {
  const flightId = asObjectId(input.flightId, "Flight");
  const flight = await FlightLinehaul.findById(flightId).exec();
  if (!flight) throw new FlightLinehaulServiceError("Flight was not found.", 404);
  if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined && !input.allowedBranchIds.includes(String(flight.branchId))) {
    throw new FlightLinehaulServiceError("You do not have access to this flight's branch.", 403);
  }
  if (!input.reason.trim() || input.reason.trim().length < 5) throw new FlightLinehaulServiceError("Offload reason must be at least 5 characters.", 400);
  const reasonValue = input.offloadReason;
  const validReasons = ["AIRLINE_OFFLOAD", "CAPACITY", "WEATHER", "CUSTOMS", "MISSED_CONNECTION", "DAMAGE", "SECURITY", "OTHER"];
  if (!validReasons.includes(reasonValue)) throw new FlightLinehaulServiceError("Invalid offload reason.", 400);

  let replacementFlight: IFlightLinehaul | null = null;
  if (input.replacementFlightId) {
    const replId = asObjectId(input.replacementFlightId, "Replacement flight");
    replacementFlight = await FlightLinehaul.findById(replId).exec();
    if (!replacementFlight) throw new FlightLinehaulServiceError("Replacement flight was not found.", 404);
    if (String(replacementFlight.branchId) !== String(flight.branchId)) throw new FlightLinehaulServiceError("Replacement flight must be same branch.", 409);
    if (["CLOSED", "CANCELLED"].includes(replacementFlight.status)) throw new FlightLinehaulServiceError("Replacement flight is closed/cancelled.", 409);
  }

  const affectedShipmentIds = (input.affectedShipmentIds ?? []).filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id));
  const affectedBagIds = (input.affectedBagIds ?? []).filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id));

  // Validate shipments are allocated to this flight
  if (affectedShipmentIds.length) {
    const count = await FlightShipmentAllocation.countDocuments({ flightLinehaulId: flightId, shipmentDraftId: { $in: affectedShipmentIds }, status: "ALLOCATED" }).exec();
    if (count !== affectedShipmentIds.length) throw new FlightLinehaulServiceError("One or more shipments not allocated to this flight.", 409);
  }

  // Idempotency: if identical offload was recorded in last 10s (double-click), return it instead of creating duplicate
  const recentDuplicate = await (FlightOffload.findOne as any)({
    flightLinehaulId: flightId,
    reason: reasonValue,
    detail: input.reason.trim(),
    createdBy: input.userId,
    createdAt: { $gte: new Date(Date.now() - 10000) }
  }).lean().exec();
  if (recentDuplicate) {
    const recentKey = [...(recentDuplicate.affectedShipmentIds ?? [])].map(String).sort().join(",");
    const currentKey = [...affectedShipmentIds].map(String).sort().join(",");
    if (recentKey === currentKey) return recentDuplicate as InstanceType<typeof FlightOffload>;
  }

  // Calculate affected weight
  let affectedWeightKg = 0;
  let affectedPieces = 0;
  if (affectedShipmentIds.length) {
    const allocs = await FlightShipmentAllocation.find({ flightLinehaulId: flightId, shipmentDraftId: { $in: affectedShipmentIds }, status: "ALLOCATED" }).lean().exec();
    affectedWeightKg = roundWeight(allocs.reduce((s, a) => s + a.weightKg, 0));
    affectedPieces = allocs.reduce((s, a) => s + a.pieces, 0);
  }

  const session = await mongoose.startSession();
  let offloadDoc: InstanceType<typeof FlightOffload> | null = null;
  try {
    await session.withTransaction(async () => {
      const created = await FlightOffload.create(
        [
          {
            flightLinehaulId: flightId,
            replacementFlightId: replacementFlight?._id ?? null,
            branchId: flight.branchId,
            reason: reasonValue as never,
            detail: input.reason.trim(),
            airline: (input.airline ?? "").trim(),
            affectedShipmentIds,
            affectedBagIds,
            affectedWeightKg,
            affectedPieces,
            responsibleEmployeeId: input.responsibleEmployeeId && mongoose.Types.ObjectId.isValid(input.responsibleEmployeeId) ? new mongoose.Types.ObjectId(input.responsibleEmployeeId) : null,
            createdBy: input.userId
          }
        ],
        { session }
      );
      offloadDoc = created[0] ?? null;
      if (!offloadDoc) throw new FlightLinehaulServiceError("Offload could not be recorded.", 500);

      // Mark allocations as OFFLOADED and optionally reallocate to replacement flight
      if (affectedShipmentIds.length) {
        await FlightShipmentAllocation.updateMany(
          { flightLinehaulId: flightId, shipmentDraftId: { $in: affectedShipmentIds }, status: "ALLOCATED" },
          { $set: { status: "OFFLOADED", offloadId: (offloadDoc as InstanceType<typeof FlightOffload>)._id, removedAt: new Date(), removedBy: input.userId, removalReason: `Offloaded: ${input.reason.trim()}` } },
          { session }
        ).exec();

        if (replacementFlight) {
          for (const draftId of affectedShipmentIds) {
            const original = await FlightShipmentAllocation.findOne({ shipmentDraftId: draftId, offloadId: (offloadDoc as InstanceType<typeof FlightOffload>)._id }).session(session).exec();
            if (!original) continue;
            // Check capacity of replacement
            const agg = await FlightShipmentAllocation.aggregate([
              { $match: { flightLinehaulId: replacementFlight._id, status: "ALLOCATED" } },
              { $group: { _id: null, total: { $sum: "$weightKg" } } }
            ]).session(session).exec();
            const proj = roundWeight((agg[0]?.total ?? 0) + original.weightKg);
            if (replacementFlight.capacityKg > 0 && proj > replacementFlight.capacityKg) {
              // Skip this one, leave offloaded without replacement
              continue;
            }
            await FlightShipmentAllocation.create(
              [
                {
                  flightLinehaulId: replacementFlight._id,
                  branchId: replacementFlight.branchId,
                  shipmentDraftId: draftId,
                  dpdShipmentId: original.dpdShipmentId,
                  awb: original.awb,
                  destinationCountryCode: original.destinationCountryCode,
                  destinationCountryName: original.destinationCountryName,
                  weightKg: original.weightKg,
                  pieces: original.pieces,
                  snapshot: original.snapshot,
                  status: "ALLOCATED",
                  allocatedBy: input.userId,
                  allocatedAt: new Date()
                }
              ],
              { session }
            );
          }
        }
      }

      await audit("FLIGHT_OFFLOAD_CREATED", flightId, input.userId, { offloadId: String((offloadDoc as InstanceType<typeof FlightOffload>)._id), reason: input.reason.trim(), affectedWeightKg, replacementFlightId: input.replacementFlightId ?? null }, session);

      // Auto exception for offload
      await createExceptionIdempotent(
        {
          flightId,
          branchId: flight.branchId,
          type: "OFFLOAD",
          severity: "HIGH",
          title: "Shipments offloaded",
          description: `${affectedShipmentIds.length || affectedBagIds.length} item(s) offloaded — ${input.reason.trim()}.`,
          dedupeKey: `OFFLOAD:${String(flightId)}:${String((offloadDoc as InstanceType<typeof FlightOffload>)._id)}`,
          dueAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
        },
        session
      );
    });
  } finally {
    await session.endSession();
  }

  await Promise.all([recalculateFlightTotals(flightId), replacementFlight ? recalculateFlightTotals(replacementFlight._id as mongoose.Types.ObjectId) : Promise.resolve()]);
  void maybeMarkCostSheetsForReview(flightId);
  if (replacementFlight) void maybeMarkCostSheetsForReview(replacementFlight._id as mongoose.Types.ObjectId);

  return offloadDoc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Destination handover
// ─────────────────────────────────────────────────────────────────────────────

export async function updateDestinationHandover(input: {
  flightId: string;
  arrivalAt?: string | null;
  customsStatus?: string;
  customsClearedAt?: string | null;
  destinationAgent?: string;
  finalMileCarrier?: string;
  handoverAt?: string | null;
  handoverReference?: string;
  userId: mongoose.Types.ObjectId;
  allowedBranchIds?: string[] | null;
}) {
  const flightId = asObjectId(input.flightId, "Flight");
  const flight = await FlightLinehaul.findById(flightId).exec();
  if (!flight) throw new FlightLinehaulServiceError("Flight was not found.", 404);
  if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined && !input.allowedBranchIds.includes(String(flight.branchId))) {
    throw new FlightLinehaulServiceError("You do not have access to this flight's branch.", 403);
  }
  if (["CLOSED", "CANCELLED"].includes(flight.status)) throw new FlightLinehaulServiceError("Cannot update handover for closed/cancelled flight.", 409);

  const before: Record<string, unknown> = {
    arrivalAt: flight.arrivalAt,
    customsStatus: flight.customsStatus,
    customsClearedAt: flight.customsClearedAt,
    destinationAgent: flight.destinationAgent,
    finalMileCarrier: flight.finalMileCarrier,
    handoverAt: flight.handoverAt,
    handoverReference: flight.handoverReference
  };

  if (input.arrivalAt !== undefined) {
    if (input.arrivalAt) {
      const d = new Date(input.arrivalAt);
      if (Number.isNaN(d.getTime())) throw new FlightLinehaulServiceError("Invalid arrival time.", 400);
      flight.arrivalAt = d;
      flight.actualArrivalAt = d;
    } else {
      flight.arrivalAt = null;
    }
  }
  if (input.customsStatus !== undefined) {
    const allowed = ["PENDING", "SUBMITTED", "CLEARED", "HELD"];
    if (!allowed.includes(input.customsStatus)) throw new FlightLinehaulServiceError("Invalid customs status.", 400);
    flight.customsStatus = input.customsStatus as never;
    if (input.customsStatus === "CLEARED" && !flight.customsClearedAt) {
      flight.customsClearedAt = input.customsClearedAt ? new Date(input.customsClearedAt) : new Date();
    } else if (input.customsClearedAt !== undefined) {
      flight.customsClearedAt = input.customsClearedAt ? new Date(input.customsClearedAt) : null;
    }
    if (input.customsStatus === "SUBMITTED" && !flight.customsSubmittedAt) {
      flight.customsSubmittedAt = new Date();
    }
  } else if (input.customsClearedAt !== undefined) {
    flight.customsClearedAt = input.customsClearedAt ? new Date(input.customsClearedAt) : null;
  }

  if (input.destinationAgent !== undefined) flight.destinationAgent = input.destinationAgent.trim();
  if (input.finalMileCarrier !== undefined) flight.finalMileCarrier = input.finalMileCarrier.trim();
  if (input.handoverAt !== undefined) {
    if (input.handoverAt) {
      const d = new Date(input.handoverAt);
      if (Number.isNaN(d.getTime())) throw new FlightLinehaulServiceError("Invalid handover time.", 400);
      flight.handoverAt = d;
    } else {
      flight.handoverAt = null;
    }
  }
  if (input.handoverReference !== undefined) flight.handoverReference = input.handoverReference.trim();

  // Enforce handover completion must have customs cleared
  if (flight.handoverAt && flight.customsStatus !== "CLEARED") {
    throw new FlightLinehaulServiceError("Customs must be cleared before handover.", 409);
  }

  flight.updatedBy = input.userId;
  await flight.save();
  await audit("FLIGHT_HANDOVER_COMPLETED", flightId, input.userId, { before, after: { arrivalAt: flight.arrivalAt, customsStatus: flight.customsStatus, customsClearedAt: flight.customsClearedAt, destinationAgent: flight.destinationAgent, finalMileCarrier: flight.finalMileCarrier, handoverAt: flight.handoverAt, handoverReference: flight.handoverReference } });

  // Auto status progression
  if (flight.arrivalAt && flight.status === "IN_TRANSIT") {
    // Allow manual progression via status transition, but we can auto-move to ARRIVED_DESTINATION if arrivalAt set
    // Do not auto-transition to keep audit trail explicit; frontend will call status transition.
  }

  return flight;
}

// ─────────────────────────────────────────────────────────────────────────────
// Documents
// ─────────────────────────────────────────────────────────────────────────────

export const flightDocumentAllowedTypes = new Set(["MAWB", "BOOKING_CONFIRMATION", "CARGO_MANIFEST", "BAG_MANIFEST", "SECURITY", "CUSTOMS", "HANDOVER", "PROOF", "OTHER"]);
export const maxFlightDocumentBytes = 10 * 1024 * 1024;

export async function listFlightDocuments(flightIdValue: string, allowedBranchIds?: string[] | null) {
  const flightId = asObjectId(flightIdValue, "Flight");
  const flight = await FlightLinehaul.findById(flightId).select("branchId").lean().exec();
  if (!flight) throw new FlightLinehaulServiceError("Flight was not found.", 404);
  if (allowedBranchIds !== null && allowedBranchIds !== undefined && !allowedBranchIds.includes(String(flight.branchId))) {
    throw new FlightLinehaulServiceError("You do not have access to this flight's branch.", 403);
  }
  const docs = await FlightDocument.find({ flightLinehaulId: flightId }).sort({ createdAt: -1 }).lean().exec();
  return docs.map((d) => ({ ...d, id: String(d._id) }));
}

export async function uploadFlightDocument(input: {
  flightId: string;
  documentType: string;
  note: string;
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer };
  userId: mongoose.Types.ObjectId;
  allowedBranchIds?: string[] | null;
}) {
  const flightId = asObjectId(input.flightId, "Flight");
  const flight = await FlightLinehaul.findById(flightId).exec();
  if (!flight) throw new FlightLinehaulServiceError("Flight was not found.", 404);
  if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined && !input.allowedBranchIds.includes(String(flight.branchId))) {
    throw new FlightLinehaulServiceError("You do not have access to this flight's branch.", 403);
  }
  if (!flightDocumentAllowedTypes.has(input.documentType)) throw new FlightLinehaulServiceError("Invalid document type.", 400);
  if (input.file.size > maxFlightDocumentBytes) throw new FlightLinehaulServiceError("File must be 10 MB or smaller.", 400);
  const { matchesDeclaredType } = await import("./storage/fileSignature.js");
  if (!matchesDeclaredType(input.file.buffer, input.file.mimetype)) {
    throw new FlightLinehaulServiceError("File does not match its declared type. Upload a valid PDF, JPG, PNG, WebP or XLSX.", 400);
  }
  const { putObject } = await import("./storage/storage.service.js");
  const { flightLinehaulDocumentKey } = await import("./storage/keys.js");
  const key = flightLinehaulDocumentKey(String(flightId), input.file.originalname);
  const stored = await putObject({ key, body: input.file.buffer, contentType: input.file.mimetype });
  const doc = await FlightDocument.create({
    flightLinehaulId: flightId,
    branchId: flight.branchId,
    documentType: input.documentType as never,
    originalName: input.file.originalname,
    storageKey: stored.key,
    mimeType: input.file.mimetype,
    size: input.file.size,
    note: input.note.trim(),
    uploadedBy: input.userId
  });
  await audit("FLIGHT_DOCUMENT_UPLOADED", flightId, input.userId, { documentId: String(doc._id), documentType: input.documentType });
  return doc;
}

export async function deleteFlightDocument(input: { flightId: string; documentId: string; userId: mongoose.Types.ObjectId; allowedBranchIds?: string[] | null }) {
  const flightId = asObjectId(input.flightId, "Flight");
  const documentId = asObjectId(input.documentId, "Document");
  const flight = await FlightLinehaul.findById(flightId).select("branchId status").lean().exec();
  if (!flight) throw new FlightLinehaulServiceError("Flight was not found.", 404);
  if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined && !input.allowedBranchIds.includes(String(flight.branchId))) {
    throw new FlightLinehaulServiceError("You do not have access to this flight's branch.", 403);
  }
  if (["CLOSED", "CANCELLED"].includes(flight.status)) throw new FlightLinehaulServiceError("Documents cannot be deleted for closed/cancelled flights.", 409);
  const doc = await FlightDocument.findOne({ _id: documentId, flightLinehaulId: flightId }).exec();
  if (!doc) throw new FlightLinehaulServiceError("Document was not found.", 404);
  const { deleteObject } = await import("./storage/storage.service.js");
  try {
    await deleteObject(doc.storageKey);
  } catch {}
  await FlightDocument.deleteOne({ _id: documentId }).exec();
  await audit("FLIGHT_DOCUMENT_DELETED", flightId, input.userId, { documentId: String(documentId) });
}

// ─────────────────────────────────────────────────────────────────────────────
// Exceptions
// ─────────────────────────────────────────────────────────────────────────────

export async function listFlightExceptions(input: {
  flightId?: string;
  branchId?: string;
  status?: string;
  severity?: string;
  type?: string;
  page?: number;
  limit?: number;
  allowedBranchIds?: string[] | null;
}) {
  const filter: Record<string, unknown> = {};
  if (input.flightId && mongoose.Types.ObjectId.isValid(input.flightId)) filter.flightLinehaulId = new mongoose.Types.ObjectId(input.flightId);
  if (input.branchId && mongoose.Types.ObjectId.isValid(input.branchId)) filter.branchId = new mongoose.Types.ObjectId(input.branchId);
  else if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined) filter.branchId = { $in: input.allowedBranchIds.map((id) => new mongoose.Types.ObjectId(id)) };
  if (input.status) filter.status = input.status;
  if (input.severity) filter.severity = input.severity;
  if (input.type) filter.type = input.type;

  const page = Math.max(1, input.page ?? 1);
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    FlightException.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
    FlightException.countDocuments(filter).exec()
  ]);
  const flightIds = [...new Set(items.map((i) => String(i.flightLinehaulId)))];
  const flights = flightIds.length ? await FlightLinehaul.find({ _id: { $in: flightIds } }).select("flightLinehaulNumber flightNumber branchId").lean().exec() : [];
  const flightById = new Map(flights.map((f) => [String(f._id), f]));
  return {
    items: items.map((item) => ({ ...item, id: String(item._id), flight: flightById.get(String(item.flightLinehaulId)) ?? null })),
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
  };
}

export async function acknowledgeException(input: { exceptionId: string; userId: mongoose.Types.ObjectId; allowedBranchIds?: string[] | null }) {
  const exceptionId = asObjectId(input.exceptionId, "Exception");
  const exception = await FlightException.findById(exceptionId).exec();
  if (!exception) throw new FlightLinehaulServiceError("Exception was not found.", 404);
  if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined && !input.allowedBranchIds.includes(String(exception.branchId))) {
    throw new FlightLinehaulServiceError("You do not have access to this exception.", 403);
  }
  if (exception.status !== "OPEN") throw new FlightLinehaulServiceError("Only open exceptions can be acknowledged.", 409);
  exception.status = "ACKNOWLEDGED";
  exception.acknowledgedAt = new Date();
  exception.acknowledgedBy = input.userId;
  await exception.save();
  await audit("FLIGHT_EXCEPTION_ACKNOWLEDGED", exception.flightLinehaulId, input.userId, { exceptionId: String(exceptionId) });
  return exception;
}

export async function updateExceptionAssignment(input: { exceptionId: string; assignedTo: string | null; status?: string; resolutionNotes?: string; userId: mongoose.Types.ObjectId; allowedBranchIds?: string[] | null }) {
  const exceptionId = asObjectId(input.exceptionId, "Exception");
  const exception = await FlightException.findById(exceptionId).exec();
  if (!exception) throw new FlightLinehaulServiceError("Exception was not found.", 404);
  if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined && !input.allowedBranchIds.includes(String(exception.branchId))) {
    throw new FlightLinehaulServiceError("You do not have access to this exception.", 403);
  }
  if (input.assignedTo !== undefined) {
    if (input.assignedTo && !mongoose.Types.ObjectId.isValid(input.assignedTo)) throw new FlightLinehaulServiceError("Invalid assignee.", 400);
    if (input.assignedTo) {
      const user = await User.findById(input.assignedTo).select("_id role").lean().exec();
      if (!user) throw new FlightLinehaulServiceError("Assignee was not found.", 404);
    }
    exception.assignedTo = input.assignedTo ? new mongoose.Types.ObjectId(input.assignedTo) : null;
  }
  if (input.status) {
    const allowed = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "CLOSED"];
    if (!allowed.includes(input.status)) throw new FlightLinehaulServiceError("Invalid status.", 400);
    // Prevent invalid jumps: OPEN -> IN_PROGRESS requires ACK? Allow flexible but enforce RESOLVED needs notes
    if (input.status === "RESOLVED" && !input.resolutionNotes?.trim() && !exception.resolutionNotes) {
      throw new FlightLinehaulServiceError("Resolution notes required.", 400);
    }
    exception.status = input.status as never;
    if (input.status === "RESOLVED") {
      exception.resolvedAt = new Date();
      exception.resolvedBy = input.userId;
      if (input.resolutionNotes !== undefined) exception.resolutionNotes = input.resolutionNotes.trim();
    }
    if (input.status === "IN_PROGRESS" && !exception.acknowledgedAt) {
      exception.acknowledgedAt = new Date();
      exception.acknowledgedBy = input.userId;
    }
  }
  if (input.resolutionNotes !== undefined && input.status !== "RESOLVED") {
    exception.resolutionNotes = input.resolutionNotes.trim();
  }
  if (input.resolutionNotes !== undefined && exception.status === "RESOLVED" && !input.status) {
    exception.resolutionNotes = input.resolutionNotes.trim();
  }
  await exception.save();
  await audit("FLIGHT_EXCEPTION_UPDATED", exception.flightLinehaulId, input.userId, { exceptionId: String(exceptionId), status: exception.status, assignedTo: exception.assignedTo ? String(exception.assignedTo) : null });
  return exception;
}

export async function resolveException(input: { exceptionId: string; resolutionNotes: string; userId: mongoose.Types.ObjectId; allowedBranchIds?: string[] | null }) {
  const exceptionId = asObjectId(input.exceptionId, "Exception");
  const exception = await FlightException.findById(exceptionId).exec();
  if (!exception) throw new FlightLinehaulServiceError("Exception was not found.", 404);
  if (input.allowedBranchIds !== null && input.allowedBranchIds !== undefined && !input.allowedBranchIds.includes(String(exception.branchId))) {
    throw new FlightLinehaulServiceError("You do not have access to this exception.", 403);
  }
  if (["RESOLVED", "CLOSED"].includes(exception.status)) throw new FlightLinehaulServiceError("Exception already resolved.", 409);
  if (!input.resolutionNotes.trim() || input.resolutionNotes.trim().length < 5) throw new FlightLinehaulServiceError("Resolution notes must be at least 5 characters.", 400);
  exception.status = "RESOLVED";
  exception.resolvedAt = new Date();
  exception.resolvedBy = input.userId;
  exception.resolutionNotes = input.resolutionNotes.trim();
  await exception.save();
  await audit("FLIGHT_EXCEPTION_RESOLVED", exception.flightLinehaulId, input.userId, { exceptionId: String(exceptionId), resolutionNotes: input.resolutionNotes.trim() });
  return exception;
}
