import mongoose from "mongoose";
import { AuditLog } from "../models/auditLog.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { ShipmentCancellation } from "../models/shipmentCancellation.model.js";
import { ShipmentChargeVerification } from "../models/shipmentChargeVerification.model.js";
import { ShipmentEvent } from "../models/shipmentEvent.model.js";
import {
  describeMissingPrerequisites,
  findMissingPrerequisites,
  type ShipmentOperationalStatus
} from "./shipmentStatusSequence.service.js";

export type BulkStatusSkip = {
  shipmentDraftId: string;
  swiftlineTrackingNumber?: string;
  reason: string;
  missingStatuses?: ShipmentOperationalStatus[];
};

export type BulkStatusBlock = {
  reason: string;
  missingStatuses?: ShipmentOperationalStatus[];
} | null;

/**
 * Why a shipment cannot take the requested status, or null when it can.
 *
 * The same gates the single-shipment update enforces- cancellation, hold,
 * sequence prerequisites, and the Warehouse Scan In charge check- held as a
 * pure function so the decision is directly unit-testable. The database is
 * loaded once up front and each row is decided against in-memory data.
 */
export function statusUpdateBlockReason(input: {
  shipmentExists: boolean;
  cancellationStatus?: string;
  onHold: boolean;
  missingPrerequisites: ShipmentOperationalStatus[];
  needsChargeVerification: boolean;
  chargeVerified: boolean;
  status: ShipmentOperationalStatus;
}): BulkStatusBlock {
  if (!input.shipmentExists) {
    return { reason: "Shipment is not booked." };
  }
  if (input.cancellationStatus) {
    return {
      reason: input.cancellationStatus === "COMPLETED"
        ? "Shipment has been cancelled and its progress cannot be updated."
        : "Resolve the pending shipment cancellation before updating shipment progress."
    };
  }
  if (input.onHold) {
    return { reason: "Release the shipment before updating its status." };
  }
  if (input.missingPrerequisites.length) {
    return {
      reason: describeMissingPrerequisites(input.status, input.missingPrerequisites),
      missingStatuses: input.missingPrerequisites
    };
  }
  if (input.needsChargeVerification && !input.chargeVerified) {
    return { reason: "Verify the final shipment weight and charge before Warehouse Scan In." };
  }
  return null;
}

/**
 * Records one operational status across many shipments at once.
 *
 * Each shipment is held to the same rule as the single-shipment update, so a
 * batch can never write a jump the detail page would reject. Shipments that
 * cannot take the status yet are skipped and reported, letting the eligible
 * ones move on while Operations fixes the rest- the common same-day, same-
 * flight case updates together and stragglers are named in the response.
 */
export async function bulkRecordOperationalStatus(input: {
  shipmentDraftIds: string[];
  status: ShipmentOperationalStatus;
  note?: string;
  location?: string;
  userId: mongoose.Types.ObjectId;
}): Promise<{ updatedCount: number; skipped: BulkStatusSkip[] }> {
  const uniqueIds = [...new Set(input.shipmentDraftIds)];
  const draftObjectIds = uniqueIds.map((id) => new mongoose.Types.ObjectId(id));

  const shipments = await DpdShipment.find({ shipmentDraftId: { $in: draftObjectIds } }).lean().exec();
  const shipmentByDraft = new Map(shipments.map((shipment) => [String(shipment.shipmentDraftId), shipment]));

  const [cancellations, chargeVerifiedShipmentIds, events] = await Promise.all([
    ShipmentCancellation.find({
      shipmentDraftId: { $in: draftObjectIds },
      status: { $in: ["REQUESTED", "COMPLETED"] }
    })
      .select("shipmentDraftId status")
      .lean()
      .exec(),
    ShipmentChargeVerification.distinct("dpdShipmentId", {
      dpdShipmentId: { $in: shipments.map((shipment) => shipment._id) }
    }).exec(),
    ShipmentEvent.find({ shipmentDraftId: { $in: draftObjectIds } })
      .sort({ eventAt: -1, createdAt: -1 })
      .select("shipmentDraftId status")
      .lean()
      .exec()
  ]);

  const cancellationByDraft = new Map<string, string>(
    cancellations.map((cancellation) => [String(cancellation.shipmentDraftId), cancellation.status])
  );
  const chargeVerifiedSet = new Set(chargeVerifiedShipmentIds.map(String));

  // The event list is newest-first, so the first row per draft is its latest
  // status and the distinct set is its recorded history- both in one query.
  const latestStatusByDraft = new Map<string, string>();
  const recordedByDraft = new Map<string, Set<string>>();
  for (const event of events) {
    const draftId = String(event.shipmentDraftId);
    if (!latestStatusByDraft.has(draftId)) latestStatusByDraft.set(draftId, event.status);
    const recorded = recordedByDraft.get(draftId) ?? new Set<string>();
    recorded.add(event.status);
    recordedByDraft.set(draftId, recorded);
  }

  const note = input.note || "Live action updated by Swiftline Operations";
  let updatedCount = 0;
  const skipped: BulkStatusSkip[] = [];

  for (const draftId of uniqueIds) {
    const shipment = shipmentByDraft.get(draftId);
    if (!shipment) {
      skipped.push({ shipmentDraftId: draftId, reason: "Shipment is not booked." });
      continue;
    }

    const block = statusUpdateBlockReason({
      shipmentExists: true,
      cancellationStatus: cancellationByDraft.get(draftId),
      onHold: latestStatusByDraft.get(draftId) === "ON_HOLD",
      missingPrerequisites: findMissingPrerequisites(input.status, recordedByDraft.get(draftId) ?? []),
      needsChargeVerification: input.status === "WAREHOUSE_SCAN_IN",
      chargeVerified: chargeVerifiedSet.has(String(shipment._id)),
      status: input.status
    });

    if (block) {
      skipped.push({
        shipmentDraftId: draftId,
        swiftlineTrackingNumber: shipment.swiftlineTrackingNumber,
        reason: block.reason,
        missingStatuses: block.missingStatuses
      });
      continue;
    }

    await ShipmentEvent.create({
      shipmentDraftId: shipment.shipmentDraftId,
      dpdShipmentId: shipment._id,
      status: input.status,
      note,
      location: input.location ?? "",
      customerVisible: true,
      createdBy: input.userId,
      eventAt: new Date()
    });

    await AuditLog.create({
      action: "SHIPMENT_STATUS_UPDATED",
      entityType: "DPD_SHIPMENT",
      entityId: shipment._id,
      performedBy: input.userId,
      performedAt: new Date(),
      metadata: {
        shipmentDraftId: draftId,
        status: input.status,
        note,
        source: "BULK"
      }
    });

    updatedCount += 1;
  }

  return { updatedCount, skipped };
}