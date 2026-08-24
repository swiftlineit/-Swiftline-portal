import mongoose from "mongoose";
import { AuditLog } from "../models/auditLog.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentCancellation } from "../models/shipmentCancellation.model.js";
import { ShipmentEvent, shipmentMilestoneKey } from "../models/shipmentEvent.model.js";
import { resolveShipmentEventNote } from "./shipmentEventCopy.service.js";
import { chargeFinalizingStatuses, markShipmentChargeFinalized } from "./shipmentInvoice.service.js";
import {
  describeEventDateProblem,
  describeAlreadyRecorded,
  describeMissingPrerequisites,
  equivalentMilestoneStatuses,
  findMissingPrerequisites,
  formatShipmentEventLabel,
  type ShipmentOperationalStatus
} from "./shipmentStatusSequence.service.js";
import { resolveBulkTrackingGatewayCode } from "./shipmentGateway.service.js";

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
 * The batch was refused before anything was written.
 *
 * Distinct from a per-shipment skip: a skip means the rest of the batch went
 * through, this means none of it did and the operator has to change what they
 * selected.
 */
export class BulkStatusSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BulkStatusSelectionError";
  }
}

/**
 * The stage a shipment with no events yet is standing at.
 *
 * Deliberately the same fallback the shipments list uses for its status column,
 * so what the operator reads in the table is what the batch is judged against.
 */
export const NOT_YET_SCANNED = "SHIPMENT_BOOKED";

/**
 * Why this selection cannot be updated as one batch, or null when it can.
 *
 * A batch records one status across many shipments, which only means something
 * if they are all standing at the same point. Mixing stages produces two
 * different outcomes from one click: a booked parcel advances to Parcel
 * Collected, while one already collected gets a second, identical row on the
 * customer's tracker for a scan that never happened twice.
 *
 * The same reasoning rules out a batch whose target is the stage every shipment
 * is already at- there is nothing to advance, only duplicates to write.
 *
 * Refused whole rather than partly applied. A half-written batch leaves the
 * operator guessing which shipments moved.
 */
export function bulkSelectionBlockReason(
  currentStatuses: readonly string[],
  target: ShipmentOperationalStatus
): string | null {
  const distinct = [...new Set(currentStatuses)];

  if (distinct.length > 1) {
    const labels = distinct.map(formatShipmentEventLabel).sort();
    return "A bulk update covers shipments that are all at the same stage. "
      + `This selection mixes ${labels.join(", ")}. `
      + "Narrow it to shipments that share one current status and update each group separately.";
  }

  if (distinct.length === 1 && distinct[0] === target) {
    return `Every selected shipment is already at ${formatShipmentEventLabel(target)}. `
      + "Choose the stage they should move to next.";
  }

  return null;
}

/**
 * Why a shipment cannot take the requested status, or null when it can.
 *
 * The same gates the single-shipment update enforces- cancellation, hold and
 * sequence prerequisites- held as a pure function so the decision is directly
 * unit-testable. The database is loaded once up front and each row is decided
 * against in-memory data.
 */
