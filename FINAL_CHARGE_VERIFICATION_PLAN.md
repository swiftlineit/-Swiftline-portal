# Final Weight & Charge — from mandatory gate to optional correction

Amends the feature described in
[Swiftline_Credit_Module_Full_Report_v1.1.md §10](Swiftline_Credit_Module_Full_Report_v1.1.md).
Related to [SEQUENTIAL-STATUS-PLAN.md](SEQUENTIAL-STATUS-PLAN.md), which governs the
status ladder this change unblocks.

## Context

Today a shipment cannot be moved from `PARCEL_COLLECTED` to `WAREHOUSE_SCAN_IN` until
someone has finalised the Final Weight & Charge. Operations must stop, re-key every
parcel's weight and all three dimensions, preview, and finalise — even when the parcel
weighs exactly what the customer declared and nothing about the charge changes.

The intended behaviour is the opposite: the booked weight stands, and the re-weigh is an
**optional correction** an admin or operations user initiates *only* when the parcel is
found heavier or lighter than described. Everything downstream of a correction —
recalculated charge, funding from Customer Advance and credit, the revised invoice, the
ledger entry, the client notification — stays exactly as it is.

### The rule

> **Shipment progress is never blocked by the charge.** The re-weigh is a staff-initiated
> correction available while the shipment is still in India, and the charge is treated as
> settled at Warehouse Scan In unless a correction says otherwise.

## What blocks it today

