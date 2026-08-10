# Claims — Manual Test Guide

Click-by-click walkthrough of everything built. Roughly 45 minutes end to end.

Nothing in this module has ever run over HTTP successfully before now, so treat
every step as a genuine test rather than a formality. Expect to find things.

---

## Before you start

### 1. Environment

`portal/backend/.env`:

```
STORAGE_DRIVER=s3
S3_BUCKET=swiftline-prod-storage-485141928054-ap-south-1-an
AWS_REGION=ap-south-1
S3_SIGNED_URL_TTL_SECONDS=900
S3_KEY_PREFIX=production
```

> To test without touching the real bucket, set `STORAGE_DRIVER=local` instead.
> Everything else behaves identically — uploads land in `backend/private_uploads/`.

### 2. Seed the policy rule

```bash
cd portal/backend
npm run seed:claim-policy
```

Expect a warning that `carrierRecoveryDays` is provisional. That is correct.

### 3. Restart the backend

Not optional — the auth fix only takes effect on restart.

### 4. Accounts you need

| Role | Purpose |
|---|---|
| Client, **account owner** of an active business account | Raises the claim |
| Staff, **admin** or **operations** | Reviews and decides |
| Staff, **finance** (optional) | Confirms it cannot decide |

### 5. A claimable shipment

This is the one thing that usually blocks a first test. A shipment qualifies only if:

- `bookingState` is `BOOKED`, **and**
- it has a `PARCEL_COLLECTED` tracking event, **and**
- no claim is already open on it

If your test shipment has no collection event, add one from
**Dashboard → Tracking**, or insert it directly:

```js
db.shipmentevents.insertOne({
  shipmentDraftId: ObjectId("<your shipment id>"),
  status: "PARCEL_COLLECTED",
  eventAt: new Date(),
  createdBy: ObjectId("<any user id>"),
  customerVisible: true,
  note: "Manual test",
  createdAt: new Date(),
  updatedAt: new Date()
});
```

---

## Part 1 — Navigation and entry points

**1.1** Sign in as the **client**. The left sidebar should show **Claims** below
Help-Desk. Click it → `/client/claims`, empty state reading "No claims yet".

**1.2** Sign in as **admin** in another browser or private window. Sidebar shows
**Claims**. Click it → `/dashboard/claims` with three tiles (Waiting on us, SLA
overdue, Filed late), all zero.

> Both windows stay open for the rest of this guide. You will switch between them.

**1.3** As the client, open a booked + collected shipment
(`/client/shipments/<id>`). Next to the status pill there should be an amber
**Raise a claim** button.

**1.4** Open a shipment that has *not* been collected. **No button should appear** —
not a greyed-out one, nothing at all.

---

## Part 2 — The claim wizard

**2.1** Click **Raise a claim**. The wizard opens at step 1 with the shipment
already selected.

**2.2 — Step 1, Shipment.** If you belong to more than one business account, a
selector appears first. Confirm the shipment dropdown lists only booked,
collected shipments. Click **Continue**.

**2.3 — Step 2, Claim type.** Six cards. Click **Physical damage** — it should
highlight blue. Click **Continue**. This is where the draft is created, so it may
pause briefly.

**2.4 — Step 3, What happened.** Check the read-only **Shipment details** panel
shows tracking number, route, declared value, and a parcel/item table. None of it
should be editable.

Under **Affected items**, set a quantity on one item. Try entering more than the
shipped quantity — it should clamp to the maximum.

Fill in:
- **Amount claimed** — enter a figure *higher* than the total declared value
- **Date you discovered the problem**
- **What happened** — at least 10 characters
- Packaging condition and contact fields

> An amber warning must appear showing declared vs claimed and stating you can
> still submit. If it does not appear, the over-declared check is broken.

Now lower the amount below the declared value — the warning should disappear.
Click **Continue**.

**2.5 — Step 4, Evidence. This is the S3 test.**

The checklist should show the requirements for *physical damage*: proof of value,
packing list, goods photos, outer packaging, inner packaging, label photo.

- If the shipment had an invoice at booking, **Proof of value** may already read
  **On file** — that is the auto-attach working.
- Click **Upload** on **Photos of the goods**, pick a JPG or PNG.
- The badge should flip to **Uploaded** and the filename appears.
- **Click the filename.** It should open in a new tab. *This is the critical
  check — it proves the object was written to and read back from S3.*
