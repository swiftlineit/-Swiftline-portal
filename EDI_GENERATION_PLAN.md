# EDI Generation — Field Mapping & Implementation Plan

Status: **plan only, no code written yet.**
Reference files analysed: `MANIFEST  SLC-012.xlsx`, `EDI RUN SLC012.xls`.

---

## 1. What the two files actually are

### Manifest (`MANIFEST SLC-012.xlsx`)
- One sheet (`Worksheet`), range `A1:O584`.
- Rows 1–13: header block. Origin/destination agent in cols E/F, label/value pairs in cols G/H.
- Row 14: column headings `S.No *, Consignment No. *, Pieces *, Weight (kg), Consignor *, Consignee *, Description *, Value *, Currency *, Bag No *, Service Info`.
- Rows 15+: **63 consignment blocks**. Each block is one scalar row plus a vertical address stack in cols E (consignor) and F (consignee).
- **Block heights are not fixed**: observed 8, 9, 10 and 22 rows. Address lines land at *different offsets per block*.

### EDI (`EDI RUN SLC012.xls`)
- BIFF8 `.xls`. `Sheet1` = flat table, headers in row 1, **36 columns A→AJ**, 63 data rows. `Sheet2` is empty (an artifact — do not reproduce it).
- One row per consignment. No header block, no merges, no styling.

### Cross-check (joined on HAWB)
| Check | Result |
|---|---|
| Row count | 63 manifest blocks ↔ 63 EDI rows, **1:1, no orphans either way** |
| `PKG` / `Weight` / `Value` / `InvoiceValue` / `FOB_Value` / `CurrencyType` | 63/63 exact match |
| `ConsignorName` / `ConsigneeName` | 63/63 exact match |
| `ExportInvoiceNo` = `GSTInvoiceNo` = `CRN_NO` = HAWB | 63/63 |
| `MHBSNo` = manifest number + zero-padded bag no | 63/63 (`SLC012` + `01` → `SLC01201`) |
| `CRN_MHBS_NO` = `MHBSNo` | 63/63 |
| `DescriptionofGoods` | 58/63 — the 5 differences are **deliberate word removals** (see §4.6) |
| Consignor / consignee **address blocks** | only 25/63 and 20/63 match |

> ⚠️ **The address columns in the sample EDI are unreliable test data.** Rows 2–3 map perfectly; beyond that, addresses were pasted from a small rotating pool (e.g. row 28: city `KURUKSHETRA`, state `Delhi`, PIN `132024`). Names, numbers and constants are trustworthy; per-row addresses past row ~3 are not. All address rules below are derived only from the rows that were *not* scrambled.

---

## 2. Field mapping table

`SRC` legend — **H**: manifest header (DB `OperationsManifest.header`) · **DB**: MongoDB record · **CALC**: derived · **CONST**: fixed value · **MISSING**: not currently stored anywhere.

