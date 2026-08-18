# Public shipment tracking at `/track`

## Context

Today tracking is only reachable behind a session: `/dashboard/tracking` (staff) and
`/client/tracking` (client), both rendering
[ShipmentTrackingPage.tsx](frontend/src/components/shipments/ShipmentTrackingPage.tsx)
against authenticated endpoints. The **consignee**- the person who actually owns the
parcel- has no Swiftline account and no way to see where their shipment is. They
currently have to ring the shipper, who rings Swiftline.

We want a page a consignee can open with nothing but the AWB printed on the label, at
a URL that ranks for "swiftline cargo tracking".

### Decisions taken

| | |
|---|---|
| Gating | **Single tier.** A valid AWB returns the full public card- status, route, origin, destination city, pieces, weight, journey rail, and the event timeline including notes. No second factor. |
| URLs | `/track` indexed and ranks; `/track/<AWB>` shareable but `noindex` + canonical → `/track`. |
| Domain | `swiftlineportal.com/track` (same Next app). |
| Route strip | Country-level (`India → United Kingdom`) from data that already exists. No gateway/airport codes. |
| Journey rail | The existing 8-stage `ShipmentJourney`, reused unchanged. |
| Entry point | "Track shipment" button in the booking-confirmation email. |

### The enumeration trade-off, accepted deliberately

