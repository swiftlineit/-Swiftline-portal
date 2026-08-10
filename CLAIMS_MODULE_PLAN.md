# Claims Management Module

Compensation claims for lost, damaged, short, or stolen shipments — filing
through settlement, plus recovery from carriers.

Status: **Phase 1 in progress.** Foundation (types, core model, state machine,
permissions) is built and tested. Services, APIs, and UI follow.

---

## 1. Scope

Claims handles **compensation**. Everything that is not compensation stays where
it already lives:

| Belongs to Claims | Belongs elsewhere |
|---|---|
| Total loss, partial loss, shortage | Ordinary delay → Help Desk |
| Physical damage, theft, tampering | Tracking enquiries → Help Desk |
| Delay that caused physical loss | Invoice disputes → Help Desk |
| Settlement and bank payment | Cancellations, returns → Shipments |
| Carrier and insurer recovery | Customs disputes → Help Desk |

Available only to active business accounts. Individual and counter customers are
excluded. One active claim per shipment; one claim may cover many parcels and
many items.

---

## 2. Decisions locked before implementation

| Decision | Choice | Why |
|---|---|---|
| Evidence storage | S3 from day one | Claims is built S3-native; other modules convert later. See `S3_INTEGRATION_PLAN.md` |
| Malware scanning | Deferred | Field reserved on the model. Extension allowlist and file-signature checks stand in |
| PodDispute overlap | Kept, and linked | It is already live with overlapping categories. It gains "Raise a Claim" rather than being replaced |
| Amount calculation | None | The portal never computes a claim amount. Client enters requested, reviewer enters approved |
| Two-person payment | Not required | Same authorised user may approve and pay. Compensating control is the audit trail |

### Deadlines

| Window | Value | Applies to |
|---|---|---|
| Booking → claim | **35 days** | Shipments that never arrived |
| Delivery → claim | **7 days** | Damage, shortage, tampering |
| Appeal | 15 days from decision | One appeal only |
| Document response | 7 days, extendable | Client evidence requests |

The two filing windows are **alternatives, not a pair**. Once a shipment is
delivered the 7-day clock governs and the 35-day clock stops applying. Applying
both would expire a claim on a parcel delivered on day 34 before the client could
open the box. This is enforced in `claimFilingDeadline()` and covered by test.

Late filings are **flagged for staff review, never auto-rejected**.

> **Attention — carrier recovery windows are shorter than the client window.**
> Swiftline's own deadline to claim against DPD or a partner is typically far
> shorter than 35 days, and varies by mode and loss type. A client who files on
> day 30 may therefore be owed a payout that can no longer be recovered from the
> carrier. The client deadline does not need to change; the system should warn
> staff at decision time when the carrier window has already closed, so the
> exposure is known before approval rather than discovered by finance later.
> **The real numbers must be read off the carrier contracts and seeded into
> `ClaimPolicyRule`.** They are not yet known.

---

## 3. State model

Lifecycle status is separate from decision, acceptance, appeal, and recovery
state. A claim can be decided, accepted, awaiting payment, and chasing a carrier
at the same time — one field could not express that without a value per
combination.

```
DRAFT → SUBMITTED → [DOCUMENTS_REQUIRED] → UNDER_REVIEW
      → [NEEDS_INFORMATION | AWAITING_THIRD_PARTY]
      → PENDING_APPROVAL → DECIDED

DECIDED → accepted → SETTLEMENT_PENDING → payment recorded → SETTLED → CLOSED
DECIDED → appealed within 15 days → UNDER_REVIEW → revised DECIDED
```

`DOCUMENTS_REQUIRED` is conditional, not a mandatory stop: a client who uploads a
complete pack at preliminary submission goes straight to `UNDER_REVIEW`.

Separate fields: `submissionStage`, `decisionOutcome`, `acceptanceState`,
`appealState`, `recoveryState`.

### Rules the machine enforces

- Every transition is a **named command** with its own preconditions. There is no
  generic status-update endpoint — the difference between `DECIDED` and `SETTLED`
  is money leaving a bank account, not a dropdown.
- Only a **confirmed payment** reaches `SETTLED`. Approval alone does not.
- A client cannot run staff transitions; staff cannot accept a settlement on the
  client's behalf.
