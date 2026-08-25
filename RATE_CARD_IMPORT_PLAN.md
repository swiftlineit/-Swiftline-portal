# Rate Card Excel Import - Implementation Plan

Upload a rate-list workbook (e.g. `SWIFTLINE ERUOPE RATELIST.xlsx`) on the Country Rate Card
screen and have it fill the rate card automatically: countries matched to ISO codes and flags,
existing countries updated in place, new countries added as new rows, and every imported country
available afterwards in the manual "add rate" country picker.

The rate card itself does not change. Uploading is a second way to write the same rows the
manual form already writes.

---

## 1. What the source file actually contains (verified)

`SWIFTLINE ERUOPE RATELIST.xlsx`, single sheet `Sheet1`, range `B1:H75`:

| Rows | Content |
| --- | --- |
| 1–2 | Company letterhead (merged cells) - ignored |
| 3–9 | Header block. Column B row 3 = `Weight`. Columns C–H are **zone columns**; each holds a *stack* of country names down rows 3–9 |
| 10 | Blank separator |
| 11–40 | Data. Column B = weight `1…30`, columns C–H = charge **per kg** at that weight |
| 41–74 | Terms and conditions prose - ignored for rates |

Six zone columns carry 30 header entries → **31 countries** once `SERBIA & MONTENEGRO` is split:

```
C: BELGIUM  FRANCE  GERMANY  LUXEMBOURG  NETHERLANDS
D: AUSTRIA  CZECH REPUBLIC  DENMARK  POLAND  SWITZERLAND
E: HUNGARY  LITHUANIA  SLOVAKIA  SLOVANIA
F: ESTONIA  ITALY  LATVIA  SPAIN  SWEDEN
G: BOSNIA  CROATIA  FINALND  LIECHENSTEIN  NORWAY  PORTUGAL  SERBIA & MONTENEGRO
H: IRELAND  ROMANIA  BULGARIA  GREECE
```

Every country in a zone column gets that column's 30 rates. **31 countries × 30 weights = 930
slab rows** per (band, service) from this one file.

Facts that drive the design:

- **The header spellings are dirty.** `SLOVANIA`, `FINALND`, `LIECHENSTEIN` are typos;
  `BOSNIA` is short for Bosnia and Herzegovina; `SERBIA & MONTENEGRO` is two countries in one
  cell. A name→ISO resolver is mandatory, and it must be allowed to say "I don't know".
- **The numbers are INR per kg**, despite the DPD surcharge notes lower down quoting Euro. The
  rate card has no currency field and prices in ₹ today; the import stores these as-is.
- **Only the rate grid is imported.** The terms block (fuel 15%, address correction, oversize)
  is free prose in a dozen inconsistent formats. Parsing it into `CountryRouteCharge` would be
  guessing. Route charges stay manual - see §8.

---

## 2. Decisions, with recommendations

These four shape the build. A recommendation is given for each; all are easy to flip before coding.

### 2.1 Weight rows → weight slabs

The sheet gives discrete weights (1, 2, 3 … 30); the model stores ranges (`fromKg`/`toKg`).
Pricing rounds chargeable weight **up to a whole kg** (`billableWeightKg` → `Math.ceil`), so a
row for weight *W* is the price for anything landing on *W*.

**Recommended mapping** - contiguous, non-overlapping, matching the convention the form already
suggests (`5.01-10`, `10.01-20`):

| Sheet row | fromKg | toKg | chargesPerKg |
| --- | --- | --- | --- |
| 1 | 0 | 1 | 2240 |
| 2 | 1.01 | 2 | 1340 |
| 3 | 2.01 | 3 | 998 |
| … | … | … | … |
| 30 | 29.01 | 30 | 525 |

### 2.2 `maxBoxKg`

Not a column in the sheet. The terms say "The box should not be more than 30 kgs", but that is
prose in row 43 and every rate list words it differently.

**Recommended:** default to the **heaviest weight row in the file** (30 here), shown and
editable in the upload dialog before commit. Robust, and it happens to agree with the terms.