| # | Concern | Location |
|---|---------|----------|
| 1 | Single status update refuses `WAREHOUSE_SCAN_IN` | [dpdShipment.controller.ts:1052-1060](backend/src/controllers/dpdShipment.controller.ts#L1052-L1060) |
| 2 | Bulk status update refuses the same | [bulkShipmentStatus.service.ts:121](backend/src/services/bulkShipmentStatus.service.ts#L121), [:210](backend/src/services/bulkShipmentStatus.service.ts#L210) |
| 3 | Verification window closes at `WAREHOUSE_SCAN_IN` | [shipmentChargeVerification.service.ts:26-38](backend/src/services/shipmentChargeVerification.service.ts#L26-L38), [:119-122](backend/src/services/shipmentChargeVerification.service.ts#L119-L122) |
| 4 | Credit statements bill *only* verified shipments | [creditBillingCycle.service.ts:163-185](backend/src/services/creditBillingCycle.service.ts#L163-L185) |
| 5 | Panel presents itself as a required step | [ShipmentChargeVerificationPanel.tsx:165](frontend/src/components/shipments/ShipmentChargeVerificationPanel.tsx#L165) |

Concerns 3 and 4 are the ones that make this more than a two-line deletion.

**Concern 3** — the only reason the window never bites today is that scan-in is blocked
until verification happens. Remove the block and keep the window, and whoever records
Warehouse Scan In first permanently locks out the re-weigh. The feature becomes a trap.

**Concern 4** — statement lines are selected by *finding verification records in the
period*, then pulling those shipments' invoices. Verification is mandatory today, so every
credit shipment has one. Make it optional and an unverified shipment never appears on any
statement. Because `closeCreditBillingCycle` refuses to write a second statement for a
period it already closed
([creditBillingCycle.service.ts:154-161](backend/src/services/creditBillingCycle.service.ts#L154-L161)),
that revenue is orphaned permanently, silently, with no error raised anywhere.

## Two pre-existing defects this change exposes

### A. The re-weigh never reaches the operations manifest

[shipmentChargeVerification.service.ts:316](backend/src/services/shipmentChargeVerification.service.ts#L316)
writes the verified weights to `draft.parcelList` but leaves
`dpdShipment.currentShipmentSnapshot` holding the booked values. The operations manifest
reads parcel weights from that snapshot
([operationsManifest.service.ts:437-450](backend/src/services/operationsManifest.service.ts#L437-L450)),
so bags and manifest totals are packed at the **booked** weight after a re-weigh, and the
sealed snapshot carries that figure into the customs EDI. Meanwhile the customs invoice
and the client's shipment view read `draft.parcelList` live and show the **verified**
weight. Two documents, two weights, today.

Amendments handle this correctly
([shipmentAmendment.controller.ts:950](backend/src/controllers/shipmentAmendment.controller.ts#L950)).
Verification simply never got the same treatment.

### B. A downward re-weigh after payment fails with a misleading error

`calculateAmendmentBillingAdjustment`
([amendmentBilling.service.ts:46-95](backend/src/services/amendmentBilling.service.ts#L46-L95))
assumes `advanceAppliedMinor + creditOutstandingMinor === totalAmountMinor`. Payment
breaks that invariant: it zeroes `invoice.creditOutstandingMinor` without moving anything
into `advanceAppliedMinor`
([creditPayment.service.ts:300-311](backend/src/services/creditPayment.service.ts#L300-L311)).

So for a ₹10,000 invoice already billed and paid, re-weighed down to ₹9,000:

```
reductionMinor       = 1000
creditReducedMinor   = min(1000, previousCreditOutstandingMinor = 0) = 0
advanceRefundedMinor = 1000 - 0 = 1000
  → 1000 > previousAdvanceAppliedMinor (0)
  → throw 409 "The existing invoice payment allocation is inconsistent."
```

The guard is correct for the pre-payment world it was written for. Once a re-weigh can
land after billing, "refund more advance than was applied" becomes a *legitimate* outcome:
the customer paid cash against an amount that has since been reduced, and the difference
has to come back as Customer Advance.

The same limitation exists in the cancellation path
([shipmentCancellation.service.ts:455-480](backend/src/services/shipmentCancellation.service.ts#L455-L480));
it is out of scope here and left as-is.

### C. A re-weigh wipes the customs item lines (found during implementation)

`mergeVerifiedParcels` rebuilt each parcel from scratch, carrying across only
the measurement fields, the content type, the description and the two
references. `items`, `aadhaarNumber` and `kycDocuments` are all optional on
`ShipmentParcel`, so nothing complained- they were simply dropped.

The draft's pre-validate hook
([shipmentDraft.model.ts:570-586](backend/src/models/shipmentDraft.model.ts#L570-L586))
then regenerated `items` from `contentsDescription` through
`normalizeParcelItems`, which for a parcel with no stored items produces a
single line with **an empty HSN code and zero quantity and unit rate**. So
finalising a verification emptied the customs invoice's tariff lines, dropped
the declared goods value to nothing, and lost per-parcel KYC.

The existing code half-knew: the comment in `calculateVerificationPricing`
explained that the declared value had to come from the draft input because
"verified parcels carry no item lines". The symptom was worked around for
pricing rather than fixed at the cause.

Left unfixed this would have been made worse by Step 4, which copies the draft's
parcels into the shipment snapshot the manifest and EDI read from.

## Decisions taken

| Question | Decision |
|---|---|
| How long may staff re-weigh? | Until `FLIGHT_DEPARTED` is recorded — the shipment has physically left India |
| What replaces verification as the billing trigger? | A new `chargeFinalizedAt` on `ShipmentInvoice`, set at Warehouse Scan In or verification, whichever comes first |
| Downward re-weigh on a settled statement? | Refund the difference to Customer Advance |

The window and the billing trigger deliberately sit at **different** points. The charge is
treated as settled at Warehouse Scan In so billing timing does not move at all, while the
re-weigh stays open until departure as a grace period for late data entry. A re-weigh
arriving after the statement closed flows through the existing `isPreviouslyBilled`
adjustment path, which already produces a `CreditBillingAdjustment` on the next statement.

---

## Step 1 — Remove the status gate

**[dpdShipment.controller.ts](backend/src/controllers/dpdShipment.controller.ts)**
Delete the `WAREHOUSE_SCAN_IN` block at lines 1052-1060. Remove the now-unused
`ShipmentChargeVerification` import at line 29 (it has no other use in the file).

Leave the comment block at lines 1027-1038 in place but drop its reference to the charge
check — the sequence gate is no longer "the coarser of two gates", it is the only gate.

**[bulkShipmentStatus.service.ts](backend/src/services/bulkShipmentStatus.service.ts)**
- Drop `needsChargeVerification` and `chargeVerified` from the `statusUpdateBlockReason`
  input type and delete the branch at lines 120-122.
- Delete the `ShipmentChargeVerification.distinct` query from the `Promise.all` at lines
  156-159 and the `chargeVerifiedSet` at line 168.
- Drop both fields from the call site at lines 208-212.
- Remove the model import at line 5.

Update the doc comment above `statusUpdateBlockReason` — it currently advertises "the
Warehouse Scan In charge check" as one of the gates it mirrors.

**[bulkShipmentStatus.test.ts](backend/src/tests/bulkShipmentStatus.test.ts)**
Delete the `gates Warehouse Scan In on a verified charge` case at lines 72-92 and strip
the two removed fields from every other `statusUpdateBlockReason` call in the file.

No frontend change is needed here. The admin status form gates only on sequence
prerequisites ([page.tsx:575](frontend/src/app/dashboard/shipments/[draftId]/page.tsx#L575));
the charge check was server-side only.

## Step 2 — Widen the verification window to departure

**[shipmentChargeVerification.service.ts](backend/src/services/shipmentChargeVerification.service.ts)**

Rename `afterCollectionStatuses` (lines 26-38) to `afterDepartureStatuses` and reduce it to
the statuses that mean the shipment has left:

```ts
const afterDepartureStatuses: ShipmentEventStatus[] = [
  "FLIGHT_DEPARTED",
  "DESTINATION_ARRIVED",
  "IMPORT_CUSTOMS_CLEARANCE",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "RETURNED",
  "LOST",
  "DAMAGED"
];
```

`IN_TRANSIT` is added deliberately. It is absent from today's list, which is a hole rather
than a decision — it is not on the operational ladder so the status endpoint's zod schema
cannot write it, but nothing guarantees that stays true.

Update the refusal message at line 121 to
`"Final charge verification must be completed before the shipment departs."`

`PARCEL_COLLECTED` stays the opening condition, and the pending-amendment and
cancellation gates (lines 123-135) stay exactly as they are.

**Not changing:** the one-verification-per-shipment rule. The model is `unique` on both
`shipmentDraftId` and `dpdShipmentId` and rejects every mutation
([shipmentChargeVerification.model.ts:47-73](backend/src/models/shipmentChargeVerification.model.ts#L47-L73)).
A correction to a correction is not supported and is not being added.

## Step 3 — Replace the billing trigger

### 3a. Schema

**[shipmentInvoice.model.ts](backend/src/models/shipmentInvoice.model.ts)**
Add to `IShipmentInvoice` and the schema:

```ts
chargeFinalizedAt?: Date | null;
// schema:
chargeFinalizedAt: { type: Date, default: null }
```

Add the index that the statement query needs, beside the two at lines 146-147:

```ts
shipmentInvoiceSchema.index({ businessAccountId: 1, chargeFinalizedAt: 1, billingStatementId: 1 });
```

### 3b. A single place that sets it

**[shipmentInvoice.service.ts](backend/src/services/shipmentInvoice.service.ts)** — new export:

```ts
/**
 * Marks a shipment's charge as settled, which is what makes its invoice eligible
 * for the next billing statement.
 *
 * Set once and never moved: whichever comes first between the hub receiving the
 * parcel and Operations correcting its weight is the moment the amount stopped
 * being provisional. The `chargeFinalizedAt: null` filter makes repeat calls
 * (a re-scan, a second Warehouse Scan In row) no-ops rather than re-dating the
 * invoice into a later statement period.
 */
export async function markShipmentChargeFinalized(input: {
  shipmentDraftId: mongoose.Types.ObjectId;
  finalizedAt: Date;
  session?: mongoose.ClientSession;
}) {
  await ShipmentInvoice.updateOne(
    { shipmentDraftId: input.shipmentDraftId, chargeFinalizedAt: null },
    { $set: { chargeFinalizedAt: input.finalizedAt } },
    { session: input.session ?? null }
  ).exec();
}
```

### 3c. Three call sites

Only two code paths ever write a `WAREHOUSE_SCAN_IN` event — verified by auditing every
`ShipmentEvent` write in the backend. Pickup completion writes `PARCEL_COLLECTED` only
([pickup.service.ts:812](backend/src/services/pickup.service.ts#L812)); hold, release, POD
and cancellation write off-ladder statuses.

1. **[dpdShipment.controller.ts:1062](backend/src/controllers/dpdShipment.controller.ts#L1062)** —
   after `ShipmentEvent.create`, when `parsed.data.status === "WAREHOUSE_SCAN_IN"`, call
   `markShipmentChargeFinalized({ shipmentDraftId, finalizedAt: event.eventAt })`.
2. **[bulkShipmentStatus.service.ts:225](backend/src/services/bulkShipmentStatus.service.ts#L225)** —
   same call inside the per-shipment loop, guarded on `input.status === "WAREHOUSE_SCAN_IN"`.
3. **[shipmentChargeVerification.service.ts](backend/src/services/shipmentChargeVerification.service.ts)** —
   inside the finalize transaction, passing the session and `verification.verifiedAt`.

The demo seeder also needs it. `createDemoShipment.ts` writes a
`ShipmentChargeVerification` specifically so its invoice reaches a statement; with the
signal moved, the fixture stamps the invoice as well or `DEMO_CLOSE_BILLING_CYCLE`
produces "No eligible charges".

`ensureShipmentInvoiceForDraft` does not carry `chargeFinalizedAt` in its `nextValues`,
so a revision preserves the stamp — verified, not assumed.

### 3d. Statement selection

**[creditBillingCycle.service.ts:163-185](backend/src/services/creditBillingCycle.service.ts#L163-L185)** —
replace the verification lookup with a direct invoice query. The pending-cancellation
exclusion must be preserved; it just moves to after the invoice fetch.

```ts
const finalizedInvoices = await ShipmentInvoice.find({
  businessAccountId: input.businessAccountId,
  chargeFinalizedAt: { $gte: period.start, $lt: period.end },
  status: "ISSUED",
  paymentStatus: { $ne: "VOID" },
  creditOutstandingMinor: { $gt: 0 },
  billingStatementId: null
}).sort({ issuedAt: 1, _id: 1 }).session(session).exec();

const pendingCancellations = finalizedInvoices.length
  ? await ShipmentCancellation.find({
      shipmentDraftId: { $in: finalizedInvoices.map((invoice) => invoice.shipmentDraftId) },
      status: "REQUESTED"
    }).select("shipmentDraftId").session(session).lean().exec()
  : [];
const blockedDraftIds = new Set(pendingCancellations.map((item) => String(item.shipmentDraftId)));
const invoices = finalizedInvoices.filter(
  (invoice) => !blockedDraftIds.has(String(invoice.shipmentDraftId))
);
```

Drop the `ShipmentChargeVerification` import at line 9 — this was its only use in the file.

### 3e. Backfill

New script `src/scripts/backfillChargeFinalizedAt.ts`, following the established dry-run
pattern (`audit:*` reports, `--apply` writes). Register both scripts in `package.json`
next to the other `backfill:*` entries.

Target: invoices with `billingStatementId: null`, `status: "ISSUED"`,
`paymentStatus: { $ne: "VOID" }`, `creditOutstandingMinor > 0`, `chargeFinalizedAt: null`,
whose shipment has a `WAREHOUSE_SCAN_IN` event.

**Set `chargeFinalizedAt` to the script's run date, not the historical scan-in date.** A
historical date would drop these invoices into billing periods that are already closed,
where they can never be picked up — the exact orphaning this whole step exists to prevent.
Dating them to the run date lands them on the next statement.

Invoices whose shipment was verified but not yet billed already have a verification whose
`verifiedAt` sits in the current open period; set those to `verifiedAt`.

The dry run must print the invoice count and the total `creditOutstandingMinor` so Finance
can sanity-check the size of the first statement before `--apply` is run.

### 3f. Tripwire

The residual risk of a set-once field is a path that writes a status event without the
hook, leaving an invoice unbilled forever with nothing raising a flag. Add a check to the
existing reconciliation service
([creditReconciliation.service.ts](backend/src/services/creditReconciliation.service.ts))
that reports invoices with `chargeFinalizedAt: null`, `billingStatementId: null`,
`creditOutstandingMinor > 0` whose shipment passed Warehouse Scan In more than 45 days ago.
It runs under `job:credit:reconcile`, which is already scheduled.

## Step 4 — Carry the re-weigh into the shipment snapshot

**[shipmentChargeVerification.service.ts](backend/src/services/shipmentChargeVerification.service.ts)**,
inside the finalize transaction, after `draft.save({ session })` at line 317:

```ts
const previousSnapshot = readShipmentBookingSnapshot(shipment.currentShipmentSnapshot)
  ?? readShipmentBookingSnapshot(shipment.bookingSnapshot);
if (previousSnapshot) {
  shipment.currentShipmentSnapshot = buildRevisedShipmentSnapshot({
    previousSnapshot,
    draft,
    pricing: verifiedPricing,
    advanceAmountMinor: billingAdjustment.advanceAppliedMinor,
    creditAmountMinor: billingAdjustment.creditOutstandingMinor
  }) as unknown as Record<string, unknown>;
  await shipment.save({ session });
}
```

Three things this must **not** do, unlike the amendment path it borrows from:

- **Do not touch `snapshotRevision`.** Labels are filtered by `labelVersion === snapshotRevision`
  ([dpdShipment.controller.ts:792](backend/src/controllers/dpdShipment.controller.ts#L792),
  [dpdShipment.service.ts:870](backend/src/services/dpdShipment.service.ts#L870)). Bumping it
  would make every already-printed label vanish from the UI.
- **Do not set `shipment.status = "DPD_CREATED"`.** That marks a shipment as needing labels re-issued.
- **Do not regenerate labels.** The box is already labelled and collected; a re-weigh does
  not change its barcode.

Leaving `snapshotRevision` alone keeps `snapshotIsCurrent` false
([client.controller.ts:1040](backend/src/controllers/client.controller.ts#L1040)) once the
invoice revision outruns it, so the client and admin views keep falling through to the live
`draft.parcelList` — the same verified numbers. Consistent either way.

`buildRevisedShipmentSnapshot` throws `AMENDED_PARCEL_COUNT_MISMATCH` on a parcel-count
change. `mergeVerifiedParcels` already guarantees equal counts, so this cannot fire; guard
the call anyway rather than letting a raw `Error` escape the transaction.

## Step 5 — Refund a post-payment reduction to Customer Advance

**[amendmentBilling.service.ts](backend/src/services/amendmentBilling.service.ts)**

Add `advanceCreditedMinor` to `AmendmentBillingAdjustment` — the part of a reduction that
cannot come off credit or off applied advance because the customer already paid it in cash.

No new input is needed: `previousAmountMinor` is already the invoice total at every
call site, so the settled amount derives from the three values the function
receives.

In `calculateAmendmentBillingAdjustment`, derive what has already been settled and split a
reduction three ways instead of two:

```ts
// Payment zeroes an invoice's creditOutstandingMinor without moving anything into
// advanceAppliedMinor, so the booking-time invariant
// (advanceApplied + creditOutstanding === total) does not survive a paid statement.
// What is left over is what the customer has actually paid in cash.
const paidMinor = input.previousTotalAmountMinor
  - input.previousAdvanceAppliedMinor
  - input.previousCreditOutstandingMinor;

// A reduction unwinds in the order the money was committed: outstanding credit
// first, then advance that was applied at booking, and only then cash already
// paid — which comes back as new Customer Advance rather than as a statement credit.
creditReducedMinor   = Math.min(reductionMinor, input.previousCreditOutstandingMinor);
advanceRefundedMinor = Math.min(reductionMinor - creditReducedMinor, input.previousAdvanceAppliedMinor);
advanceCreditedMinor = reductionMinor - creditReducedMinor - advanceRefundedMinor;
if (advanceCreditedMinor > paidMinor) {
  throw new AmendmentBillingError(409, "The existing invoice payment allocation is inconsistent.");
}
```

The consistency check at line 82 generalises to:

```ts
advanceAppliedMinor + creditOutstandingMinor + paidMinor - advanceCreditedMinor === amendedAmountMinor
```

which reduces to the current check whenever `paidMinor` and `advanceCreditedMinor` are
zero — i.e. every case that works today behaves identically.

The same broken invariant lives one layer up in
`resolveShipmentInvoicePaymentAllocation`, which asserts
`advanceApplied + creditOutstanding === totalAmountMinor` and would reject the revised
invoice even after the adjustment succeeded. It takes an optional `settledAmountMinor`,
defaulting to the value derived from the invoice as it stands, and
`ensureShipmentInvoiceForDraft` forwards the post-adjustment figure that the two callers
holding an `AmendmentBillingAdjustment` now pass through.

This also repairs an **increase** on a settled invoice, which failed the same assertion
and is the more likely direction for a re-weigh.

In `applyShipmentBillingAdjustment`, add `advanceCreditedMinor` to the
`customerAdvanceBalanceMinor` increment at line 374 alongside `advanceRefundedMinor`, and
make sure it is **excluded** from the statement and `invoicedOutstandingMinor` arithmetic —
that money never sat on the open statement.

The ledger entry at lines 397-419 already records `metadata: adjustment`, so the new field
is captured for reconciliation without further change.

**Frontend:** `ShipmentAmendmentFundingPreview` in
[dpdLabels.ts](frontend/src/lib/dpdLabels.ts) gains the field, and the reduction branch of
`VerificationPreview`
([ShipmentChargeVerificationPanel.tsx:317-323](frontend/src/components/shipments/ShipmentChargeVerificationPanel.tsx#L317-L323))
gains a `Refunded to Customer Advance` row so the operator can see where the money is going
before finalising.

This function is shared with amendments, which are blocked after `PARCEL_COLLECTED` and so
cannot realistically reach a paid statement. The fix is harmless there.

## Step 6 — Present the panel as optional

**[ShipmentChargeVerificationPanel.tsx](frontend/src/components/shipments/ShipmentChargeVerificationPanel.tsx)**

- Header copy (line 165): `Verify measured parcel details before Warehouse Scan In.` →
  `Optional. Record the measured weight only if it differs from what the customer declared.`
- Collapse the measurement table behind a `Record Measured Weight` button. Expanding
  prefills from `parcelList`, exactly as `initialMeasurements` does now. This is what stops
  the panel reading as an outstanding task on every shipment.
- Primary button (line 253): `Finalize Weight & Charge` → `Apply Corrected Weight & Charge`.
- The `!state?.eligible` branch (lines 180-184) keeps rendering the server's message, which
  now reads correctly for both ends of the wider window.

**[page.tsx:688-694](frontend/src/app/dashboard/shipments/[draftId]/page.tsx#L688-L694)** —
no change. `onStateChange={setChargeVerified}` still drives the amendment block, which is
correct: once a charge has been corrected it should not then be amended.

## Step 7 — Documentation

**[Swiftline_Credit_Module_Full_Report_v1.1.md](Swiftline_Credit_Module_Full_Report_v1.1.md)**

- Line 34 (summary table) and §10 (lines 172-182): verification is optional, staff-initiated,
  and available from Parcel Collected until Flight Departed. Remove "has already progressed
  to Warehouse Scan In or later" from the blocked list.
- §13: statements bill invoices whose charge was finalised in the period, where finalised
  means Warehouse Scan In *or* an earlier correction.
- §16: the pending-cancellation lock still blocks verification — unchanged.

---

## What is deliberately unchanged

- Pricing, funding, GST, and the frozen `gstRatePercent` — the whole calculation path.
- Invoice revisioning, the immutable pricing snapshot, and the stable invoice number.
- Credit and Customer Advance deduction on an increase; credit restored first on a decrease.
- The `SHIPMENT_CHARGE_VERIFIED` notification and the `WEIGHT_DIFFERENCE` client exception
  ([clientAttention.service.ts:484-502](backend/src/services/clientAttention.service.ts#L484-L502)),
  which only fires on an increase and is unaffected.
- Roles: `admin`, `operations`, `finance`
  ([dpdShipment.routes.ts:43](backend/src/routes/dpdShipment.routes.ts#L43)). Already correct.
- Sequence prerequisites, hold/release, and the cancellation locks.
- One verification per shipment, immutable.

## Risks

| Risk | Mitigation |
|---|---|
| An invoice never gets `chargeFinalizedAt` and is never billed | Only two code paths write the status; reconciliation tripwire in Step 3f catches any that slip |
| Backfill dates land in closed periods | Script uses the run date, never the historical event date |
| First statement after backfill is unexpectedly large | Dry run reports count and total value for Finance sign-off before `--apply` |
| A shipment that never reaches Warehouse Scan In is never billed | Same as today — lost, returned and cancelled shipments settle through their own flows |
| Ops stops re-weighing entirely once it is optional | No worklist exists for "collected, not re-weighed". See open item below |

## Open items, not in scope

- **No ops visibility into skipped re-weighs.** Nothing surfaces shipments that moved
  through the hub without a weight check. If the re-weigh matters commercially, a shipments
  list filter or dashboard tile is worth a follow-up.
- **Cancellation has the same post-payment limitation** as Step 5 fixes for verification
  ([shipmentCancellation.service.ts:455-480](backend/src/services/shipmentCancellation.service.ts#L455-L480)).
  Left alone here.
- **`.git` at the repository root is empty.** This project currently has no working version
  control. A change touching billing selection should not ship without one.

## Test status

**Done**
- `bulkShipmentStatus.test.ts` — the charge gate case is replaced by one asserting
  Warehouse Scan In passes with no verification present.
- `amendmentBilling.test.ts` — four new cases: reduction on a fully paid invoice, on a
  part-paid invoice, an increase on a fully paid invoice, and an unpaid reduction proving
  the original behaviour is untouched.
- `creditBillingCycle.integration.test.ts` — seeds `chargeFinalizedAt` instead of a
  `ShipmentChargeVerification`, and still proves an invoice without one is passed over.
- Full backend typecheck, plus the credit, shipment, customs-invoice and EDI suites:
  150 tests, all passing against the testing cluster.

Note: this machine cannot resolve Atlas `mongodb+srv://` URIs; integration runs need
`dns.setServers(["8.8.8.8"])` preloaded via `node --import`.

**Still worth adding**
- A `shipmentChargeVerification` integration suite — none exists today. Worth covering
  that a correction succeeds after Warehouse Scan In and after Flight Assigned, is refused
  after Flight Departed, and that `currentShipmentSnapshot` picks up the corrected weights
  while `snapshotRevision` stays put.
- A case proving a correction recorded after the statement closed produces a
  `CreditBillingAdjustment` on the next period rather than rewriting the issued one.

**Manual, before production**
1. Run `npm run audit:charge-finalized` and check the count and total with Finance.
2. Book on credit → collect → scan in without touching the panel → confirm the status moves
   and `chargeFinalizedAt` is stamped.
3. Re-weigh heavier after scan-in → confirm credit deduction, revised invoice, client
   notification, and that the operations manifest now packs at the corrected weight.
4. Confirm the customs invoice keeps its HSN lines and declared value after a re-weigh.
5. Close the billing cycle → confirm both shipments appear on the statement.
6. Pay the statement → re-weigh a third shipment downward → confirm the difference lands in
   Customer Advance rather than 409-ing.
