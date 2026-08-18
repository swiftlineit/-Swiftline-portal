/**
 * The order a shipment travels its operational ladder, and what is missing.
 *
 * Operations used to be able to record any operational status at any time, so a
 * shipment sitting at SHIPMENT_BOOKED could jump straight to FLIGHT_ASSIGNED and
 * leave the three steps between it never recorded. The journey rail then drew
 * those stages as pending while the shipment showed as in flight, and the
 * customer saw a history that skipped steps their parcel had actually been
 * through.
 *
 * The rule enforced here is that a ladder status may only be recorded once every
 * ladder step before it exists on that shipment.
 *
 * Deliberately not "only the immediate next step". Shipments booked before this
 * rule existed can already carry gaps, and a next-only rule would strand them a
 * step behind forever with no way to fill one in. Under this rule they unstick
 * themselves by recording the missed steps- each of which has all of *its* own
 * prerequisites- and no new shipment can develop a gap in the first place.
 */
import {
  shipmentOperationalStatusValues,
  type ShipmentEventStatus
} from "../models/shipmentEvent.model.js";

export type ShipmentOperationalStatus = (typeof shipmentOperationalStatusValues)[number];

export function isOperationalStatus(value: string): value is ShipmentOperationalStatus {
  return (shipmentOperationalStatusValues as readonly string[]).includes(value);
}

/**
 * Turns SHIPMENT_BOOKED into "Shipment Booked".
 *
 * Lives here rather than beside its callers because the sequence message, the
 * client event serialiser and the public tracking payload all need the same
 * label, and three copies would be free to drift.
 */
export function formatShipmentEventLabel(value?: string | null): string {
  if (!value) return "Shipment Created";
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * The ladder steps before `target` that this shipment has not recorded yet, in
 * the order it should record them.
 *
 * An empty array means the update is allowed. Statuses off the ladder- holds,
 * releases, cancellations, the booking event itself- return empty too: they can
 * legitimately happen at any point, so the rule has nothing to say about them.
 */
export function findMissingPrerequisites(
  target: string,
  recorded: Iterable<ShipmentEventStatus | string>
): ShipmentOperationalStatus[] {
  if (!isOperationalStatus(target)) return [];

  const already = new Set(recorded);

  return shipmentOperationalStatusValues
    .slice(0, shipmentOperationalStatusValues.indexOf(target))
    .filter((status) => !already.has(status));
}

/**
 * The statuses this shipment may record right now.
 *
 * Used by the staff form to grey out the rest. A status that is already recorded
 * stays selectable- a repeated scan is a real operational event, and the rule
 * only concerns what came before.
 */
export function allowedOperationalStatuses(
  recorded: Iterable<ShipmentEventStatus | string>
): ShipmentOperationalStatus[] {
  const already = [...recorded];
  return shipmentOperationalStatusValues.filter(
    (status) => findMissingPrerequisites(status, already).length === 0
  );
}

/**
 * What to tell Operations when they pick a step the shipment has not reached.
 *
 * Names every outstanding step rather than only the first, so one message is
 * enough to explain the whole gap instead of sending them round the form three
 * times.
 */
export function describeMissingPrerequisites(
  target: string,
  missing: readonly ShipmentOperationalStatus[]
): string {
  const labels = missing.map(formatShipmentEventLabel);
  const list = labels.length > 1
    ? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
    : labels[0] ?? "";

  return `${formatShipmentEventLabel(target)} cannot be recorded yet. `
    + `${list} ${labels.length > 1 ? "are" : "is"} still outstanding- `
    + "shipment progress must be recorded in order.";
}