- Upload the same file again to a different row → "That document is already
  attached" (duplicate detection by hash).
- Try uploading a `.txt` or `.docx` → rejected as an invalid type.

Click **Continue**.

**2.6 — Step 5, Declaration.** Six statements, a checkbox. Continue stays
disabled until it is ticked.

**2.7 — Step 6, Submit.** Review the summary, click **Submit claim**.

You should land on the claim detail page with a claim number in the format
`CLM/26-27/00001`.

> If you get "A claim is already open for this shipment", a previous attempt left
> a draft. Open `/client/claims`, find it, and withdraw it.

---

## Part 3 — Client claim detail

**3.1** Confirm the header shows the claim number, a **Submitted** badge, and the
claimed amount.

**3.2** The **Withdraw this claim** link should be present (a claim before a
decision can be withdrawn). Do **not** click it yet.

**3.3** Scroll to **Messages**. Type something and send. It should appear
immediately.

**3.4** Check **History** shows: Created, Submitted, Number allocated, and a
document upload entry.

**3.5** Check your email (or the `emailoutbox` collection) for the acknowledgement.

---

## Part 4 — Staff queue and review

**4.1** Switch to the **admin** window. Refresh `/dashboard/claims`.

The claim should appear. Check:
- Claimed and Declared shown side by side
- If you left the amount above declared, the claimed figure is **amber**
- "Waiting on us" tile now reads 1

**4.2** Try the filters: status dropdown, **Assigned to me** (should empty the
list), **SLA overdue** (should empty it).

**4.3** Click **Review**.

**4.4 — Workflow buttons.** At the top of the header there should be action
buttons. On a freshly submitted claim you should see **Start review** and
**Request documents**.

> If you see no buttons at all, you are signed in as finance or delivery —
> those roles cannot drive the workflow by design.

**4.5** Click **Request documents**. A prompt asks for a reason — enter one.
Status changes to **Documents required**. Check the client window: the History
now shows the request, and an email should be queued.

**4.6** Click **Start review**. Status → **Under review**.

**4.7 — Document review.** In **Documents awaiting review**, click **Accept** on
the photo you uploaded. Then upload another document as the client and **Reject**
it with a reason. Switch to the client window — the checklist should show
**Rejected** in red with your reason visible.

**4.8** Click a document filename in the staff view. It should open — this proves
staff download works, which is a different code path from the client's.

---

## Part 5 — Decision

**5.1** Click **Send for approval**. Status → **Pending approval**.

**5.2** The **Decision** panel appears on the right. Confirm the grey box shows
**Requested amount**, **Shipment declared value**, and the difference if any.

**5.3** Select **Approve in part**. An amount field appears. Try entering *more*
than the requested amount → the server should refuse it.

**5.4** Enter a valid partial amount, choose a reason, write a customer
explanation of at least 10 characters, add an internal note. Click **Issue
decision**.

**5.5** Switch to the client window and refresh. You should see:
- Status **Decided**, outcome badge **Partially approved**
- A **Decision** section with claimed / declared / approved
- An appeal deadline banner
- **Accept settlement**, **Appeal this decision**, and **I disagree** buttons

**5.6** Check the decision email — it should carry the amounts and the appeal
deadline, and use its own layout rather than the generic one.

---

## Part 6 — Settlement

**6.1** As the client, click **Accept settlement**. Status → **Settlement
pending**.

**6.2** A **Settlement account** section appears. Click **Add bank details** and
fill in:
- Account holder name, bank name
- Account number and confirmation — **enter mismatching values first**, it should
  refuse
- IFSC — try an invalid one like `ABC123`, it should refuse. Valid format is 4
  letters, a `0`, then 6 characters, e.g. `HDFC0001234`

Submit with valid values. It should show as masked (`XXXXXX1234`) with state
**Submitted**.

> The full account number must never appear anywhere — not on screen, not in the
> network response. Worth checking the response body in devtools.

**6.3** As **admin**, refresh the review page. The settlement panel shows the
masked account with **Verify** and **Reject** buttons. Click **Verify**.

**6.4** The **Record the bank payment** form appears. Click **Upload bank
confirmation**, pick a PDF or image — it should upload and select itself as the
proof.

**6.5** Fill in amount, bank reference, payment date. Click **Record payment**.
Status → **Settled**.

**6.6** Click **Record payment** again if the form is still visible — it should
not create a second payment (idempotency).