| # | EDI column | Manifest column | SRC | Origin | Transformation |
|---|---|---|---|---|---|
| 1 | `MAWBNumber` | Header `MAWB NO. *` | H | `header.mawbNumber` | trim, uppercase; repeated on every row |
| 2 | `HAWBNumber` | `Consignment No. *` | DB | `consignment.consignmentNumber` | `formatManifestConsignmentNumber()` — reuse the manifest's existing helper |
| 3 | `ConsignorName` | `Consignor` line 1 | DB | `account.company.companyName` ?? contact full name | trim |
| 4 | `ConsignorAddress1` | `Consignor` line 2 | DB | `account.company.registeredAddress` | trim + strip trailing comma |
| 5 | `ConsignorAddress2` | `Consignor` line 3 | **MISSING** | — | `""` until a second address line exists (§3.4) |
| 6 | `ConsignorCity` | `Consignor` line 4 | DB | `account.company.city` | trim |
| 7 | `ConsignorState` | `Consignor` line 5 | DB | `account.company.stateOrProvince` | **Title Case** (`PUNJAB`→`Punjab`, `UTTAR PRADESH`→`Uttar Pradesh`) |
| 8 | `ConsignorPostalCode` | `Consignor` line 6 | DB | `account.company.postalCode` | force **text** (sample is inconsistently numeric — we normalise) |
| 9 | `ConsignorCountry` | `Consignor` line 7 (ISO-2) | CALC | `account.company.addressCountry` | ISO-2 → **UPPERCASE full name** (`IN`→`INDIA`) |
| 10 | `ConsigneeName` | `Consignee` line 1 | DB | `consignee.companyName \|\| contactName` | trim |
| 11 | `ConsigneeAddress1` | `Consignee` line 2 | DB | `consignee.addressLine1` | trim + strip trailing comma |
| 12 | `ConsigneeAddress2` | `Consignee` line 3 | DB | `consignee.addressLine2` | trim + strip trailing comma, `""` when absent |
| 13 | `ConsigneeCity` | `Consignee` line 4 | DB | `consignee.townOrCity` | trim |
| 14 | `ConsigneeState` | `Consignee` line 5 | DB | `consignee.county` | **Title Case**, `""` when absent (`MANCHESTER`→`Manchester`) |
| 15 | `ConsigneePostalCode` | `Consignee` line 6 | DB | `consignee.postcode` | force text |
| 16 | `ConsigneeCountry` | `Consignee` line 7 (ISO-2) | CALC | `consignee.countryCode` (fallback `countryName`) | ISO-2 → UPPERCASE full name (`GB`→`UNITED KINGDOM`, `DE`→`GERMANY`, `GR`→`GREECE`, `US`→`UNITED STATES OF AMERICA`) |
| 17 | `PKG` | `Pieces *` | CALC | packed parcel count | number |
| 18 | `Weight` | `Weight (kg)` | CALC | Σ packed parcel weights | number, 3 dp max |
| 19 | `DescriptionofGoods` | `Description *` | CALC | `consignment.description` | **prohibited terms removed** (§4.6) |
| 20 | `Value` | `Value *` | CALC | `declaredValueMinor / 100` | number |
| 21 | `ExportInvoiceNo` | — | ❓ | HAWB *(sample)* vs `InvoiceUpload.invoiceNumber` *(DB)* | **decision needed** (§3.5) |
| 22 | `GSTInvoiceNo` | — | ❓ | same as #21 | same as #21 |
| 23 | `InvoiceValue` | `Value *` | CALC | = `Value` | number |
| 24 | `CurrencyType` | `Currency *` | DB | `consignment.currency` | always `INR` (schema enum) |
| 25 | `PayType` | — | CONST | — | `"N"` |
| 26 | `IGSTPaid` | — | CONST | — | `0` (numeric) |
| 27 | `Bond` | — | CONST | — | `"NA"` |
| 28 | `MHBSNo` | `Bag No *` | DB | `bag.bagNumber` | **direct** — `formatOperationsBagNumber()` already emits `SLC` + 3-digit manifest seq + 2-digit bag seq (`SLC01201`) |
| 29 | `GSTINType` | — | ❓ | `account.company.registrationIdType` | `"Aadhaar Number"` in the sample; vocabulary needs confirming (§3.2) |
| 30 | `GSTINNumber` | — | **MISSING** | — | numeric, 12 digits in the sample (§3.1) |
| 31 | `GSTDate` | Header `FLIGHT DEPARTURE DATE` | CALC | `header.departureDate` | `yyyy-MM-dd` → **`d/M/yyyy` text**, no leading zeros (`17/7/2026`) |
| 32 | `ExportDate` | same | CALC | same | same |
| 33 | `ADCode` | — | **MISSING** | — | blank in the sample (§3.3) |
| 34 | `CRN_NO` | `Consignment No. *` | CALC | = `HAWBNumber` | direct |
| 35 | `CRN_MHBS_NO` | `Bag No *` | CALC | = `MHBSNo` | direct |
| 36 | `FOB_Value` | `Value *` | CALC | = `Value` | number |

**Manifest columns with no EDI counterpart:** `S.No *`, `Service Info` (EXP/CARGO).
**Manifest header fields with no EDI counterpart:** flight number, IATA origin/destination, total bags, total weight, value type, FROM/TO agent blocks.

### Mapping shape summary
- **Direct (14):** #1, 2, 3, 4, 6, 8, 10, 11, 12, 13, 15, 17, 18, 24, 28
- **Renamed only (7):** Pieces→`PKG`, Consignment No.→`HAWBNumber`, Bag No→`MHBSNo`, Value→`Value`/`InvoiceValue`/`FOB_Value`, Currency→`CurrencyType`
- **Reformatted (6):** #7, 9, 14, 16, 31, 32
- **Constants (4):** #25, 26, 27, and #24 in practice
- **Copies of other EDI columns (5):** #21, 22, 23, 34, 35, 36
- **Not in the manifest at all (5):** #29, 30, 33 + whichever of #21/#22 resolves to the invoice number
- **Rule-filtered (1):** #19