- Terminal claims (`CLOSED`, `WITHDRAWN`) accept nothing but `REOPEN`.
- One appeal, inside the window, on a claim that has a window.

### "Active" claims

A partial unique index on `activeShipmentDraftId` enforces one live claim per
shipment. `DECIDED` counts as active on purpose: a rejected claim inside its
appeal window must block a re-file, or clients would re-file instead of appealing
and the one-appeal limit would mean nothing.

---

## 4. Money

All amounts are **integer paise**, matching the credit and prepaid ledgers.

Three independent values, none derived from another:

| Field | Set by |
|---|---|
| `requestedAmountMinor` | Client, by hand |
| `approvedAmountMinor` | Reviewer, by hand |
| `paidAmountMinor` | Recorded when the bank payment completes |

Enforced: approved ≤ requested, paid ≤ approved, none may be zero or negative.

A requested amount **may exceed** the shipment's declared value — the client is
warned prominently but not blocked, and the reviewer sees both figures side by
side. No insurance, liability, salvage, or declared-value formula ever adjusts
the entered number.

> **Attention — declared value carries no currency field.** `declaredGoodsValue`
> on a shipment is a float with an implicit INR assumption, while claim amounts
> are integer paise. The conversion happens at the comparison boundary. If
> multi-currency shipments are ever introduced, this comparison becomes wrong and
> must be revisited.

---

## 5. The snapshot

A claim freezes what the shipment looked like when it was filed, rather than
referencing it live. A claim is a legal record: an amendment, a re-rate, or a
corrected address six months later must not change what was claimed or what the
reviewer saw.

> **Attention — parcel items have no stable identity.** Items on a shipment are
> stored with `_id: false`, so only their position identifies them, and an
> amendment can reorder or replace them after booking. Affected-item references
> are therefore a coordinate (`parcelSequence` + `itemIndex`) **into the frozen
> snapshot, never into the live shipment**, with every value the reviewer needs
> copied alongside. A live lookup would silently repoint what the client claimed
> for. This is load-bearing — do not "optimise" it into a join.

---

## 6. Permissions

Two matrices, because staff and business members are different populations with
different risks.

### Business members

| Role | Can |
|---|---|
| Owner / Admin | Everything, including accept, appeal, bank details |
| Operations | Create, edit, upload, message, withdraw — **not** accept or appeal |
| Finance | View, including financials |
| Tracking only | View status only — no amounts, no bank data |

Accepting a settlement, appealing, and changing bank details bind the company to
money, so they stay with the two roles that can bind it. An operations login is
far more widely shared than an owner's.

### Internal staff

| Role | Can |
|---|---|
| Admin | Everything, all branches, including legal hold |
| Operations | Full claim handling for assigned branches, including decide and pay |
| Finance | View, verify beneficiary, pay, reconcile — **not** decide |
| Delivery | Read-only, assigned branches |
| HR | No access |

Branch scoping: admins see everything; everyone else sees only assigned branches.
**An empty branch assignment means no access, not unrestricted access** — getting
that default backwards is the classic way this check fails open, and it is
covered by test.

---

## 7. Evidence

Required documents change by claim category, and existing portal documents
attach automatically so clients never re-upload what Swiftline already holds.

Limits: PDF/JPG/PNG/WebP, 10 MB per file, 20 active documents per claim.
Filenames are always server-generated UUIDs — the client's filename is kept as
metadata only, which closes path traversal and double-extension tricks at the
source.

Claim evidence **streams through the API** rather than using signed URLs. A
signed URL stays valid for its whole lifetime wherever it travels, and claim
documents contain loss photographs and bank identifiers.

A required document may only be waived by admin or operations, with a reason
recorded on the timeline.

---

## 8. Settlement

Bank details are collected **after** approval, not during filing.

- Account number encrypted via the existing `credentialEncryption.service`,
  masked for display, `select: false` on the model.
- Never in logs, URLs, notifications, or audit metadata.
- Versioned beneficiary records; any change forces re-verification; each payment
  records which version it paid.
- A payment needs a bank/UTR reference and proof, and can only exist against an
  accepted, approved claim.

