/**
 * Whether a repeated timeline row can be removed without losing anything a
 * person wrote.
 *
 * Mixed-stage bulk updates used to write a second, identical row for a scan
 * that only happened once. Cleaning those up means deleting customer-facing
 * history, so the rule for what may go is kept here as a pure function rather
 * than buried in the script that runs it- deletion logic that cannot be tested
 * without a database is deletion logic nobody checks.
 *
 * Lives beside the copy service because "did an operator write this, or did the
 * system fill it in" is answered by comparing against the standard line.
 */
import { isSystemWrittenNote } from "./shipmentEventCopy.service.js";

export type DuplicateEventFacts = {
  status: string;
  note?: string | null;
  location?: string | null;
};

/**
 * True when `duplicate` is a bare repeat of the row being kept.
 *
 * Two things save a row from removal, both meaning it carries information the
 * kept event does not: a note a person actually typed- as opposed to a blank,
 * the standard line, or one of the strings older versions filled in- and a
 * location the kept event does not already have.
 */
export function isRemovableDuplicate(
  duplicate: DuplicateEventFacts,
  kept: Pick<DuplicateEventFacts, "location">
): boolean {
  if (!isSystemWrittenNote(duplicate.note, duplicate.status)) return false;

  const duplicateLocation = (duplicate.location ?? "").trim();
  const keptLocation = (kept.location ?? "").trim();
  if (duplicateLocation && duplicateLocation !== keptLocation) return false;

  return true;
}