### 2.3 Band and service

The sheet says neither. **Chosen in the upload dialog:** band defaults to the band currently
selected on the page; service is a required choice - `Courier`, `Cargo`, or `Both` (writes two
identical sets). No guessing from the filename.

### 2.4 Merge semantics - the one that matters

The ask is "if the country already exists, update its value; if not, create a new row". The
subtlety is what happens to slabs a route already has that the file does **not** cover - a
hand-tuned `5.01-10` would overlap the incoming `5.01-6`, `6.01-7`, and the model forbids
overlapping slabs.

**Recommended: replace-per-route.** For each (band, country, service) present in the file,
delete that route's existing slabs and insert the file's. Routes absent from the file are never
touched. This is the only option that keeps the non-overlap invariant true without silently
dropping rows, and it matches "the same rate card, just updated from the sheet".

The preview screen states this per country before anything is written:

```
Germany (DE) · Courier     12 existing slabs replaced by 30
Croatia (HR) · Courier     new country · 30 slabs added
```

*(Alternative considered - update rows whose `fromKg`/`toKg` match exactly, insert the rest,
leave the others alone - was rejected: it produces overlapping slabs, which the pricing engine
resolves by taking whichever it happens to find first.)*

---

## 3. Flow

Two-step **preview → commit**, the pattern the address-book import already uses
(`POST /imports/preview` then `POST /imports`). Nothing is written until the operator has seen
the country matches and the row counts.

```
   Upload .xlsx
        │
        ▼
  POST /api/v1/country-rate-cards/imports/preview   (multipart, file buffered in memory)
        │   parse grid · resolve country names · build slabs · diff against DB
        ▼
  Preview dialog
        │   • per country: matched ISO + flag, confidence, add/replace counts
        │   • unresolved or ambiguous names → operator picks from the country dropdown
        │   • band / service / maxBoxKg confirmed here
        ▼
  POST /api/v1/country-rate-cards/imports          (JSON: the resolved, reviewed rows)
        │   per route: acquire lock → delete existing slabs → insertMany → audit
        ▼
  Rate card table refreshes
```

The commit posts **the reviewed payload**, not the file. The operator's manual country
corrections are therefore what gets written, and re-parsing on commit cannot drift from what was
shown.

---

## 4. Country resolution

Names go through an ordered resolver. Each result carries a confidence the preview renders.

1. Split the cell on `&`, `/`, `,`, ` and ` → `SERBIA & MONTENEGRO` becomes two candidates.
2. Normalise: NFD, strip diacritics, lowercase, drop non-alphanumerics.
3. **Exact** name match → high confidence.
4. **Alias** table (small, explicit): `bosnia`→BA, `czechia`→CZ, `holland`→NL, `uk`→GB, …
5. **Prefix** match (`BOSNIA` → `Bosnia and Herzegovina`) → high confidence when exactly one
   country matches, otherwise ambiguous.
6. **Fuzzy** (Levenshtein): accepted only when the best distance is ≤ 2 **and** the runner-up is
   at least 2 further away. Verified against this file:

   | Header | Best match | Runner-up | Verdict |
   | --- | --- | --- | --- |
   | `FINALND` | Finland (2) | Iceland (4) | auto-matched |
   | `LIECHENSTEIN` | Liechtenstein (1) | Afghanistan (8) | auto-matched |
   | `SLOVANIA` | Slovakia (1) **and** Slovenia (1) | - | **needs review** |

7. Anything left → `needs review`, blocking commit until the operator picks a country.

`SLOVANIA` is the whole reason for step 7. A human reading the sheet sees Slovakia already in
the same column and concludes Slovenia; a matcher cannot, and quietly picking Slovakia would put
Slovak rates on the wrong lane. It gets surfaced, not guessed.

**Catalogue:** `defaultCountries` + `parseCountry` from `react-international-phone` - 218
countries with names and ISO-2 codes, already a dependency, and the same package supplying the
`FlagImage` the rate card already renders. No new dependency, no hand-maintained list, and flags
resolve for every code it can produce.