**6.7** Client window: status **Settled**, and a payment email with the bank
reference (never the account number).

**6.8** As admin, click **Close claim**. Status → **Closed**.

---

## Part 7 — Permissions

**7.1** Sign in as **finance**. Open the claim. You should see the settlement
panel but **no decision panel and no workflow buttons**.

**7.2** Sign in as a client from a *different* business account and open the claim
URL directly. You should get **"Claim not found"** — a 404, never a 403.

**7.3** If you have an **HR** user, `/dashboard/claims` should refuse entirely.

---

## Part 8 — Appeal (use a second claim)

Raise another claim, take it to a decision, and **Reject** it.

**8.1** As client: no **Accept settlement** button (nothing to accept), but
**Appeal this decision** is present.

**8.2** Submit an appeal with a reason of 10+ characters. Status returns to
**Under review**.

**8.3** Try to appeal a second time → refused, one appeal only.

**8.4** Issue a revised decision. The staff panel should show "revision 2".

---

## Part 9 — Evidence and retention controls

All three now have buttons, in the staff review header under the workflow row.
They take their input through browser prompts, so they expect a checklist code
rather than a friendly name.

**9.1 — Waive a document.** Click **Waive a document**. Enter `PACKING_LIST`,
then a reason. Refresh the client's claim page — the packing list should read
**Waived** and stop blocking completion.

**9.2 — Request extra evidence.** Click **Request extra evidence**. Enter
`POLICE_REPORT` and a reason. **Police complaint or FIR** should appear on the
client's checklist as required, and the client should receive an email.

**9.3 — Legal hold.** Click **Place legal hold** with a reason. A red banner
appears reading "Under legal hold — evidence cannot be deleted". Run
`npm run job:claims:purge-expired`; the claim should be counted as skipped rather
than purged. Click **Lift legal hold** to clear it.

> Legal hold is admin-only on the server. As operations the button shows but the
> action is refused — that is deliberate, so operations can see a hold exists.

**9.4 — SLA timings.** Above the two columns there should be four figures: total
elapsed, Swiftline time, waiting on client, waiting on third party. Move a claim
to **Documents required**, wait a minute, refresh — "waiting on client" should
grow while "Swiftline time" holds steady.

**9.5 — Decision letter.** On a decided claim, click **Open decision letter** in
the staff panel. A PDF should open showing the claim number, claimed vs declared
vs approved, the reasons, and the appeal deadline. The client sees the same
document via **Download the decision letter** on their claim page.

---

## Part 9a — Queue filters

Back on `/dashboard/claims`:

- Type part of a claim or tracking number in the search box — it matches either,
  as a prefix
- **All types** narrows by claim category
- **Any outcome** narrows by approved / partly approved / rejected
- **Assigned to me** and **Unassigned** are mutually exclusive; ticking one
  unticks the other
- Confirm the table shows **Customer**, **Branch**, and **Handler** as names, not
  as long hexadecimal ids

---

## Part 10 — Background jobs

```bash
cd portal/backend

# Deadline reminders. Safe to run any time.
npm run job:claims:sweep-deadlines

# Retention purge. Reports only unless --apply is passed.
npm run job:claims:purge-expired
```

The purge should report zero — nothing is eight years old yet. If a claim is
under legal hold it will be counted as skipped rather than deleted.

---

## Part 11 — Insurance is gone

**11.1** **Dashboard → Country Rate Card → Route Charges.** There should be no
Insurance % or Insurance Minimum fields.

**11.2** Create a shipment cost estimate. No insurance line in the breakdown.

**11.3** Open a shared rate card. No insurance row in the terms.

Existing bookings are untouched — historical invoices keep whatever they had.

---

## What to report back

For anything that fails, the useful details are:

1. Which step number
2. What you expected and what happened
3. The failing request from devtools → Network (status code and response body)
4. The backend console output at that moment

---

## Known gaps — not bugs

Do not report these; they are unbuilt rather than broken:

- **No reporting or export.** Nothing summarises exposure, settlement totals, or
  SLA performance across claims. Deferred until you know what people search for.
- **Waive and request-evidence take checklist codes** through a prompt, not a
  friendly picker. Functional but blunt.
- **No date-range or amount-range filter** in the queue. Both are supported by the
  API; only the controls are missing.
- **Declaration wording is provisional**, recorded as `1.0-draft` pending Legal.
- **Carrier recovery window is a guess** at 21 days pending the DPD contracts.