---

## 3. Missing data list

### 3.1 `GSTINNumber` — 🔴 blocking
`IBusinessAccount` has **no Aadhaar/GSTIN number field**. It holds `documents.aadhaarCard` (an uploaded *file*), `company.gstin` (15-char GSTIN), and `company.registrationId` + `registrationIdType`. The sample column is a bare 12-digit number = Aadhaar.
**Options:** (a) confirm `company.registrationId` already holds the Aadhaar for individual senders and read it there; (b) add `company.aadhaarNumber` to the schema + the account form + a backfill. **Recommend (a) first** — it may already be populated.

### 3.2 `GSTINType` — 🟠
Constant `"Aadhaar Number"` across all 63 sample rows. Should really be derived from `registrationIdType`. Need the exact accepted vocabulary from the customs system (e.g. `Aadhaar Number` / `GSTIN` / `PAN`). Until then: derive where possible, default `"Aadhaar Number"`.

### 3.3 `ADCode` — 🟡
Blank in every sample row and stored nowhere. AD Code belongs to the exporter's authorised-dealer bank branch. **Recommend** adding `Branch.adCode` (optional, defaults `""`) so it can be filled later without touching the generator.

### 3.4 `ConsignorAddress2` — 🟡
`company.registeredAddress` is a single free-text field; there is no line 2. The sample manifest shows two consignor address lines. **Recommend** adding `company.registeredAddressLine2` (optional). Emits `""` until then.

### 3.5 `ExportInvoiceNo` / `GSTInvoiceNo` — 🟠 decision needed
The sample sets both to the HAWB. The DB has a real `InvoiceUpload.invoiceNumber`. These are different things and customs may reject the wrong one. **Recommend** making it a single named rule in the column registry so it flips in one line.

### 3.6 Prohibited-goods word list — 🟠
See §4.6. No such list exists in the codebase today.