---

## 5. Widening the manual country picker

Today `rateCardCountryOptions` in the rate-card page is 16 shortlist countries + Poland +
`Other`, where `Other` searches the 34-entry `portalCountries`. Ireland, Croatia, Romania and
most of the imported set are in neither - so an imported country could not be edited by hand.

**Change:** build the picker's list from `defaultCountries` (all 218), with the existing
shortlist pinned to the top and a type-to-filter box, and drop the `Other` sub-flow that the
filter box replaces.

Scoped deliberately:

- `countryOptions` in `lib/branches.ts` is **not** touched - branch forms keep their shortlist.
- `portalCountries` is **not** touched - it is the address/geography list and is documented as
  needing to stay in sync with a backend copy.
- Backend `countryRatePayloadSchema` already accepts any `^[A-Z]{2}$`, so no server change is
  needed for the wider list.

The `getCountryName` / `findRateCardCountry` helpers gain the catalogue as a final fallback, so a
stored `HR` renders as "Croatia" rather than "HR".

---

## 6. Backend changes

### New - `backend/src/services/rateCardImport.service.ts`

Pure parsing and diffing, no DB writes, so it is unit-testable against the real file.

- `parseRateCardWorkbook(buffer)` - locates the `Weight` anchor cell rather than assuming B3, so
  a sheet with a different letterhead height still parses. Header block = anchor row through the
  last row before the first numeric weight; zone columns = every column right of the weight
  column; data rows = contiguous numeric weights.
- `resolveCountryName(name)` - §4, returns `{ iso2, name, confidence, candidates[] }`.
- `buildSlabs(weights, maxBoxKg)` - §2.1.
- Blank rate cells are skipped, not written as `0`.
- Guards: at least one zone column, at least one weight row, weights strictly ascending, rates
  finite and non-negative, at most 2000 slab rows per import.

### New - `backend/src/middleware/rateCardImportUpload.middleware.ts`

`createMemoryUpload({ field: "rateFile", maxBytes: 5MB, accept: [xlsx, xls, csv] })`, mirroring
`addressBookImportUpload.middleware.ts`.

### Controller - `countryRateCard.controller.ts`

- `previewRateCardImport` - parses, resolves, diffs against existing slabs for the target band
  and service, returns per-country counts and unresolved names. Writes nothing.
- `commitRateCardImport` - zod-validates the reviewed payload, then per route:
  `acquireRateCardRouteLock` → `deleteMany` that route's slabs → `insertMany` the new ones →
  release. Wrapped in `session.withTransaction` (the codebase already uses transactions in
  `claimDecision` and `creditAgreement`) so a failure part-way cannot leave a route with no
  rates. One `COUNTRY_RATE_CARD_IMPORTED` audit entry recording file name, band, service, and
  per-route added/replaced counts.

Bulk matters here: the existing create path runs one overlap query and one lock **per rate**. At
930 rows that is 930 round trips. The import validates overlap in memory (the slabs it generates
are contiguous by construction) and takes **one lock per route** - 31, not 930.

### Routes - `countryRateCard.routes.ts`

```ts
countryRateCardRouter.post("/imports/preview", rateCardImportUpload, previewRateCardImport);
countryRateCardRouter.post("/imports", commitRateCardImport);
```

Registered above the `/:id` handlers so `imports` is never read as a rate id. Inherits the
existing `requireRole("admin", "finance", "operations")` - the same people who can already add
rates by hand.

---

## 7. Frontend changes

### New - `components/rate-cards/RateCardImportDialog.tsx`

Modal following `ShareRateCardDialog`'s shell. Three states:

1. **Choose** - drag/drop or browse, plus band (prefilled), service (Courier / Cargo / Both) and
   max box KG (prefilled from the file).
2. **Review** - the country match table. Auto-matched rows show flag, name and ISO. Rows needing
   review show the raw header text and the country dropdown from §5; `Import` stays disabled
   while any remain. Per-country add/replace counts, and a total.
