# Sequential shipment status progression

Companion to [PUBLIC-TRACKING-PLAN.md](PUBLIC-TRACKING-PLAN.md). Independent of it-
either can ship first- but the two are related: a gapless history is what makes the
public journey rail read correctly.

## Context

Operations can currently record any operational status at any time. A shipment sitting
at `SHIPMENT_BOOKED` can be moved straight to `FLIGHT_ASSIGNED`, leaving
`PARCEL_COLLECTED`, `WAREHOUSE_SCAN_IN` and `EXPORT_CUSTOMS_CLEARED` never recorded.
The journey rail then draws those stages as pending forever while the shipment shows as
in flight, and the customer sees a history that skips the steps their parcel actually
went through.

[updateDpdShipmentOperationalStatus](backend/src/controllers/dpdShipment.controller.ts#L955)
validates the status against the enum, checks for a cancellation, checks the shipment is
not on hold, and gates `WAREHOUSE_SCAN_IN` on charge verification- but never checks
**order**.

The ladder is `shipmentOperationalStatusValues`
([shipmentEvent.model.ts:24-34](backend/src/models/shipmentEvent.model.ts#L24-L34)):

```
1 PARCEL_COLLECTED          6 DESTINATION_ARRIVED
2 WAREHOUSE_SCAN_IN         7 IMPORT_CUSTOMS_CLEARANCE
3 EXPORT_CUSTOMS_CLEARED    8 OUT_FOR_DELIVERY
4 FLIGHT_ASSIGNED           9 DELIVERED
5 FLIGHT_DEPARTED
```

### The rule

> **A ladder status may be recorded only when every ladder step before it already
> exists on that shipment.**

Chosen over "only the immediate next step" because it handles the shipments already in
flight. Those may already carry gaps; under this rule they can unstick themselves by
recording the missed steps (each of which has all *its* prerequisites), whereas a
strict next-only rule would leave them permanently one step behind. Going forward, gaps
become impossible, so the two rules converge on new shipments.

### What is *not* affected

Only the staff status dropdown is governed. Everything else keeps working exactly as it
does today:

| Path | Status written | Why it stays open |
|---|---|---|
| [pickup.service.ts:812](backend/src/services/pickup.service.ts#L812) | `PARCEL_COLLECTED` | Driver-triggered. Also step 1- it has no prerequisites. |
| [pod.controller.ts:307](backend/src/controllers/pod.controller.ts#L307), `:322` | `DELIVERED` | **Deliberate.** A driver at the customer's door must never be blocked by a scan an office missed. POD has its own evidence checks (photo, signature or approved exception). |
| `dpdShipment.controller.ts:851` / `:925` | `ON_HOLD` / `RELEASED_FROM_HOLD` | Off-ladder; can legitimately happen at any point. |
| [shipmentCancellation.service.ts:592](backend/src/services/shipmentCancellation.service.ts#L592) | `SHIPMENT_CANCELLED` | Off-ladder and terminal. |
| `client.controller.ts:970`, `dpdShipment.controller.ts:240` | `SHIPMENT_BOOKED` | Off-ladder; it is the state the ladder starts from. |

There is **no override**. Because filling a gap is always permitted, no legitimate case
needs an escape hatch: Operations records the missed step, then continues. Nothing to
build, nothing to audit, and no way to leave a permanent hole in a timeline.

---

## Backend

### 1. New pure helper- `portal/backend/src/services/shipmentStatusSequence.service.ts`

```ts
/** Ladder steps before `target` that this shipment has not recorded, in ladder order. */
export function findMissingPrerequisites(
  target: ShipmentOperationalStatus,
  recorded: Iterable<string>
): ShipmentOperationalStatus[]
```

Pure and DB-free, so it is directly unit-testable and the controller stays readable.
An empty array means the update is allowed. A status not on the ladder returns empty-
the rule governs the ladder and nothing else.

Also export a `formatLadderStatus` label helper. There is already a
`formatShipmentEventLabel` in [client.controller.ts:934](backend/src/controllers/client.controller.ts#L934)
doing exactly this underscore-to-title-case transform; lift it here rather than writing
a third copy, and have the client controller import it.

### 2. Guard in `updateDpdShipmentOperationalStatus`

Insert after the existing on-hold check (`dpdShipment.controller.ts:993`) and **before**
the `WAREHOUSE_SCAN_IN` charge-verification check. Sequence is the coarser gate- being
at the wrong rung entirely is a more fundamental problem than an unverified charge, and
answering with the charge message first would send Operations to fix the wrong thing.

The handler currently loads only `latestEvent`. Add one query for the distinct set:

```ts
const recorded = await ShipmentEvent.distinct("status", { shipmentDraftId: shipment.shipmentDraftId });
```

Deliberately **not** filtered on `customerVisible`- an internal scan still happened,
and hiding it from customers must not also hide it from the sequence check.

On a violation, answer **409**, matching the cancellation and on-hold guards above it:

```jsonc
{
  "success": false,
  "message": "Flight Assigned cannot be recorded yet. Parcel Collected and Warehouse Scan In are still outstanding- shipment progress must be recorded in order.",
  "missingStatuses": ["PARCEL_COLLECTED", "WAREHOUSE_SCAN_IN"]
}
```

Build the sentence from the missing list so it names every outstanding step, not just
the first. `missingStatuses` is returned so the UI can render the list without
re-deriving it. Singular/plural must both read correctly ("is still outstanding" /
"are still outstanding").

### 3. Tests- `portal/backend/src/tests/shipmentStatusSequence.test.ts`

The repo uses `tsx --test`. Cover the pure helper:

- from `SHIPMENT_BOOKED` (no ladder events): `PARCEL_COLLECTED` allowed, `FLIGHT_ASSIGNED` reports 3 missing
- a legacy shipment with `{PARCEL_COLLECTED, FLIGHT_ASSIGNED}`: `WAREHOUSE_SCAN_IN` allowed (gap fill), `FLIGHT_DEPARTED` blocked on the two gaps
- re-recording a status that already exists: allowed, no missing prerequisites
- a full ladder: `DELIVERED` allowed
- off-ladder input (`ON_HOLD`): returns empty

---

## Frontend

### 4. Mirror the rule in `lib/dpdLabels.ts`

`shipmentOperationalStatusOptions` already lives there
([dpdLabels.ts:510](frontend/src/lib/dpdLabels.ts#L510)), so the ladder order is
already expressed on this side. Add a matching `findMissingStatusPrerequisites(target,
recorded)` beside it.

This is a deliberate small duplication- the two packages share no library, and the
alternative is an API round-trip to grey out a dropdown. Comment it as such and state
plainly that **the backend is authoritative**: the client copy exists to prevent a
doomed submission, not to decide the outcome.

### 5. Status dropdown- `app/dashboard/shipments/[draftId]/page.tsx`

The page already holds `history.events`, so the recorded set needs no new fetch.

- Derive `recordedStatuses` from `history.events` with `useMemo`.
- In the `<select>` at [page.tsx:458-466](frontend/src/app/dashboard/shipments/[draftId]/page.tsx#L458-L466),
  mark blocked options `disabled` and append a short reason to the label. The
  hold-reason select directly above already uses `<option disabled>`, so this matches
  the file's existing idiom.
- **Fix the default.** `nextStatus` initialises to `"PARCEL_COLLECTED"`
  ([page.tsx:188](frontend/src/app/dashboard/shipments/[draftId]/page.tsx#L188)), which
  on a mid-journey shipment now opens the form on a status that is already recorded.
  Initialise to the first *allowed* status instead, and re-derive it when the history
  reloads.
- Under the select, render the same guidance the server would send, so the requirement
  is visible before anything is submitted: *"Record Parcel Collected before the later
  stages become available."*
- Keep the error surface working. `setActionFeedback` already renders a
  `warning`/`error` toast; a 409 from this guard should land there as a `warning`,
  since it is a workflow instruction, not a failure.

---

## Interaction with the public tracking page

`ShipmentJourney` treats a stage as reached when any of its statuses is recorded, and
its comment explains why: *"a shipment that skipped a scan still shows the progress it
genuinely made rather than stalling at the missing step."*

**Keep that fallback.** Sequencing stops new gaps, but shipments booked before this
change keep theirs, and the driver paths above can still produce one. The rail must
keep rendering those honestly rather than assuming a gapless history it cannot count on.

---

## Verification

1. **The blocked jump.** On a shipment whose only event is `SHIPMENT_BOOKED`, open the
   status form: every option except `Parcel Collected` is greyed out with a reason.
2. **The server still catches it.** Bypass the UI-
   `curl -X POST …/api/v1/dpd-shipments/<id>/status-events -d '{"status":"FLIGHT_ASSIGNED"}'`
   with a valid operations session → 409 naming all three outstanding steps, and
   `missingStatuses` with three entries. Confirm `db.shipmentevents` gained no row.
3. **The happy path is unchanged.** Walk a shipment through all nine rungs in order;
   every one succeeds and the journey rail fills completely.
4. **Legacy gap-filling.** Hand-insert `{PARCEL_COLLECTED, FLIGHT_ASSIGNED}` to
   simulate a shipment booked before this change. Only `Warehouse Scan In` opens - the
   earliest gap - because `Export Customs Cleared` still has it outstanding. Record it,
   and `Export Customs Cleared` opens next; `Flight Departed` stays blocked until both
   are in. Gaps are backfilled in the order the parcel travelled, which is the case the
   "every earlier step" rule was chosen for.
5. **Drivers are never blocked.** With no `OUT_FOR_DELIVERY` recorded, submit a driver
   POD- it must succeed and write `DELIVERED`. Likewise complete a driver pickup on a
   shipment with no prior events and confirm `PARCEL_COLLECTED` is written.
6. **Off-ladder actions still work at any point.** Place and release a hold mid-ladder;
   cancel a shipment mid-ladder. Neither should hit the sequence guard.
7. **Guard ordering.** Attempt `WAREHOUSE_SCAN_IN` on a shipment that has neither
   `PARCEL_COLLECTED` nor a charge verification. The response must be the sequence
   message, not the charge-verification one.
8. **Re-recording.** Record a status that already exists- still permitted, since a
   repeated scan is a real operational event and the rule only concerns prerequisites.
9. **Unit tests.** `npm test` (or the `tsx --test` script) passes, including the new
   `shipmentStatusSequence.test.ts`.