V1 assumes the transfer happens through Swiftline's existing banking process and
is then **recorded** in the portal with proof. No payout-provider integration.

---

## 9. Retention

Eight years past the last final event. Legal hold blocks deletion during
litigation, fraud investigation, dispute, appeal, or recovery — and outranks the
retention clock.

Everything for one claim shares the `claims/{claimId}/` S3 prefix so hold and
retention operate on a prefix rather than an enumerated file list that could
drift.

> **Attention — S3 lifecycle rules.** Any expiry rule added to the bucket for
> cost control must exclude the `claims/` prefix, or it will quietly destroy
> evidence under a legal retention duty.

---

## 10. Build order

| Phase | Deliverable | State |
|---|---|---|
| 0 | Disable unfinished route insurance | **Done — backend** |
| 1 | Types, core model, state machine, permissions | **Done** |
| 1b | Remaining models, claim numbering, policy/deadline engine | **Done** |
| 2 | Eligibility, drafts, preliminary submission, client API | **Done** |
| 3 | Evidence upload and dynamic checklist on S3 | **Done** |
| 4 | Staff work queue, review workspace, assignment | **Done — API** |
| 5 | Decisions, acceptance, appeal | **Done** |
| 6 | Beneficiary, settlement, recovery | **Done** |
| 7 | Notifications, reporting, security review, rollout | Not started |

**The backend is complete and the frontend is not built.** No client or staff
claim UI exists yet: no `/client/claims` pages, no `/dashboard/claims` work
queue, no navigation entries, no "Raise Claim" action on shipment details. Every
endpoint below is live and callable, but nothing in the browser reaches them.

Phase 0's frontend half is also outstanding — the pricing engine no longer
produces an insurance charge, so no cost estimate, invoice, or summary can show
one, but the insurance controls in the Route Charges form and rate-card views are
still rendered and should be hidden.

### Endpoints

Client — `/api/v1/client/claims`:

```
GET    /                              list
GET    /claimable-shipments           shipment picker
GET    /eligibility/:shipmentId       why a claim can or cannot be raised
POST   /                              create draft
GET    /:claimId                      detail, checklist, timeline
PATCH  /:claimId/draft                save draft
POST   /:claimId/submit               preliminary submission
POST   /:claimId/documents            upload evidence
GET    /:claimId/documents/:id        stream evidence
DELETE /:claimId/documents/:id        remove (soft)
POST   /:claimId/messages             message staff
POST   /:claimId/accept               accept settlement
POST   /:claimId/appeal               appeal a decision
POST   /:claimId/beneficiary          submit bank details
```

Staff — `/api/v1/claims`:

```
GET  /                                        work queue
GET  /:claimId                                review workspace
POST /:claimId/assign                         assign a handler
POST /:claimId/decisions                      approve / partly approve / reject
GET  /:claimId/documents/:id                  stream evidence
POST /:claimId/documents/:id/review           accept or reject a document
POST /:claimId/beneficiary/:id/verify         verify bank details
POST /:claimId/settlements                    record a bank payment
POST /:claimId/recoveries                     carrier / insurer recovery
```

### Verification

```
npm run build            backend compiles
npm run test:claims      85 tests
npm run test:storage     16 tests
npm run test:shipment:cost-estimator   23 tests, insurance now asserted absent
```

---

## 11. Open items

| Item | Owner | Blocking |
|---|---|---|
| **Client and staff claim UI** | Frontend | Client use |
| **Hide insurance controls in Route Charges and rate-card views** | Frontend | Phase 0 completion |
| Carrier claim windows read off contracts, seeded into `ClaimPolicyRule` | Business | Recovery warnings |
| Notifications wired to `portalNotification` and the email outbox | Backend | Phase 7 |
| Declaration wording and version (currently `1.0`, placeholder text) | Business / Legal | Client use |
| Confirm eight-year retention with legal | Business / Legal | Phase 7 |
| Retention / legal-hold purge job | Backend | Phase 7 |
| Auto-attaching existing portal documents to the checklist | Backend | Phase 7 |
| SLA timers: elapsed, waiting-on-client, waiting-on-third-party | Backend | Phase 7 |
| Support-ticket and PodDispute "Raise a Claim" links | Full stack | Phase 7 |