Swiftline AWBs are sequential and guessable.
[swiftlineTracking.service.ts:41](backend/src/services/swiftlineTracking.service.ts#L41)
generates `SLC` + 3-letter station + `DDMMYY` + a 3-digit per-station daily counter-
`SLCDEL170826001`. ~999 requests walks an entire station-day.

The decision is to show the full card anyway, on the grounds that **everything on it is
already printed on the label the consignee is holding**, and the event notes are already
customer-facing. What changes is the audience, not the classification.

Two consequences follow, and the build must honour both:

1. **The `customerVisible: true` filter on events is load-bearing.** It is the only
   thing separating an operator's public note from an internal one. Never relax it, and
   never reuse the admin path, which queries events with no such filter.
2. **The never-expose list in §3 is absolute.** Widening the visible set to the label's
   contents is a decision about the label's contents- it is not licence to include
   addresses, contact details, declared values, KYC or pricing, none of which the
   consignee's copy of the label carries either.

### This change is read-only. Nothing about the data changes.

- **AWB format is untouched.** `SLCDEL170826001` keeps its `SLC` + station + `DDMMYY` +
  daily-counter shape. `swiftlineTracking.service.ts` and
  `swiftlineStationCounter.model.ts` are not modified. Labels, manifests and scanning
  keep resolving against the same numbers they do today.
- **No schema changes.** No new fields, no new collections, no indexes, no migration,
  no backfill. Notably this is why the route strip is country-level: `SwiftlineRoute`
  stores `originCountryCode` / `destinationCountryCode` as 2-letter codes
  ([swiftlineRoute.model.ts:82-93](backend/src/models/swiftlineRoute.model.ts#L82-L93))
  and has no gateway or airport field. `DEL → LHR` would require inventing one.
- **No writes on the public path- and this needs care.** The *client* tracking path
  writes on read: [client.controller.ts:1121](backend/src/controllers/client.controller.ts#L1121)
  calls `ensureClientShipmentBookedEvent`, which upserts a `SHIPMENT_BOOKED` row into
  `ShipmentEvent` and stamps `createdBy` with the viewing user's id. A public visitor
  has no user id. **The public controller must never delegate to
  `getClientShipmentDetails`**- building it standalone (§2) is what keeps this safe,
  not an accident of structure.
- **No view tracking.** The public rate-card endpoint increments a counter via
  [recordPublicShareView](backend/src/services/rateCardShare.service.ts#L243). We are
  deliberately not copying that. No `publicViewCount`, no `lastTrackedAt`, no analytics
  rows- a tracking lookup leaves nothing behind.

The only non-code additions anywhere are one optional env var
(`NEXT_PUBLIC_SITE_URL`, §8) and a button in one email template (§9).

---

## Backend

### 1. Shared resolver (extract, don't duplicate)

[client.controller.ts:1181-1196](backend/src/controllers/client.controller.ts#L1181-L1196)
already resolves a typed number against `DpdShipment.{dpdShipmentId,
swiftlineTrackingNumber, parcelNumbers}` plus a `LabelDocument.parcelNumber` fallback.
Lift that block verbatim into
`portal/backend/src/services/shipmentTracking.service.ts` as
`resolveShipmentByTrackingNumber(trackingNumber)` → `{ shipmentDraftId } | null`, and
have `trackClientShipment` call it. One implementation, so the public and client
lookups can never drift on what counts as a valid reference.

### 2. New controller- `portal/backend/src/controllers/publicTracking.controller.ts`

`trackPublicShipment(request, response)` for `GET /api/v1/public/tracking/:trackingNumber`

1. **Validate the format before touching Mongo.** The client path only checks
   `length <= 80` and then escapes the input into a case-insensitive regex. A public
   endpoint should reject anything unshaped before it reaches that regex.

   **Corrected during implementation.** The plan originally specified
   `/^SLC[A-Z]{3}\d{9}(-\d{2})?$/i`, matching today's generator. Live data proved that
   wrong: shipments booked earlier carry `SLDL20072026000001`, and their pieces were
   numbered by the carrier as `DPDTESTDL2107202600000401`. That pattern would have
   rejected every shipment already on the books. The guard shipped as a charset-and-
   length check instead, `/^[A-Z0-9][A-Z0-9-]{10,39}$/i`, which still refuses injection
   payloads and still excludes operations manifests (`SLC001`) and MHBS bags
   (`SLC01201`) - both top out around eleven characters.
2. `resolveShipmentByTrackingNumber` → 404 on miss, with one uniform message:
   `"No shipment was found for that tracking number."`
3. Load the draft, its `DpdShipment`, and events filtered
   `{ customerVisible: true }`- the same filter the client path uses at
   [client.controller.ts:1136](backend/src/controllers/client.controller.ts#L1136).
   Do **not** reuse the admin path, which loads events with no `customerVisible`
   filter at all. See the note in the context section: this filter is load-bearing.
4. Reuse `buildDeliveryEstimate`, `buildTrackingAttention` and `buildTrackingSummary`
   from [shipmentTracking.service.ts](backend/src/services/shipmentTracking.service.ts)
   unchanged. With a single tier, `buildTrackingSummary` is now wanted in full- it
   supplies pieces, both weights, `carrierName`, service and `lastUpdateAt`, which is
   most of the header strip.
5. Look up the lane with `findRoute({ destinationCountryCode, service })` from
   [swiftlineRoute.service.ts](backend/src/services/swiftlineRoute.service.ts) to fill
   the route strip. A lane with no route configured yields `null`- render the strip
   from the draft's own country codes rather than hiding it.

`buildTrackingAttention` returns copy written for a logged-in client- *"Upload it on
the shipment page"*, *"Settle it to release the shipment"*- which is meaningless to a
consignee with no account. Emit `{ label, holdReason }` with public copy instead
("This shipment is on hold- the sender has been notified"), keeping the original
`detail` for the two authenticated pages.

### 3. `serializePublicTracking`

```
trackedNumber, isParcelLevel, trackingNumber,   // shipment-level AWB
status, statusLabel,
serviceType, serviceCode, carrierName,
pieces, actualWeightKg, chargeableWeightKg,
originStationCode,                              // the AWB's own station segment
originCity, originCountryName,                  // consignor snapshot; always India
destinationCity, destinationCountryCode, destinationCountryName,
bookedAt, lastUpdateAt,
deliveryEstimate,
attention,                                      // public copy, see §2
events: [{ status, statusLabel, eventAt, location, note }]
```

**Never expose, whatever the tier:** address lines, origin postcode, destination
postcode, email, mobile, Aadhaar, `kycDocuments`, `declaredGoodsValueMinor`, `items[]`,
HS codes, `contentsDescription`, `bookingConfirmation`, `taxInvoiceNumber`, any
`*AmountMinor`, `branch`, `labels[]`, `idempotencyKey`, `dpdShipmentId`,
`dpdTransactionId`, `paymentSource`, `addressValidationStatus`, `csbType`.

Write this list into the file as a comment above the serialiser. It is the one place a
future edit is likely to widen by accident.

### 4. Router- `portal/backend/src/routes/publicTracking.routes.ts`

Copy the shape of
[rateCardShare.routes.ts:30-41](backend/src/routes/rateCardShare.routes.ts#L30-L41)
exactly, including its comment style: a standalone `Router` that deliberately never
calls `attachUser`, so it cannot inherit a gate by accident.

Mount in [app.ts](backend/src/app.ts#L129) directly beneath the existing public
rate-card line:

```ts
// Session-free by design: the consignee owns the parcel but has no portal account.
app.use("/api/v1/public/tracking", publicTrackingRouter);
```

### 5. Rate limiter

Add `publicTrackingLimiter` to
[rateLimit.middleware.ts](backend/src/middleware/rateLimit.middleware.ts).
It must be materially tighter than `publicRateCardLimiter`, whose own comment justifies
30/min on the grounds that its token carries 256 bits of entropy- reasoning that does
not transfer to `SLCDEL170826001`, and which matters more now that a hit returns the
full card.

- 15/min and 120/hour per IP in production (two stacked limiters), generous multiples
  in dev, matching the existing `env.NODE_ENV === "production" ? x : y` idiom.
- JSON envelope message, `standardHeaders: true`- every limiter in this file already
  does this so browser clients don't mistake a 429 for a dead session.

**Known limitation to write into the comment:** `express-rate-limit` here uses the
default in-memory store with no Redis, so counters are per-process. Behind more than
one backend instance the effective ceiling multiplies. With a single tier this limiter
is the *only* brake on bulk harvesting, so if the portal ever scales past one backend
instance, a shared store becomes a real requirement rather than a nicety.

`app.set("trust proxy", 1)` is already correct for the single nginx hop.

---

## Frontend

### 6. Extract `TrackingResult`

`ShipmentTrackingPage.tsx` is 731 lines of fetching *and* presentation, with the
presentation half (journey, status card, facts grid, timeline, details aside) being
close to what the public page needs. Copying it would fork the tracking UI in two-
the precise drift the header comment on `shipmentTracking.service.ts` was written to
end.

Extract `portal/frontend/src/components/shipments/TrackingResult.tsx` taking a
`TrackingRecord`-shaped prop, and render it from both `ShipmentTrackingPage` and the
new public page. Drive the auth-only chrome off props:

- `detailsHref`- omit on public, hiding the "Open Shipment Details" button
- `branchName`- absent on public (internal routing detail)
- `consigneeName`- absent on public; the status card's heading falls back to the AWB

Everything else in the existing layout is now shared, since the public tier shows
weights, destination city, parcel numbers and event notes.

`ShipmentJourney`, `EstimatedDelivery` and `ActionRequiredChip` from
[ShipmentJourney.tsx](frontend/src/components/shipments/ShipmentJourney.tsx) are
reused **unchanged**, keeping the existing 8 stages. Its header comment explains why
that matters: stages come from the operational status ladder so the rail can never
claim a step the event history does not have. A stage like "Due for Delivery Today"
has no backing status and would break that guarantee.

Keep the extraction mechanical: move the JSX, change nothing about it, so the staff
and client pages render identically to today.

### 6b. The header strip

New to this design, so it goes in `TrackingResult` as an optional top band:

| Cell | Source |
|---|---|
| Current status | latest event `statusLabel`, plus its `location` as the subline |
| Route | `India → United Kingdom` from `originCountryCode` / `destinationCountryName`, with `serviceType` as the subline |
| Origin | station code parsed from the AWB (`SLC` **`DEL`** `170826001`), city + country from the consignor snapshot |
| Destination | `destinationCity`, `destinationCountryName` |
| Pieces / weight | `summary.pieces`, `summary.actualWeightKg` |

Two things deliberately not rendered: **airport codes** (`LHR` has no source- see the
read-only section) and any stage caption invented for the mockup. Where the mockup
shows a per-stage sub-caption, use the stage's own timestamp, as the rail already does.

Also: the mockup labels a stage **"Reached at DPD Hub"**. DPD is legacy naming retained
only because it is written into existing rows- there is no live DPD integration. It
must not appear on a public page. The existing rail calls this "Destination Hub".

### 7. Routes

No `middleware.ts` exists in this app and no route group does either- auth is enforced
per page by `useAdminUser` / `useClientUser`. A public route is therefore simply a
top-level directory that omits the hook, exactly as
[rate-card/[shareId]](frontend/src/app/rate-card/[shareId]/page.tsx) already does.

**`src/app/track/layout.tsx`**- standalone public shell: logo header, minimal footer,
no sidebar. Model on the existing `PublicRateCardShell`.

**`src/app/track/page.tsx`**- server component, indexed. This is the page that ranks,
so it needs real crawlable content, not just an input:

- `<h1>Track your Swiftline Cargo shipment</h1>`
- a small `"use client"` `PublicTrackingForm` that **navigates** to `/track/<AWB>`
  rather than fetching in place- that is what makes results linkable
- explanatory copy: where to find the AWB, what the `SLCDEL170826001` format means,
  what each of the 8 journey stages means
- an FAQ section
- `export const metadata` with title, description, `alternates.canonical: "/track"`
- JSON-LD (`WebSite` + `FAQPage`) via an inline `<script type="application/ld+json">`.
  There is currently zero structured data in the repo, so this is net-new.

**`src/app/track/[trackingNumber]/page.tsx`**- server component.

- `generateMetadata` → title `Track SLCDEL170826001- Swiftline Cargo`,
  `robots: { index: false, follow: false }`, `alternates.canonical: "/track"`.
  Per-shipment pages are thin, transient and enumerable; letting Google archive them
  would put consignee data into search results permanently. This matters more under a
  single tier, not less.
- Fetch server-side from `NEXT_PUBLIC_API_URL` with `cache: "no-store"`, so a forwarded
  link renders with data on first paint and works with JS off.
- Renders `TrackingResult`. No postcode form- the single-tier decision removes it.
- **Check the docs first.** `portal/frontend/AGENTS.md` warns this Next version differs
  from training data; `params` is a Promise here. Read `node_modules/next/dist/docs/`
  for the App Router metadata and params APIs before writing this file.
- Skip JSON-LD here- `ParcelDelivery` markup buys nothing on a `noindex` page.

### 8. SEO plumbing (all net-new)

- **`src/app/robots.ts`**- add `sitemap: "…/sitemap.xml"`. Do **not** add a
  `disallow` for `/track/`: a robots block would stop Google from ever reading the
  `noindex` on result pages. The `noindex` meta is the correct instrument.
- **`src/app/sitemap.ts`**- new, static: `/`, `/track`, `/privacy-policy`.
- **`NEXT_PUBLIC_SITE_URL`**- `https://swiftlineportal.com` is currently hardcoded in
  [layout.tsx:8](frontend/src/app/layout.tsx#L8) and
  [robots.ts:12](frontend/src/app/robots.ts#L12), and this change adds two more
  uses (sitemap, canonicals). Hoist it to one env-backed constant now, before it is in
  four places.

### 9. Email entry point

In `shipmentBookedClientTemplate`
([shipmentBooked.ts:70](backend/src/services/email/templates/shipmentBooked.ts#L70)),
add a second button beside "View shipment":

```ts
{ kind: "button", label: "Track shipment", url: toAbsoluteUrl(appUrl, `/track/${trackingNumber}`) }
```

`appUrl` already resolves from `CLIENT_URL`. Note this email goes to the **booker**,
not the consignee- so word the accompanying `note` block as a link they can forward
("Share this link with your consignee- it needs no sign-in"). Leave
`shipmentBookedStaffTemplate` alone.

---

## Verification

1. **Backend, no session.** With the dev server up:
   `curl http://localhost:5000/api/v1/public/tracking/SLCDEL170826001`- confirm the
   full card comes back with no cookie or `Authorization` header.
2. **Nothing leaked.** Diff the response keys against the never-expose list in §3:
   `curl … | jq 'paths(scalars) | join(".")'`, then eyeball for `postcode`, `email`,
   `mobile`, `aadhaar`, `Minor`, `hsn`, `kyc`, `idempotency`, `branch`, `invoice`.
   This is the check that matters most now that the tier split is gone.
3. **Internal events stay internal.** Record an event with `customerVisible: false`
   via the staff status-event endpoint, then hit the public URL- it must not appear,
   and neither must its note.
4. **Format guard.** `…/tracking/SLC001` and `…/tracking/%7B%22%24ne%22%3Anull%7D`
   both 400 without a DB query.
5. **Held shipment.** Put a shipment `ON_HOLD` with reason `payment_issue`, then hit
   the public URL- confirm the generic hold copy appears, not the client-portal
   "Settle it to release the shipment" text.
6. **Route strip.** Track a shipment on a lane with a configured `SwiftlineRoute` and
   one without. Both must render a route strip; the second falls back to the draft's
   own country codes rather than collapsing. No airport codes anywhere in the output.
7. **Rate limit.** Loop 25 requests in a minute against the dev limiter's production
   numbers and confirm a JSON-enveloped 429.
8. **No regression on the two existing pages.** `/dashboard/tracking` and
   `/client/tracking` must render as before the `TrackingResult` extraction- check
   the facts grid filler cells, the parcel-level banner, the 8-stage rail, and the
   "Open Shipment Details" button in both.
9. **SEO.** `curl http://localhost:3000/track` → `<title>`, canonical, JSON-LD present.
   `curl http://localhost:3000/track/SLCDEL170826001` → `<meta name="robots"
   content="noindex, nofollow">` and canonical pointing at `/track`. Fetch
   `/robots.txt` and `/sitemap.xml` and confirm they agree.
10. **JS off / cold link.** Load `/track/<AWB>` with JavaScript disabled- the status
    and timeline must still render, proving the server fetch works and a forwarded
    link is useful.
11. **Nothing was written.** The load-bearing check for the read-only claim. Record
    `db.shipmentevents.countDocuments()` and the target draft's `updatedAt`. Hit
    `/track/<AWB>` twenty times, including for a shipment that has no
    `SHIPMENT_BOOKED` event yet- the case that would tempt
    `ensureClientShipmentBookedEvent` into firing. Both figures must be unchanged.
12. **Email.** Trigger a booking in dev and confirm the "Track shipment" button
    resolves to `<CLIENT_URL>/track/<AWB>`.
