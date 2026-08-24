// Repairs one reviewed production batch whose legacy timelines skipped the
// origin-processing milestone. This is not a general sequence migration.
//
// Dry-run by default. Pass --apply to write, and use --awb=<number> for the
// recommended one-shipment pilot before applying the complete allowlist.
import mongoose from "mongoose";
import { connectDatabase } from "../config/database.js";
import { AuditLog } from "../models/auditLog.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { ShipmentEvent, shipmentMilestoneKey } from "../models/shipmentEvent.model.js";
import { defaultShipmentEventNote } from "../services/shipmentEventCopy.service.js";
import {
  assessLegacyOriginProcessedBackfill,
  isLegacyOriginProcessedAwb,
  LEGACY_ORIGIN_PROCESSED_AWBS,
  LEGACY_ORIGIN_PROCESSED_MIGRATION_ID,
  type LegacyOriginProcessedAssessment,
  type LegacyOriginProcessedEvidenceEvent
} from "../services/legacyOriginProcessedBackfill.service.js";
import { SYSTEM_ACTOR_ID } from "../utils/systemActor.js";

const apply = process.argv.includes("--apply");

function readArgument(name: string): string {
  const prefix = `${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim();
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] ?? "").trim() : "";
}

const requestedAwb = readArgument("--awb").toUpperCase();

type ShipmentRow = {
  _id: mongoose.Types.ObjectId;
  shipmentDraftId: mongoose.Types.ObjectId;
  swiftlineTrackingNumber?: string;
};

type EventRow = {
  _id: mongoose.Types.ObjectId;
  shipmentDraftId: mongoose.Types.ObjectId;
  status: string;
  milestoneKey?: string;
  eventAt: Date;
};

type ShipmentAssessment = {
  awb: string;
  shipment: ShipmentRow;
  assessment: LegacyOriginProcessedAssessment;
};

function asEvidence(event: EventRow): LegacyOriginProcessedEvidenceEvent {
  return {
    id: String(event._id),
    status: event.status,
    milestoneKey: event.milestoneKey,
    eventAt: event.eventAt
  };
}

function assessmentReason(assessment: LegacyOriginProcessedAssessment): string {
  switch (assessment.outcome) {
    case "ELIGIBLE": return "eligible";
    case "NOT_ALLOWLISTED": return "AWB is outside the reviewed production batch";
    case "ALREADY_PRESENT": return "origin-processing milestone already exists";
    case "MISSING_WAREHOUSE_SCAN": return "warehouse receipt evidence is missing or occurs after export evidence";
    case "MISSING_DESTINATION_ARRIVAL": return "destination arrival evidence is missing";
    case "MISSING_LATER_EVIDENCE": return "no later journey milestone proves origin processing occurred";
    case "INVALID_EVENT_DATES": return "one or more event dates are invalid";
    case "NO_TIMESTAMP_GAP": return "real events do not leave a safe timestamp interval";
  }
}

function printAssessment(item: ShipmentAssessment) {
  if (item.assessment.outcome !== "ELIGIBLE") {
    console.log(`${item.assessment.outcome.padEnd(27)} ${item.awb}  ${assessmentReason(item.assessment)}`);
    return;
  }
  console.log(
    `${item.assessment.outcome.padEnd(27)} ${item.awb}  `
    + `${item.assessment.lower.status} ${new Date(item.assessment.lower.eventAt).toISOString()}  ->  `
    + `${item.assessment.eventAt.toISOString()}  ->  `
    + `${item.assessment.upper.status} ${new Date(item.assessment.upper.eventAt).toISOString()}`
  );
}

async function backfillLegacyOriginProcessed() {
  if (requestedAwb && !isLegacyOriginProcessedAwb(requestedAwb)) {
    throw new Error(`${requestedAwb} is not in the reviewed 70-shipment allowlist.`);
  }

  const targetAwbs = requestedAwb ? [requestedAwb] : [...LEGACY_ORIGIN_PROCESSED_AWBS];

  // Audit mode must be genuinely read-only; index creation is not part of this
  // migration and the two required unique indexes already exist in production.
  mongoose.set("autoIndex", false);
  await connectDatabase();
  try {
    const shipments = await DpdShipment.find({ swiftlineTrackingNumber: { $in: targetAwbs } })
      .select("shipmentDraftId swiftlineTrackingNumber")
      .lean<ShipmentRow[]>()
      .exec();
    const shipmentsByAwb = new Map<string, ShipmentRow[]>();
    for (const shipment of shipments) {
      const awb = String(shipment.swiftlineTrackingNumber ?? "").toUpperCase();
      shipmentsByAwb.set(awb, [...(shipmentsByAwb.get(awb) ?? []), shipment]);
    }

    const uniqueShipments = targetAwbs
      .map((awb) => ({ awb, rows: shipmentsByAwb.get(awb) ?? [] }))
      .filter((item) => item.rows.length === 1)
      .map((item) => ({ awb: item.awb, shipment: item.rows[0] as ShipmentRow }));
    const draftIds = uniqueShipments.map((item) => item.shipment.shipmentDraftId);
    const events = draftIds.length
      ? await ShipmentEvent.find({ shipmentDraftId: { $in: draftIds } })
          .select("shipmentDraftId status milestoneKey eventAt")
          .lean<EventRow[]>()
          .exec()
      : [];
    const eventsByDraft = new Map<string, EventRow[]>();
    for (const event of events) {
      const draftId = String(event.shipmentDraftId);
      eventsByDraft.set(draftId, [...(eventsByDraft.get(draftId) ?? []), event]);
    }

    const assessments: ShipmentAssessment[] = uniqueShipments.map(({ awb, shipment }) => ({
      awb,
      shipment,
      assessment: assessLegacyOriginProcessedBackfill(
        awb,
        (eventsByDraft.get(String(shipment.shipmentDraftId)) ?? []).map(asEvidence)
      )
    }));
    const missingAwbs = targetAwbs.filter((awb) => !shipmentsByAwb.has(awb));
    const duplicateAwbs = targetAwbs.filter((awb) => (shipmentsByAwb.get(awb) ?? []).length > 1);
    const eligible = assessments.filter((item) => item.assessment.outcome === "ELIGIBLE");
    const alreadyPresent = assessments.filter((item) => item.assessment.outcome === "ALREADY_PRESENT");
    const needsReview = assessments.filter((item) => !["ELIGIBLE", "ALREADY_PRESENT"].includes(item.assessment.outcome));

    console.log("Legacy origin-processing backfill.", {
      migrationId: LEGACY_ORIGIN_PROCESSED_MIGRATION_ID,
      requested: targetAwbs.length,
      shipmentRecordsFound: shipments.length,
      eligible: eligible.length,
      alreadyPresent: alreadyPresent.length,
      missingShipments: missingAwbs.length,
      duplicateShipmentRecords: duplicateAwbs.length,
      needsReview: needsReview.length,
      applied: apply,
      pilotAwb: requestedAwb || null
    });
    for (const item of assessments) printAssessment(item);
    for (const awb of missingAwbs) console.log(`MISSING_SHIPMENT            ${awb}  booked shipment was not found`);
    for (const awb of duplicateAwbs) console.log(`DUPLICATE_SHIPMENT_RECORDS  ${awb}  more than one booked shipment uses this AWB`);

    if (!apply) {
      console.log("Dry run only. Review every result, then re-run with --apply to write eligible events.");
      return;
    }

    if (missingAwbs.length || duplicateAwbs.length || needsReview.length) {
      throw new Error("No events were written because the reviewed scope contains unresolved records.");
    }
    if (!eligible.length) {
      console.log("Nothing to apply; every targeted shipment already contains the milestone.");
      return;
    }

    // `withTransaction` may retry its callback after a transient Atlas error.
    // Keying the report by AWB prevents an aborted attempt from appearing as a
    // second committed insert in the deployment output.
    const insertedByAwb = new Map<string, { awb: string; eventId: string; eventAt: Date }>();
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const item of eligible) {
          const currentRows = await ShipmentEvent.find({ shipmentDraftId: item.shipment.shipmentDraftId })
            .select("shipmentDraftId status milestoneKey eventAt")
            .session(session)
            .lean<EventRow[]>()
            .exec();
          const current = assessLegacyOriginProcessedBackfill(item.awb, currentRows.map(asEvidence));
          if (current.outcome === "ALREADY_PRESENT") continue;
          if (current.outcome !== "ELIGIBLE") {
            throw new Error(`${item.awb} changed after the audit: ${assessmentReason(current)}.`);
          }

          const [event] = await ShipmentEvent.create([{
            shipmentDraftId: item.shipment.shipmentDraftId,
            dpdShipmentId: item.shipment._id,
            status: "ORIGIN_HUB_PROCESSED",
            milestoneKey: shipmentMilestoneKey("ORIGIN_HUB_PROCESSED"),
            note: defaultShipmentEventNote("ORIGIN_HUB_PROCESSED"),
            location: "",
            source: "SYSTEM",
            sourceReference: LEGACY_ORIGIN_PROCESSED_MIGRATION_ID,
            customerVisible: true,
            createdBy: SYSTEM_ACTOR_ID,
            eventAt: current.eventAt
          }], { session });
          if (!event) throw new Error(`Failed to create the inferred event for ${item.awb}.`);

          await AuditLog.create([{
            action: "SHIPMENT_STATUS_UPDATED",
            entityType: "DPD_SHIPMENT",
            entityId: item.shipment._id,
            performedBy: SYSTEM_ACTOR_ID,
            performedAt: new Date(),
            metadata: {
              shipmentDraftId: item.shipment.shipmentDraftId,
              shipmentEventId: event._id,
              swiftlineTrackingNumber: item.awb,
              status: "ORIGIN_HUB_PROCESSED",
              source: "SYSTEM_BACKFILL",
              migrationId: LEGACY_ORIGIN_PROCESSED_MIGRATION_ID,
              inferredHistoricalMilestone: true,
              timestampMethod: "MIDPOINT_BETWEEN_CONFIRMED_EVENTS",
              lowerEvidenceEventId: current.lower.id,
              lowerEvidenceStatus: current.lower.status,
              lowerEvidenceAt: new Date(current.lower.eventAt),
              upperEvidenceEventId: current.upper.id,
              upperEvidenceStatus: current.upper.status,
              upperEvidenceAt: new Date(current.upper.eventAt),
              inferredEventAt: current.eventAt
            }
          }], { session });

          insertedByAwb.set(item.awb, {
            awb: item.awb,
            eventId: String(event._id),
            eventAt: current.eventAt
          });
        }
      });
    } finally {
      await session.endSession();
    }

    const inserted = [...insertedByAwb.values()];
    console.log(`Applied ${inserted.length} historical origin-processing event(s).`);
    for (const item of inserted) {
      console.log(`inserted  ${item.awb}  ${item.eventId}  ${item.eventAt.toISOString()}`);
    }
    console.log(`Rollback selector: source=SYSTEM, sourceReference=${LEGACY_ORIGIN_PROCESSED_MIGRATION_ID}`);
  } finally {
    await mongoose.disconnect();
  }
}

backfillLegacyOriginProcessed().catch((error) => {
  console.error("Legacy origin-processing backfill failed.", error);
  process.exitCode = 1;
});
