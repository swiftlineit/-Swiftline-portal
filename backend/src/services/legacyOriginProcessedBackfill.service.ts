import { shipmentMilestoneKey } from "../models/shipmentEvent.model.js";

export const LEGACY_ORIGIN_PROCESSED_MIGRATION_ID = "LEGACY_ORIGIN_PROCESSED_V1";

/**
 * The exact production batch Operations could not advance on 24 August 2026.
 *
 * This allowlist is intentionally data, not a query. A later shipment with the
 * same historical shape must not be silently changed by a migration written
 * for this reviewed batch.
 */
export const LEGACY_ORIGIN_PROCESSED_AWBS = [
  "SLCDEL170826004",
  "SLCDEL170826005",
  "SLCDEL170826006",
  "SLCDEL170826009",
  "SLCDEL180826001",
  "SLCDEL180826002",
  "SLCDEL180826004",
  "SLCDEL180826005",
  "SLCDEL180826006",
  "SLCDEL180826007",
  "SLCDEL180826008",
  "SLCDEL180826009",
  "SLCDEL180826010",
  "SLCDEL180826011",
  "SLCDEL180826012",
  "SLCDEL180826013",
  "SLCDEL180826015",
  "SLCDEL180826016",
  "SLCDEL180826017",
  "SLCDEL180826018",
  "SLCDEL180826019",
  "SLCDEL180826020",
  "SLCDEL190826001",
  "SLCDEL190826002",
  "SLCDEL190826003",
  "SLCDEL190826004",
  "SLCDEL190826005",
  "SLCDEL190826006",
  "SLCDEL190826007",
  "SLCDEL190826008",
  "SLCDEL190826009",
  "SLCDEL190826012",
  "SLCDEL190826013",
  "SLCDEL190826014",
  "SLCDEL190826015",
  "SLCDEL190826016",
  "SLCDEL190826017",
  "SLCDEL190826018",
  "SLCDEL190826019",
  "SLCDEL190826020",
  "SLCDEL190826021",
  "SLCDEL190826022",
  "SLCDEL190826023",
  "SLCDEL190826024",
  "SLCDEL190826025",
  "SLCDEL190826026",
  "SLCDEL190826027",
  "SLCDEL190826028",
  "SLCDEL190826029",
  "SLCDEL190826030",
  "SLCDEL190826031",
  "SLCDEL190826032",
  "SLCDEL200826001",
  "SLCDEL200826002",
  "SLCDEL200826003",
  "SLCDEL200826004",
  "SLCDEL200826005",
  "SLCDEL200826006",
  "SLCDEL200826007",
  "SLCDEL200826008",
  "SLCDEL200826009",
  "SLCDEL200826010",
  "SLCDEL200826011",
  "SLCDEL200826012",
  "SLCDEL200826013",
  "SLCDEL200826014",
  "SLCDEL200826015",
  "SLCDEL200826016",
  "SLCDEL200826017",
  "SLCDEL200826018"
] as const;

const approvedAwbs = new Set<string>(LEGACY_ORIGIN_PROCESSED_AWBS);

const downstreamEvidenceStatuses = new Set([
  "READY_FOR_EXPORT",
  "EXPORT_CUSTOMS_CLEARED",
  "FLIGHT_ASSIGNED",
  "ORIGIN_HUB_DISPATCHED",
  "FLIGHT_DEPARTED",
  "DESTINATION_ARRIVED",
  "IMPORT_CUSTOMS_CLEARANCE",
  "IMPORT_CUSTOMS_CLEARED",
  "DELIVERY_PARTNER_TRANSFERRED",
  "DELIVERY_HUB_ARRIVED",
  "OUT_FOR_DELIVERY",
  "DELIVERED"
]);

export type LegacyOriginProcessedEvidenceEvent = {
  id: string;
  status: string;
  milestoneKey?: string | null;
  eventAt: Date | string;
};

export type LegacyOriginProcessedAssessment =
  | { outcome: "ELIGIBLE"; lower: LegacyOriginProcessedEvidenceEvent; upper: LegacyOriginProcessedEvidenceEvent; eventAt: Date }
  | { outcome: "NOT_ALLOWLISTED" }
  | { outcome: "ALREADY_PRESENT" }
  | { outcome: "MISSING_WAREHOUSE_SCAN" }
  | { outcome: "MISSING_DESTINATION_ARRIVAL" }
  | { outcome: "MISSING_LATER_EVIDENCE" }
  | { outcome: "INVALID_EVENT_DATES" }
  | { outcome: "NO_TIMESTAMP_GAP" };

function eventTime(event: LegacyOriginProcessedEvidenceEvent) {
  return new Date(event.eventAt).getTime();
}

export function isLegacyOriginProcessedAwb(awb: string): boolean {
  return approvedAwbs.has(awb.trim().toUpperCase());
}

/**
 * Decides whether one reviewed shipment can receive the historical milestone.
 *
 * Destination arrival is required as strong evidence that this is one of the
 * already-moving legacy shipments, not a new booking whose operator is trying
 * to bypass the normal sequence. The derived timestamp is the midpoint of the
 * two real events that bound it and is recorded as inferred in AuditLog.
 */
export function assessLegacyOriginProcessedBackfill(
  awb: string,
  events: readonly LegacyOriginProcessedEvidenceEvent[]
): LegacyOriginProcessedAssessment {
  if (!isLegacyOriginProcessedAwb(awb)) return { outcome: "NOT_ALLOWLISTED" };

  if (events.some((event) => (
    event.status === "ORIGIN_HUB_PROCESSED"
      || event.milestoneKey === shipmentMilestoneKey("ORIGIN_HUB_PROCESSED")
  ))) {
    return { outcome: "ALREADY_PRESENT" };
  }

  const dated = events
    .map((event) => ({ event, time: eventTime(event) }))
    .filter((item) => Number.isFinite(item.time))
    .sort((left, right) => left.time - right.time);
  if (dated.length !== events.length) return { outcome: "INVALID_EVENT_DATES" };

  const destinationArrival = dated.find((item) => item.event.status === "DESTINATION_ARRIVED");
  if (!destinationArrival) return { outcome: "MISSING_DESTINATION_ARRIVAL" };

  const upper = dated.find((item) => downstreamEvidenceStatuses.has(item.event.status));
  if (!upper) return { outcome: "MISSING_LATER_EVIDENCE" };

  const warehouseScans = dated.filter((item) => (
    item.event.status === "WAREHOUSE_SCAN_IN" && item.time < upper.time
  ));
  const lower = warehouseScans[warehouseScans.length - 1];
  if (!lower) return { outcome: "MISSING_WAREHOUSE_SCAN" };
  if (destinationArrival.time <= lower.time) return { outcome: "NO_TIMESTAMP_GAP" };

  const difference = upper.time - lower.time;
  if (difference <= 1) return { outcome: "NO_TIMESTAMP_GAP" };

  const derivedTime = lower.time + Math.floor(difference / 2);
  if (derivedTime <= lower.time || derivedTime >= upper.time) return { outcome: "NO_TIMESTAMP_GAP" };

  return {
    outcome: "ELIGIBLE",
    lower: lower.event,
    upper: upper.event,
    eventAt: new Date(derivedTime)
  };
}
