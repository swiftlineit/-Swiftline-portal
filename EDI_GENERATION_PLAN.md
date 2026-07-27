# EDI Generation — Final Field Mapping & Implementation Plan

Status: **plan approved by product answers. No code written yet.**
Reference files analysed: `MANIFEST  SLC-012.xlsx`, `EDI RUN SLC012.xls`.

### Decisions locked (this revision)
1. **Aadhaar** is captured in consignor details (`consignorAddress.aadhaarNumber`, or per-parcel `parcel.aadhaarNumber`) → `GSTINNumber` is unblocked.
2. **HAWB** = the Swiftline **parcel barcode** (`swiftlineParcelNumber`, e.g. `SLCDEL17072026001-01`).
3. **One EDI row per parcel** (not per consignment).
4. **Restricted goods** are **blocked at data entry** with an error toast — *not* scrubbed in the EDI. See §4.6.
5. **Consignor state** now comes from the new consignor details.
6. Output is **`.xls` (BIFF8)**.
7. **`ADCode`** column stays **empty**.

---

## 1. What the two files are (unchanged from analysis)

- **Manifest** (`.xlsx`): one sheet, a header block (rows 1–13), headings on row 14, then 63 consignment blocks of **variable height** (8/9/10/22 rows) with address lines stacked vertically in cols E/F.
- **EDI** (`.xls`, BIFF8): flat table, headers on row 1, **36 columns A→AJ**, 63 data rows, one per consignment *in this sample because every consignment had exactly one parcel*. `Sheet2` is an empty artifact — do not reproduce it.
- **Join:** 63↔63, 1:1, no orphans. All scalar/name/constant/ID columns match 63/63. Per-row **addresses past row ~3 are scrambled test data** and are not used to derive rules.

---

## 2. Final field mapping (36 columns)

Row grain = **one parcel**. "Consignment" fields repeat across a consignment's parcel rows; "parcel" fields differ per row. `SRC`: **DB-snap** = sealed manifest snapshot · **DB-live** = live `ShipmentDraft` (needed for the full Aadhaar only) · **CALC** = derived · **CONST** = fixed.