### 3.7 Consignor state is currently dropped by the manifest generator — 🟠
`formatConsignor()` in `shipmentManifest.service.ts:81-91` builds the consignor block from companyName, contactName, registeredAddress, city, postalCode, country, phone — **`stateOrProvince` is not included**, even though the sample manifest clearly shows a state line. EDI needs it (#7). Adding it fixes the manifest *and* feeds the EDI, but it **changes manifest output**, so it needs sign-off.

---

## 4. Transformation rules

Every rule below is a pure function, unit-testable in isolation.

### 4.1 `ediText(value)`
`null`/`undefined` → `""`. Numbers → string. Always trims. **Never emits `null`** — the sample uses empty strings for absent values.

### 4.2 `ediAddressLine(value)`
`ediText` then strip a trailing comma. Evidence: `"AMUNPUR 31, "` → `"AMUNPUR 31"`, `"HOSHIARPUR, "` → `"HOSHIARPUR"`, `"BATH RD, SLOUGH, "` → `"BATH RD"` *(the manifest's line 3 is itself a two-part string; only the trailing comma is stripped — internal commas stay)*.

### 4.3 `titleCaseState(value)`
Per-word: first letter upper, rest lower. Verified on the 25 unscrambled rows: `PUNJAB`→`Punjab`, `HARYANA`→`Haryana`, `DELHI`→`Delhi`, `GUJRAT`→`Gujrat`, `RAJASTHAN`→`Rajasthan`, `UTTAR PRADESH`→`Uttar Pradesh`, and already-cased `Uttar Pradesh` passes through unchanged. Same rule for consignee state: `MANCHESTER`→`Manchester`, `LONDON`→`London`.

### 4.4 `ediCountryName(codeOrName)`
ISO-3166 alpha-2 → **uppercase** full name. Confirmed pairs: `IN`→`INDIA`, `GB`→`UNITED KINGDOM`, `DE`→`GERMANY`, `GR`→`GREECE`. Also present in the sample: `SPAIN`, `PORTUGAL`, `UNITED STATES OF AMERICA` *(note: not "UNITED STATES")*. A non-ISO input that is already a full name passes through uppercased. **No such lookup exists in the backend today — it must be added** (`reference/countryNames.ts`).

### 4.5 `ediDate(isoDate)`
`yyyy-MM-dd` → `d/M/yyyy` **as a text cell**, no zero padding: `2026-07-17` → `17/7/2026`. Note this differs from the manifest's own `formatManifestDate()`, which produces `dd-MM-yyyy` — **do not reuse it**.

### 4.6 `scrubDescription(text)`
The 5 sample differences are all removals of the same kind of term:

| HAWB | Manifest | EDI | Removed |
|---|---|---|---|
| SLC170720 | `GHEE,JEERA,PAPAD,SNACKS,SPICES` | `JEERA,PAPAD,SNACKS,SPICES` | `GHEE` |
| SLC170752 | `UTENSILS,SNACKS,PRESSURE COOKER,GHEE` | `UTENSILS,SNACKS,PRESSURE COOKER` | `GHEE` |
| SLC170762 | `GHEE,SPICES,SWEETS,...` | `SPICES,SWEETS,...` | `GHEE` |
| SLC170764 | `LADIES PURSE,T-SHIRT,PAPER TRAYS,GHEE,SHOES` | `LADIES PURSE,T-SHIRT,PAPER TRAYS,SHOES` | `GHEE` |
| SLC170726 | `SNAKCS,DRESS SET,COSMETIC ITEAM,ARTIFICAL JEWELLARY` | `SNAKCS,DRESS SET,ARTIFICAL JEWELLARY` | `COSMETIC ITEAM` |

Rule: split on `,`, drop any item whose normalised text matches a configured prohibited term, re-join with `,`. Case-insensitive, whitespace-tolerant. **The list is config, not code** — `EDI_PROHIBITED_DESCRIPTION_TERMS` in `ediConstants.ts`, seeded with `GHEE` and `COSMETIC ITEAM`. Needs the operations team's full list.
Edge case to handle: if every item is removed, fall back to `"GENERAL MERCHANDISE"` rather than emitting an empty description.

### 4.7 Cell types
`Weight`, `Value`, `InvoiceValue`, `FOB_Value`, `PKG`, `IGSTPaid`, `GSTINNumber` → **numeric** cells.
Everything else → **text** cells, including postal codes and both dates. (The sample is inconsistent on postal codes — some numeric, some text. We normalise to text; a leading-zero PIN would otherwise be corrupted.)

### 4.8 Row granularity — ❓ decision needed
Every consignment in the sample had exactly one parcel, so the file cannot tell us what a multi-parcel HAWB looks like. The **manifest** emits one row per *parcel*. **Recommendation: the EDI emits one row per *consignment* (HAWB)** — `PKG` = parcel count, `Weight` = consignment total, `Value` = full declared value, one row per HAWB. That matches customs semantics (a HAWB is one shipment) and keeps HAWB unique per row as in the sample. This is a single flag in the builder if it turns out to be wrong.

### 4.9 Output file format
The sample is BIFF8 `.xls`. **Verified: the already-installed `xlsx@0.18.5` writes BIFF8 correctly** (`bookType: "biff8"`, round-trips cleanly). ExcelJS — used for the manifest — cannot write `.xls`. So the EDI generator uses `xlsx`, the manifest keeps ExcelJS. No new dependency.

---

## 5. Why the EDI must not read the Manifest Excel

Three independent reasons, all confirmed by the file itself:

1. **Block heights vary** (8/9/10/22 rows). Address lines sit at different offsets per consignment — any offset-based parse silently mis-reads.
2. **The manifest is lossy by design.** `uniqueLines()` in `shipmentManifest.service.ts:39-48` de-duplicates address lines, so when city == county one of them simply disappears. It is not reversible.
3. **The manifest never contained 5 of the EDI's columns** (`GSTINNumber`, `GSTINType`, `ADCode`, and the invoice numbers). They have to come from the DB regardless.

---

## 6. Current architecture and required refactoring

### 6.1 How data flows today

```
DpdShipment.currentShipmentSnapshot        (ShipmentBookingSnapshot — structured: account.company, consignee)
        │
        ▼  buildManifestLine()                       ← ⚠ FLATTENS to { formatted: "line\nline\nline" }
OperationsManifestConsignment
   .consignorSnapshot / .consigneeSnapshot           ← ⚠ structure already lost here
        │
        ▼  sealOperationsManifest()
OperationsManifest.sealedSnapshot                    (frozen; inherits the loss)
        │
        ├─► buildOperationsManifestExcel()  ← ⚠ builds a fake IShipmentManifest and casts it `as never`
        │        └─► buildShipmentManifestWorkbook()
        └─► buildOperationsManifestPdf()    ← ⚠ re-implements the same row/address layout independently
```

### 6.2 Three problems this creates

1. **Structure loss at `buildManifestLine`** ([shipmentManifest.service.ts:115-134](portal/backend/src/services/shipmentManifest.service.ts#L115-L134)). The parties become one newline-joined string. EDI needs 14 discrete address fields. **This is the one mandatory refactor.**
2. **The `virtualManifest` cast** ([operationsManifest.service.ts:1043-1082](portal/backend/src/services/operationsManifest.service.ts#L1043-L1082)) fabricates an `IShipmentManifest` and casts it `as never` to reuse the client-manifest writer. It works, but it is exactly the seam a third output would have to copy. It becomes the shared builder instead.
3. **Duplicated layout logic.** `sealedParcelRows`, address spreading, `formatManifestConsignmentNumber` and the value-on-first-row rule exist twice — once for Excel, once for PDF. A third copy for EDI is the outcome to avoid.

### 6.3 Target architecture

```
                     OperationsManifest.sealedSnapshot (v2 — now carries structured parties)
                                       │
                                       ▼
                     buildManifestDocumentModel()          ← THE SHARED SHIPMENT DATA BUILDER
                                       │                      returns NormalizedManifestDocument
                                       │                      { header, totals, consignments[], parcelRows[] }
                     ┌─────────────────┼─────────────────┐
                     ▼                 ▼                 ▼
            Manifest Excel        Manifest PDF        EDI Excel
            (ExcelJS)             (PDFKit)            (xlsx / biff8, driven by EDI_COLUMNS)
```

The EDI generator receives a **`NormalizedManifestDocument`** — never a file path, never a workbook.

### 6.4 Refactors required (in order)

| # | Change | File | Risk |
|---|---|---|---|
| R1 | `buildManifestLine()` also returns `consignor.party` / `consignee.party` (structured) alongside the existing `formatted`. **No new DB reads** — the full `ShipmentBookingSnapshot` is already in scope. | `shipmentManifest.service.ts` | Low — additive |
| R2 | Persist `party` on `consignorSnapshot` / `consigneeSnapshot` (already `Mixed`, so **no migration**). | `operationsManifestConsignment.model.ts` | None |
| R3 | Add `stateOrProvince` to `formatConsignor()` (§3.7). **Changes manifest output** — needs sign-off. | `shipmentManifest.service.ts` | Medium |
| R4 | Bump `sealedSnapshot` to `version: 2`; readers accept 1 and 2. | `operationsManifest.service.ts` | Low |
| R5 | Extract `buildManifestDocumentModel()`; move `sealedParcelRows` + the value-on-first-row rule into it. | new `manifestDocument.service.ts` | Medium |
| R6 | Rewrite `buildOperationsManifestExcel` / `Pdf` to consume the model; **delete the `as never` cast**. Output must stay byte-comparable. | `operationsManifest.service.ts` | Medium |
| R7 | Backfill: v1 sealed manifests have no `party`. EDI returns a clear 409; a script re-derives `party` from the still-present `DpdShipment` snapshots. | new script | Low |

Note R1–R2 only help manifests sealed *after* deployment. R7 covers the rest.

---

## 7. Recommended folder structure

```
portal/backend/src/
├── types/
│   └── manifestDocument.ts              NEW  NormalizedManifestDocument / ConsignmentRow / PartySnapshot
├── services/
│   ├── manifestDocument.service.ts      NEW  ★ shared builder: sealedSnapshot → normalized model
│   ├── shipmentManifest.service.ts      EDIT R1, R3 — buildManifestLine emits structured party
│   ├── operationsManifest.service.ts    EDIT R4, R6 — seal v2; exports consume the model
│   ├── reference/
│   │   └── countryNames.ts              NEW  ISO-3166 alpha-2 → EDI country name
│   └── edi/
│       ├── ediColumns.ts                NEW  ★ THE single ordered column registry (all 36)
│       ├── ediTransforms.ts             NEW  pure formatters (§4)
│       ├── ediConstants.ts              NEW  PayType/Bond/IGSTPaid/GSTINType + prohibited terms
│       ├── ediWorkbook.service.ts       NEW  writes BIFF8 from EDI_COLUMNS — no column indexes
│       └── ediExport.service.ts         NEW  orchestrator + readiness check
├── controllers/
│   └── operationsManifest.controller.ts EDIT add exportEdi (reuses the existing download() helper)
├── routes/
│   └── operationsManifest.routes.ts     EDIT GET /:manifestId/export-edi.xls
├── scripts/
│   └── backfillManifestPartySnapshots.ts NEW  R7
└── tests/
    ├── ediMapping.test.ts               NEW  transforms + full-row mapping against the sample
    └── operationsManifest.test.ts       EDIT assert manifest output is unchanged after R5/R6

portal/frontend/src/
├── lib/operationsManifests.ts           EDIT downloadOperationsManifest accepts "edi"
└── app/dashboard/operations-manifests/[manifestId]/page.tsx   EDIT add "EDI" button next to Excel/PDF
```

### The centralisation rule
`ediColumns.ts` is the **only** place a column name, its order, or its source appears:

```ts
export type EdiColumn = {
  header: string;                                  // exact EDI header text
  source: "HEADER" | "DB" | "CALC" | "CONSTANT";   // documentation + tooling
  type: "text" | "number";
  value: (row: NormalizedConsignmentRow, ctx: EdiContext) => string | number;
};

export const EDI_COLUMNS: readonly EdiColumn[] = [ /* 36 entries, in order */ ];
```

The writer only ever does `EDI_COLUMNS.map(c => c.header)` and `EDI_COLUMNS.map(c => c.value(row, ctx))`. Column order is array order — **no numeric index appears anywhere**. Adding, removing or reordering a column is a one-line edit.

---

## 8. Implementation plan

**Phase 0 — sign-off (blocking).** Resolve §3.1, §3.5, §4.6, §4.8, and R3. Everything else can proceed in parallel.

**Phase 1 — structured party capture (R1, R2).** Extend `buildManifestLine`; persist `party`. Existing manifest output unchanged. Ship independently.

**Phase 2 — shared builder (R4, R5, R6).** Extract `buildManifestDocumentModel`, repoint Excel + PDF at it, drop the `as never` cast. **Acceptance: a manifest sealed before the change produces an identical Excel and PDF after it.**

**Phase 3 — EDI mapping layer.** `countryNames.ts`, `ediTransforms.ts`, `ediConstants.ts`, `ediColumns.ts`. Pure functions, no I/O, fully unit-tested before any workbook code exists.

**Phase 4 — EDI writer + endpoint.** `ediWorkbook.service.ts` (BIFF8), `ediExport.service.ts`, controller + route, frontend button. Same gate as the other exports: `SEALED` or `DISPATCHED` only. Filename `{manifestNumber}-EDI.xls`.

**Phase 5 — verification & backfill.** Regenerate the SLC-012 EDI from DB data and diff it against `EDI RUN SLC012.xls` — **expect the trustworthy columns (all constants, IDs, numbers, names, MHBS, dates) to match exactly, and the addresses to differ, because the sample's addresses are scrambled.** Then run the R7 backfill.

### Test plan
- **Unit:** every transform in §4, including the edge cases (empty description after scrub, missing country code, unpadded date, leading-zero PIN).
- **Mapping:** build a `NormalizedManifestDocument` from the sample's *manifest* data, generate rows, assert all 36 columns for rows 2–3 (the two verified-clean rows) byte-for-byte.
- **Regression:** manifest Excel + PDF unchanged across Phase 2.
- **Integration:** seal → download EDI → re-read with `xlsx` → assert headers, row count and types.

---

## 9. Open decisions

| # | Question | Recommendation |
|---|---|---|
| 1 | Where does the consignor's 12-digit Aadhaar live? | Check `company.registrationId` first; add `company.aadhaarNumber` only if it is not there |
| 2 | `ExportInvoiceNo` / `GSTInvoiceNo` — HAWB or real invoice number? | Sample says HAWB; keep it a one-line rule in `ediColumns.ts` |
| 3 | One EDI row per consignment or per parcel? | **Per consignment (HAWB)** — `PKG` = parcel count |
| 4 | Full prohibited-terms list | Seed with `GHEE`, `COSMETIC ITEAM`; operations team to complete |
| 5 | Add consignor state to the manifest? (§3.7) | Yes — the sample manifest has it and EDI requires it |
| 6 | `.xls` (matches sample) or `.xlsx`? | **`.xls` BIFF8** — verified working with the existing `xlsx` dependency |
| 7 | `ADCode` source | Add optional `Branch.adCode`; emit `""` meanwhile |
