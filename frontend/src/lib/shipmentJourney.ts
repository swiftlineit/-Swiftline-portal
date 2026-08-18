/**
 * What a shipment's journey means, with no opinion about how it looks.
 *
 * The portal tracker and the public tracker draw the journey rail completely
 * differently, and each is free to keep doing so. What they must never disagree
 * on is which stages exist, which statuses count as reaching one, and which
 * stage a shipment is standing at - a rail that claims a stage the event history
 * does not have is wrong on any design.
 *
 * So the shared thing is this file: pure data and no JSX. Each side renders the
 * result however it likes, and neither can drift on the meaning.
 */

/** Delivery schedule state, as the backend computes it. */
export type DeliveryEstimate = {
  estimatedDeliveryAt: string;
  earliestDeliveryAt: string;
  transitDaysMin: number;
  transitDaysMax: number;
  transitBasis: "BUSINESS_DAYS" | "CALENDAR_DAYS";
  state: "ON_SCHEDULE" | "POTENTIAL_DELAY" | "DELAYED" | "DELIVERED" | "ON_HOLD";
  deliveredAt: string | null;
};

/** The published journey, in the order a shipment travels it. */
export const journeyStages: ReadonlyArray<{ label: string; statuses: readonly string[] }> = [
  { label: "Booked", statuses: ["SHIPMENT_BOOKED", "SHIPMENT_CREATED"] },
  { label: "Pickup Completed", statuses: ["PARCEL_COLLECTED"] },
  { label: "Origin Hub", statuses: ["WAREHOUSE_SCAN_IN"] },
  { label: "Exported", statuses: ["EXPORT_CUSTOMS_CLEARED", "FLIGHT_ASSIGNED", "FLIGHT_DEPARTED"] },
  { label: "Destination Hub", statuses: ["DESTINATION_ARRIVED"] },
  { label: "Customs Clearance", statuses: ["IMPORT_CUSTOMS_CLEARANCE"] },
  { label: "Out for Delivery", statuses: ["OUT_FOR_DELIVERY"] },
  { label: "Delivered", statuses: ["DELIVERED"] }
];

export type JourneyEvent = { status: string; eventAt: string };

export type ResolvedJourneyStage = {
  label: string;
  /** When the stage was first reached, or null if it has not been. */
  reachedAt: string | null;
  /** The furthest stage reached - the one a rail should highlight. */
  isCurrent: boolean;
};

/**
 * The journey a set of events describes.
 *
 * A stage counts as reached when any of its statuses has been recorded, so a
 * shipment that skipped a scan still shows the progress it genuinely made rather
 * than stalling at the missing step. That tolerance matters for shipments booked
 * before progress was recorded in order, and for the driver paths that can still
 * post a later scan without an earlier one.
 */
export function resolveJourneyStages(events: readonly JourneyEvent[]): ResolvedJourneyStage[] {
  const reachedAt = new Map<string, string>();

  for (const event of events) {
    const stage = journeyStages.find((entry) => entry.statuses.includes(event.status));
    if (!stage) continue;

    // The earliest event wins: a stage was reached when it was first reached,
    // not when it was last touched.
    const existing = reachedAt.get(stage.label);
    if (!existing || new Date(event.eventAt) < new Date(existing)) {
      reachedAt.set(stage.label, event.eventAt);
    }
  }

  const lastReachedIndex = journeyStages.reduce(
    (last, stage, index) => (reachedAt.has(stage.label) ? index : last),
    -1
  );

  return journeyStages.map((stage, index) => ({
    label: stage.label,
    reachedAt: reachedAt.get(stage.label) ?? null,
    isCurrent: index === lastReachedIndex
  }));
}

/** Turns WAREHOUSE_SCAN_IN into "Warehouse Scan In". */
export function labelStatus(value: string) {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