| # | EDI column | SRC | Origin | Grain | Transformation |
|---|---|---|---|---|---|
| 1 | `MAWBNumber` | DB-snap | `header.mawbNumber` | header | trim, uppercase; on every row |
| 2 | `HAWBNumber` | DB-snap | parcel `swiftlineParcelNumber` | **parcel** | uppercase; the scanned barcode incl. `-NN` suffix |
| 3 | `ConsignorName` | DB-snap | `consignor.contactName` ?? `companyName` | consignment | trim |
| 4 | `ConsignorAddress1` | DB-snap | `consignor.addressLine1` | consignment | `ediAddressLine` (trim + strip trailing comma) |
| 5 | `ConsignorAddress2` | DB-snap | `consignor.addressLine2` | consignment | `ediAddressLine`, `""` when absent |
| 6 | `ConsignorCity` | DB-snap | `consignor.townOrCity` | consignment | trim |
| 7 | `ConsignorState` | DB-snap | `consignor.county` | consignment | **Title Case** (`PUNJAB`→`Punjab`, `UTTAR PRADESH`→`Uttar Pradesh`) |
| 8 | `ConsignorPostalCode` | DB-snap | `consignor.postcode` | consignment | force **text** |
| 9 | `ConsignorCountry` | CALC | `consignor.countryCode` (always `IN`) | consignment | ISO-2 → UPPER full name → `INDIA` |
| 10 | `ConsigneeName` | DB-snap | `consignee.companyName` ?? `contactName` | consignment | trim |
| 11 | `ConsigneeAddress1` | DB-snap | `consignee.addressLine1` | consignment | `ediAddressLine` |
| 12 | `ConsigneeAddress2` | DB-snap | `consignee.addressLine2` | consignment | `ediAddressLine`, `""` when absent |
| 13 | `ConsigneeCity` | DB-snap | `consignee.townOrCity` | consignment | trim |
| 14 | `ConsigneeState` | DB-snap | `consignee.county` | consignment | **Title Case**, `""` when absent |
| 15 | `ConsigneePostalCode` | DB-snap | `consignee.postcode` | consignment | force text |
| 16 | `ConsigneeCountry` | CALC | `consignee.countryCode` (fallback name) | consignment | ISO-2 → UPPER full name (`GB`→`UNITED KINGDOM`, `DE`→`GERMANY`, `GR`→`GREECE`, `US`→`UNITED STATES OF AMERICA`, …) |
| 17 | `PKG` | CONST | — | parcel | `1` (one parcel per row) |
| 18 | `Weight` | DB-snap | parcel `weightKg` | **parcel** | number, ≤3 dp |
| 19 | `DescriptionofGoods` | DB-snap | parcel `contentsDescription` | **parcel** | trim only — **no scrub** (restricted items can't reach the DB, §4.6) |
| 20 | `Value` | DB-snap | `declaredValueMinor / 100` | consignment→first parcel row | number; see §4.8 |
| 21 | `ExportInvoiceNo` | CALC | = `HAWBNumber` | parcel | one shared rule (§4.9) |
| 22 | `GSTInvoiceNo` | CALC | = `HAWBNumber` | parcel | same rule as #21 |
| 23 | `InvoiceValue` | CALC | = `Value` | consignment→first row | number |
| 24 | `CurrencyType` | CONST | — | row | `INR` |
| 25 | `PayType` | CONST | — | row | `N` |
| 26 | `IGSTPaid` | CONST | — | row | `0` (numeric) |
| 27 | `Bond` | CONST | — | row | `NA` |
| 28 | `MHBSNo` | DB-snap | parcel's `bagNumber` | **parcel** | direct — `formatOperationsBagNumber` already emits `SLC01201`-style |
| 29 | `GSTINType` | CONST | — | row | `Aadhaar Number` |
| 30 | `GSTINNumber` | **DB-live** | parcel `aadhaarNumber` ?? shared `consignorAddress.aadhaarNumber` | parcel | 12-digit **numeric**; full value read live (§3.1) |
| 31 | `GSTDate` | DB-snap | `header.departureDate` | header | `yyyy-MM-dd` → `d/M/yyyy` **text**, no leading zeros |
| 32 | `ExportDate` | DB-snap | `header.departureDate` | header | same as #31 |
| 33 | `ADCode` | CONST | — | row | **empty** |
| 34 | `CRN_NO` | CALC | = `HAWBNumber` | parcel | direct |
| 35 | `CRN_MHBS_NO` | CALC | = `MHBSNo` | parcel | direct |
| 36 | `FOB_Value` | CALC | = `Value` | consignment→first row | number |

**Manifest fields with no EDI counterpart:** `S.No`, `Service Info`, flight number, IATA codes, total bags/weight, value type, FROM/TO agent blocks.

---

## 3. Missing-data list — all resolved

### 3.1 `GSTINNumber` (Aadhaar) — ✅ resolved, with one constraint
Source: `parcel.aadhaarNumber` when `kycUseForAllParcels === false`, else the shared `consignorAddress.aadhaarNumber`. Stored as 12 digits.
**Constraint:** the booking **and sealed snapshots redact the Aadhaar** (`maskAadhaarNumber` → `XXXX XXXX 1234`) by design. The EDI needs the full number, so the generator reads it **from the live `ShipmentDraft`** (via `consignment.shipmentDraftId`) at generation time. This is the *only* field EDI reads outside the sealed snapshot, and it keeps redaction intact everywhere else. Never copy the full Aadhaar into the sealed snapshot.

### 3.2 `GSTINType` — ✅ constant `"Aadhaar Number"` (all senders are Aadhaar-KYC individuals).
### 3.3 `ADCode` — ✅ leave empty (no schema change).
### 3.4 `ConsignorAddress2` — ✅ `consignorAddress.addressLine2` now exists.
### 3.5 `ExportInvoiceNo` / `GSTInvoiceNo` — ✅ = `HAWBNumber` (matches sample), single rule.
### 3.6 Consignor state — ✅ `consignorAddress.county`.
### 3.7 Restricted goods — ✅ moved to input validation (§4.6).

Nothing is blocking. No new persisted schema fields are required for the EDI itself.

---

## 4. Transformation rules

Each is a pure, unit-tested function.

- **4.1 `ediText`** — null/undefined→`""`, numbers→string, trims. Never emits null.
- **4.2 `ediAddressLine`** — `ediText` + strip one trailing comma (`"AMUNPUR 31, "`→`"AMUNPUR 31"`); internal commas kept.
- **4.3 `titleCaseState`** — per-word title case; verified `PUNJAB→Punjab`, `UTTAR PRADESH→Uttar Pradesh`, `MANCHESTER→Manchester`; already-cased passes through.
- **4.4 `ediCountryName`** — ISO-3166 alpha-2 → **UPPERCASE** full name (`IN→INDIA`, `GB→UNITED KINGDOM`, `DE→GERMANY`, `GR→GREECE`, `US→UNITED STATES OF AMERICA`). New lookup `reference/countryNames.ts` (none exists today).
- **4.5 `ediDate`** — `yyyy-MM-dd`→`d/M/yyyy` **text**, no zero padding (`2026-07-17`→`17/7/2026`). Distinct from the manifest's `dd-MM-yyyy` helper — do **not** reuse it.
- **4.7 Cell types** — numeric: `Weight`, `Value`, `InvoiceValue`, `FOB_Value`, `PKG`, `IGSTPaid`, `GSTINNumber`. Everything else text, including postal codes and both dates.

### 4.6 Restricted goods → **blocked at entry, not scrubbed in EDI**
Add a shared restricted-items guard on `contentsDescription`. On entry (frontend) a match raises an **error toast: "This item is restricted."** and blocks save; the backend rejects the same in `validateParcel`. Because restricted items can never enter the DB, the EDI `DescriptionofGoods` is emitted **verbatim** (no removal logic). The sample's `GHEE`/`COSMETIC ITEAM` removals are ignored — they were manual edits and are not on this list.

Categories (each maps to a keyword set in config `restrictedGoods.ts`, case-insensitive, word/substring match):
Alcohol/Liquor · Tobacco/Nicotine/Vape · Cash/Currency · Gold/Silver/Precious Metals · Gems/Diamonds · Arms/Ammunition/Weapons · Explosives/Fireworks · Flammable Items · Dangerous Chemicals · Poison/Toxic Material · Prescription Medicines · Narcotics/Drugs · Live Animals · Plants/Seeds · Pornographic Material · Counterfeit Goods · Loose battery/Power bank · Perishable fresh food · Human remains/Ashes.

One list, imported by both frontend (toast) and backend (reject) so the two never drift.

### 4.8 Value across a consignment's parcel rows
Declared value is per-consignment. Following the manifest's existing convention, `Value`/`InvoiceValue`/`FOB_Value` are populated on the **consignment's first parcel row** and left **empty on its other parcel rows**, so a multi-parcel shipment is never counted twice and EDI totals reconcile with the manifest. (All sample consignments are single-parcel, so this is invisible there.) Adjustable via one flag if customs wants the value repeated.

### 4.9 Column identity rules
`ExportInvoiceNo = GSTInvoiceNo = CRN_NO = HAWBNumber` and `CRN_MHBS_NO = MHBSNo` and `InvoiceValue = FOB_Value = Value` are expressed as **references to the resolved column**, defined once, so a change propagates.

### 4.10 File format
BIFF8 `.xls` via the already-installed `xlsx@0.18.5` (`bookType:"biff8"` — verified round-trips cleanly). ExcelJS cannot write `.xls`; it stays on the manifest. No new dependency.

---

## 5. Why the EDI is built from data, not from the Manifest Excel
Variable block heights, `uniqueLines()` de-duplication that is irreversible, redacted Aadhaar, and 5 EDI columns that were never in the manifest — all mean the manifest file cannot be a source. The EDI generator receives a **normalized object**, never a workbook.

---

## 6. Architecture & refactoring

### 6.1 Target
```
OperationsManifest.sealedSnapshot (v2 — structured parties + parcel barcodes)
                 │
                 ▼
   buildManifestDocumentModel()      ← SHARED SHIPMENT DATA BUILDER → NormalizedManifestDocument
     ┌───────────┼───────────────────────────────┐
     ▼           ▼                                 ▼
 Manifest Excel  Manifest PDF          EDI Excel (xlsx/biff8, driven by EDI_COLUMNS)
 (ExcelJS)       (PDFKit)              + live Aadhaar lookup for GSTINNumber
```
The EDI generator consumes a `NormalizedManifestDocument` (per-parcel rows) plus a small live-data side-channel for the full Aadhaar.

### 6.2 Refactors (in order)
| # | Change | File | Risk |
|---|---|---|---|
| R1 | `buildManifestLine` returns structured `consignor.party` / `consignee.party` (from `snapshot.consignor` — the new per-shipment consignor, incl. `county` state — and the consignee) beside the existing `formatted`. No new DB reads. | `shipmentManifest.service.ts` | Low, additive |
| R2 | Persist `party` on `consignorSnapshot`/`consigneeSnapshot` (already `Mixed` — no migration). | `operationsManifestConsignment.model.ts` | None |
| R3 | Ensure the manifest consignor is sourced from the **new consignor details** (with state), not the business account. Changes manifest output → **needs sign-off**. | `shipmentManifest.service.ts` | Medium |
| R4 | Sealed snapshot → `version: 2`; keep each parcel's `swiftlineParcelNumber` + `bagNumber` (barcode already flows via scans). Readers accept v1 and v2. | `operationsManifest.service.ts` | Low |
| R5 | Extract `buildManifestDocumentModel()`; move `sealedParcelRows` + first-row-value rule into it. | new `manifestDocument.service.ts` | Medium |
| R6 | Repoint Excel + PDF at the model; delete the `as never` cast. Output must stay byte-identical. | `operationsManifest.service.ts` | Medium |
| R7 | Backfill `party` + parcel numbers onto v1 sealed manifests from the still-present `DpdShipment`/draft data; EDI 409s cleanly until then. | new script | Low |

### 6.3 New: restricted-goods guard (independent of the EDI)
`restrictedGoods.ts` (shared list + `findRestrictedTerms(description)`), wired into backend `validateParcel` and the frontend description inputs (toast). Ships on its own.

---

## 7. Folder structure
```
portal/backend/src/
├── types/manifestDocument.ts                 NEW  NormalizedManifestDocument / ParcelRow / PartySnapshot
├── services/
│   ├── manifestDocument.service.ts           NEW  ★ shared builder
│   ├── shipmentManifest.service.ts           EDIT R1, R3
│   ├── operationsManifest.service.ts         EDIT R4, R6
│   ├── reference/countryNames.ts             NEW  ISO-2 → EDI country name
│   ├── restrictedGoods.ts                    NEW  shared restricted list + matcher
│   └── edi/
│       ├── ediColumns.ts                     NEW  ★ single ordered 36-column registry
│       ├── ediTransforms.ts                  NEW  §4 pure formatters
│       ├── ediConstants.ts                   NEW  PayType/Bond/IGSTPaid/GSTINType/ADCode
│       ├── ediWorkbook.service.ts            NEW  BIFF8 writer, driven by EDI_COLUMNS (no indexes)
│       └── ediExport.service.ts              NEW  orchestrator + live-Aadhaar lookup + readiness check
├── controllers/operationsManifest.controller.ts  EDIT exportEdi (reuse existing download())
├── routes/operationsManifest.routes.ts            EDIT GET /:manifestId/export-edi.xls
├── services/shipmentValidation.service.ts         EDIT restricted-goods check in validateParcel
├── scripts/backfillManifestPartySnapshots.ts      NEW  R7
└── tests/
    ├── ediMapping.test.ts                    NEW  transforms + full-row mapping vs sample rows 2–3
    ├── restrictedGoods.test.ts               NEW  every category + clean descriptions
    └── operationsManifest.test.ts            EDIT manifest output unchanged after R5/R6

portal/frontend/src/
├── lib/restrictedGoods.ts                    NEW  (or shared import) list + matcher for the toast
├── lib/operationsManifests.ts                EDIT download supports "edi"
├── app/.../shipments/[draftId]/page.tsx      EDIT toast on restricted contentsDescription
├── app/.../client/shipments/[draftId]/page.tsx  EDIT same
└── app/dashboard/operations-manifests/[manifestId]/page.tsx  EDIT "EDI" download button
```

### Centralisation rule
`ediColumns.ts` is the only place a column name, order, or source appears:
```ts
type EdiColumn = { header: string; source: "SNAP"|"LIVE"|"CALC"|"CONST"; type: "text"|"number";
                   value: (row: ParcelRow, ctx: EdiContext) => string | number };
export const EDI_COLUMNS: readonly EdiColumn[] = [ /* 36, in order */ ];
```
The writer only does `EDI_COLUMNS.map(c => c.header)` and `EDI_COLUMNS.map(c => c.value(row, ctx))`. Order = array order. **No numeric column index anywhere.**

---

## 8. Implementation plan
- **Phase 1 — Restricted-goods guard (§6.3).** Independent, user-visible now. Ship first.
- **Phase 2 — Structured party + parcel capture (R1, R2, R4).** Additive; manifest output unchanged.
- **Phase 3 — Shared builder (R5, R6).** Acceptance: a manifest sealed *before* the change yields **byte-identical Excel + PDF** after.
- **Phase 4 — EDI mapping layer (R3 sign-off first).** `countryNames`, `ediTransforms`, `ediConstants`, `ediColumns`. Pure, fully unit-tested before any workbook code.
- **Phase 5 — EDI writer + endpoint.** BIFF8 writer, `ediExport` (with the live-Aadhaar lookup), controller/route, frontend button. Gate: `SEALED`/`DISPATCHED` only. Filename `{manifestNumber}-EDI.xls`.
- **Phase 6 — Verify + backfill (R7).** Regenerate SLC-012 from DB; expect the trustworthy columns (constants, IDs, MHBS, names, numbers, dates) to match the sample exactly and addresses to differ (sample addresses are scrambled). Run R7.

### Tests
Transforms incl. edge cases (empty state, missing country code, unpadded date, leading-zero PIN); full 36-column assertion for the two clean sample rows; every restricted category (positive + negative); manifest regression across Phase 3; seal→download→re-read integration asserting headers, per-parcel row count, and cell types.

---

## 9. Remaining sign-off
Only one item still needs your word before Phase 4:
- **R3** — sourcing the manifest's consignor from the new per-shipment consignor details (so it carries state and matches the individual sender). This *changes what the manifest prints*. If you'd rather the manifest keep showing the business account and only the **EDI** use the new consignor details, say so and I'll scope R3 to the EDI path alone.

Everything else is decided.