export function statusUpdateBlockReason(input: {
  shipmentExists: boolean;
  cancellationStatus?: string;
  onHold: boolean;
  alreadyRecordedAt?: Date | null;
  missingPrerequisites: ShipmentOperationalStatus[];
  /**
   * Why the stated status date will not do for this shipment, or null.
   *
   * Per shipment rather than per batch: one date is applied across the
   * selection, and each shipment's own history decides whether it can take it.
   */
  eventDateProblem?: string | null;
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
  if (input.alreadyRecordedAt) {
    return { reason: describeAlreadyRecorded(input.status, input.alreadyRecordedAt) };
  }
  if (input.missingPrerequisites.length) {
    return {
      reason: describeMissingPrerequisites(input.status, input.missingPrerequisites),
      missingStatuses: input.missingPrerequisites
    };
  }
  if (input.eventDateProblem) {
    return { reason: input.eventDateProblem };
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
  /** When the scan happened. Omitted, each event is stamped with the time it is written. */
  eventAt?: Date;
  gatewayCode?: string;
  partnerName?: string;
  partnerCode?: string;
  userId: mongoose.Types.ObjectId;
}): Promise<{ updatedCount: number; skipped: BulkStatusSkip[] }> {
  const uniqueIds = [...new Set(input.shipmentDraftIds)];
  const draftObjectIds = uniqueIds.map((id) => new mongoose.Types.ObjectId(id));

  const shipments = await DpdShipment.find({ shipmentDraftId: { $in: draftObjectIds } }).lean().exec();
  const shipmentByDraft = new Map(shipments.map((shipment) => [String(shipment.shipmentDraftId), shipment]));

  const [drafts, cancellations, events] = await Promise.all([
    ShipmentDraft.find({ _id: { $in: draftObjectIds } })
      .select("consigneeEnteredAddress.countryCode")
      .lean()
      .exec(),
    ShipmentCancellation.find({
      shipmentDraftId: { $in: draftObjectIds },
      status: { $in: ["REQUESTED", "COMPLETED"] }
    })
      .select("shipmentDraftId status")
      .lean()
      .exec(),
    ShipmentEvent.find({ shipmentDraftId: { $in: draftObjectIds } })
      .sort({ eventAt: -1, createdAt: -1 })
      .select("shipmentDraftId status eventAt")
      .lean()
      .exec()
  ]);

  const cancellationByDraft = new Map<string, string>(
    cancellations.map((cancellation) => [String(cancellation.shipmentDraftId), cancellation.status])
  );
  const destinationCountryByDraft = new Map(
    drafts.map((draft) => [String(draft._id), draft.consigneeEnteredAddress?.countryCode ?? ""])
  );

  // The event list is newest-first, so the first row per draft is its latest
  // status and the distinct set is its recorded history- both in one query.
  const latestStatusByDraft = new Map<string, string>();
  const latestEventAtByDraft = new Map<string, Date>();
  const recordedByDraft = new Map<string, Set<string>>();
  const targetEventAtByDraft = new Map<string, Date>();
  const targetStatuses = new Set(equivalentMilestoneStatuses(input.status));
  for (const event of events) {
    const draftId = String(event.shipmentDraftId);
    if (!latestStatusByDraft.has(draftId)) {
      latestStatusByDraft.set(draftId, event.status);
      latestEventAtByDraft.set(draftId, event.eventAt);
    }
    const recorded = recordedByDraft.get(draftId) ?? new Set<string>();
    recorded.add(event.status);
    recordedByDraft.set(draftId, recorded);
    if (targetStatuses.has(event.status) && !targetEventAtByDraft.has(draftId)) {
      targetEventAtByDraft.set(draftId, event.eventAt);
    }
  }

  // Judged only over shipments that are actually booked. An unbooked row stays
  // a reported skip, exactly as before, rather than failing the whole batch.
  const selectionBlock = bulkSelectionBlockReason(
    uniqueIds
      .filter((draftId) => shipmentByDraft.has(draftId))
      .map((draftId) => latestStatusByDraft.get(draftId) ?? NOT_YET_SCANNED),
    input.status
  );
  if (selectionBlock) throw new BulkStatusSelectionError(selectionBlock);

  const gateway = resolveBulkTrackingGatewayCode({
    status: input.status,
    destinationCountryCodes: uniqueIds
      .filter((draftId) => shipmentByDraft.has(draftId))
      .map((draftId) => destinationCountryByDraft.get(draftId) ?? ""),
    gatewayCode: input.gatewayCode
  });
  if (gateway.error) throw new BulkStatusSelectionError(gateway.error);

  const note = resolveShipmentEventNote(input.note, input.status);
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
      alreadyRecordedAt: targetEventAtByDraft.get(draftId),
      missingPrerequisites: findMissingPrerequisites(input.status, recordedByDraft.get(draftId) ?? []),
      eventDateProblem: input.eventAt
        ? describeEventDateProblem({
          eventAt: input.eventAt,
          previousEventAt: latestEventAtByDraft.get(draftId) ?? null
        })
        : null,
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

    let event;
    try {
      event = await ShipmentEvent.create({
        shipmentDraftId: shipment.shipmentDraftId,
        dpdShipmentId: shipment._id,
        status: input.status,
        milestoneKey: shipmentMilestoneKey(input.status),
        note,
        location: input.location ?? "",
        source: "MANUAL",
        gatewayCode: gateway.gatewayCode,
        partnerName: input.partnerName ?? "",
        partnerCode: input.partnerCode ?? "",
        customerVisible: true,
        createdBy: input.userId,
        // One stated date across the batch- the same-day, same-flight scan they
        // are all recording. Omitted, each row is stamped as it is written.
        eventAt: input.eventAt ?? new Date()
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === 11000) {
        skipped.push({
          shipmentDraftId: draftId,
          swiftlineTrackingNumber: shipment.swiftlineTrackingNumber,
          reason: describeAlreadyRecorded(input.status)
        });
        continue;
      }
      throw error;
    }

    // Collection settles the charge, exactly as it does on the single-shipment
    // update- see chargeFinalizingStatuses.
    if ((chargeFinalizingStatuses as readonly string[]).includes(input.status)) {
      await markShipmentChargeFinalized({
        shipmentDraftId: shipment.shipmentDraftId,
        finalizedAt: event.eventAt
      });
    }

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
        gatewayCode: gateway.gatewayCode,
        // performedAt above stays the real moment; together the two show a
        // backdated batch for what it is.
        eventAt: event.eventAt,
        source: "BULK"
      }
    });

    updatedCount += 1;
  }

  return { updatedCount, skipped };
}