3. **Result** - countries imported, slabs written, and a plain sentence naming any country whose
   slabs were replaced.

### Changed - `app/dashboard/country-rate-card/page.tsx`

- `Import Excel` button beside `Export CSV`; opens the dialog; `refreshRates()` on success.
- `CountryRateSelect` rebuilt on the full catalogue with a filter box (§5).

### Changed - `lib/countryRateCards.ts`

`previewRateCardImport(file, options)` and `commitRateCardImport(payload)`, using the existing
`fetchWithAuth` / `parseApiResponse` helpers; `FormData` for the preview call as
`lib/addressBook.ts` does.

---

## 8. Risks and side-effects

| Risk | Handling |
| --- | --- |
| **The rate table gets long.** 930 rows in one band + service; the table has no paging or grouping and renders every visible rate. | Flagged, not silently absorbed. Suggest a collapsible group-by-country row in the same change; happy to defer, but the screen will be unwieldy at this volume. |
| **Imported countries are not automatically bookable.** `checkServiceability` needs a `SwiftlineRoute` per country as well as rates; without one it reports "No route is configured for this destination yet". | Result screen names the imported countries that have no route, linking to Swiftline Routes. The import does **not** create routes - inventing transit times is worse than saying they are missing. |
| **Replace-per-route discards hand-tuned slabs.** | Counts shown per country before commit; full before/after in the audit log. |
| **Currency.** Values are INR; the sheet's Euro notes apply to DPD surcharges, not this grid. The model has no currency field. | Stored as-is. If a Euro-denominated list is ever uploaded the numbers would be wrong - worth a currency field later, out of scope here. |
| **Terms block ignored.** Fuel 15%, address correction, oversize, handling. | Stated on the result screen: "Route charges (fuel, remote area, handling) were not imported - set them in Route Charges." |
| **A second layout.** The parser targets this shape (weight column plus stacked country headers). | Anchor-based detection tolerates letterhead height and column shifts; a genuinely different layout fails with "Could not find a Weight column", not a wrong import. |

---

## 9. Tests

`backend/src/tests/rateCardImport.test.ts` (new), alongside `rateCard.integration.test.ts`:

- Parses the real `SWIFTLINE ERUOPE RATELIST.xlsx` → 6 zones, 30 weight rows, 31 countries.
- `SERBIA & MONTENEGRO` yields RS and ME, both with the zone's rates.
- `FINALND`→FI and `LIECHENSTEIN`→LI auto-match; **`SLOVANIA` comes back as needs-review**, not
  silently Slovakia.
- Slab boundaries: row 1 → `0–1`, row 2 → `1.01–2`, row 30 → `29.01–30`; no overlaps.
- Malformed inputs: no `Weight` column, no data rows, non-numeric rates, blank cells.
- Commit is idempotent - importing the same file twice leaves 30 slabs per route, not 60.
- Commit replaces only the routes in the file; an untouched country's slabs survive.
- Round trip: import → `calculateShipmentPricing` for a 5 kg Belgian courier parcel returns
  795/kg.

Run with `npm test` in `portal/backend`.

---

## 10. File checklist

**New**
- `backend/src/services/rateCardImport.service.ts`
- `backend/src/middleware/rateCardImportUpload.middleware.ts`
- `backend/src/tests/rateCardImport.test.ts`
- `frontend/src/components/rate-cards/RateCardImportDialog.tsx`

**Changed**
- `backend/src/controllers/countryRateCard.controller.ts` - preview and commit handlers
- `backend/src/routes/countryRateCard.routes.ts` - two routes above `/:id`
- `frontend/src/app/dashboard/country-rate-card/page.tsx` - Import button, wider country picker
- `frontend/src/lib/countryRateCards.ts` - two client functions

**Not changed** - `countryRateCard.model.ts`, `shipmentPricing.service.ts`, `lib/branches.ts`,
`lib/portalCountries.ts` and its backend copy.
