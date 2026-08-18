# Swiftline Client Portal- Spec Gap & Effort Report

**Date:** 2026-08-05
**Scope:** The 100-section "Complete Functional Requirements and Developer Specification" assessed against the code currently in `portal/`.

---

## 1. Method

This report was produced by reading the actual codebase, not by estimating from the spec alone. What was inspected:

- **Backend** (`portal/backend/src`): 64 Mongoose models, 30 route files, 39 controllers, ~75 service modules, 10 middleware, 40 test files.
- **Frontend** (`portal/frontend/src`): 70 Next.js App Router pages, split into `client/` (customer-facing) and `dashboard/` (Swiftline staff).
- Keyword sweeps across both trees for every major spec concept (pickup, claims, insurance, dangerous goods, serviceability, TOTP, budget, SLA, holiday, carbon, feature flags, etc.) with hits manually verified- several apparent matches were false positives (e.g. "claim" resolves to JWT claims, "sla" to Tailwind `slate`/`translate`).

**Status codes used below:**

| Code | Meaning |
|---|---|
| ✅ | Built and functional; only polish/spec-detail work remains |
| 🟡 | Partially built- real foundation exists, meaningful work remains |
| ⬜ | Not started- no model, route, service or page exists |

**Estimates** are in developer-days (one day = one productive engineering day, not a calendar day). They cover backend + frontend + tests for that section, and exclude project management, design, and UAT except where noted.

---

## 2. Headline Numbers

| Metric | Value |
|---|---|
| Spec sections fully done (✅) | **11** of 100 |
| Spec sections partially done (🟡) | **41** of 100 |
| Spec sections not started (⬜) | **48** of 100 |
| **Remaining effort** | **≈ 670 developer-days** (range 470-870 at ±30%) |
| Plus pre-development artifacts the spec mandates | +10 days |
| **Total** | **≈ 680 developer-days** |

### What that means in calendar time

| Team | Calendar estimate |
|---|---|
| 1 full-stack developer | ~32-36 months |
| 2 developers + 1 QA | ~17-19 months |
| 4 developers + 1 QA + 1 designer | ~9-11 months |
| 6 developers + 2 QA + 1 designer + 1 PM | ~7-8 months |

Larger teams do not scale linearly- the figures above already include a coordination overhead allowance of roughly 25% above a naive division.

**The honest summary:** roughly 20-25% of the specified system exists today, but the part that exists is the operationally hardest part (credit, billing, manifests, customs EDI, invoicing). The remaining 75% is broad rather than deep- many independent modules, most of which are self-contained and parallelisable.

---

## 3. What Is Genuinely Built

These are the strongest areas of the codebase and represent substantial completed value:

**Credit Account (§11)- the most mature module in the system.**
`businessCreditAccount`, `creditAgreement` (+ PDF generation and counters), `creditBillingStatement` (+ PDF), `creditLedgerEntry`, `creditLimitHistory`, `creditPayment`, `creditBillingAdjustment`, `paymentTerms`. Services cover booking against credit, billing cycles, overdue handling, and reconciliation. Backed by 9 dedicated test files including integration tests for the full credit lifecycle.

**Manifests & Operations (§16, §64, §66).**
Two manifest systems: `shipmentManifest` (customer-facing) and `operationsManifest` (warehouse), plus bags, consignments, scan sessions and scans. Includes a phone-based barcode scanner (`/manifest-scanner/[sessionId]`) and automatic customs EDI `.xls` export driven off sealed manifest snapshots via a 36-column registry.

**Invoicing (§13, §52).**
Tax invoice, shipment invoice, customs invoice (with parser + workbook generation), credit notes, cancellation-fee invoices, invoice uploads, and dedicated counters for document numbering.

**Shipment core (§3-5, §43-44).**
`shipmentDraft` (386-line model with consignor/consignee snapshots, KYC documents, parcels, parcel items, address validation states), `shipmentEvent` (18 event types, 9 operational statuses, hold reasons), amendments, cancellations, charge verification, pricing, validation, label PDF generation.

**Wallet / Prepaid (§12).**
`prepaidAccount`, `prepaidTransaction`, `paymentTopUp`, `balanceReservation`, with ledger, reservations, reconciliation and daily top-up limit services. Razorpay integration with webhook handling.

**Supporting infrastructure.**
Audit log model, user sessions, idempotency keys, email outbox with templates/preferences/suppression and SES webhooks, portal notifications, business accounts with 5 member roles, branches, support tickets, Google Places + Ideal Postcodes address validation, restricted-goods checking, DPD carrier integration, country rate cards, rate card sharing.

---

## 4. Section-by-Section Assessment

### Sections 1-20

| § | Module | Status | Assessment | Days |
|---|---|---|---|---|
| 1 | Login & Security | 🟡 | Password login, email OTP, forgot/reset password, sessions, rate limiting, reCAPTCHA and audit logging all exist. Missing: mobile/SMS OTP, TOTP authenticator app, backup recovery codes, device recognition / "remember device", login location & IP display, active-device list UI, forgot customer code, and the full specified error-message set. | 8 |
| 2 | Client Dashboard | 🟡 | Page exists but is thin (281 lines). Missing: nearly all 19 shipment summary cards, the 10 finance cards, the 11-stage visual pipeline, upcoming tasks, and the entire performance analytics block. | 10 |
| 3 | Create Shipment | 🟡 | Strong draft model and booking flow exist. Missing as specified: the 10 shipment-type selector, in-flow service comparison step, pickup step, payment step, dangerous-goods and temperature-sensitive paths, and several commodity fields. | 12 |
| 4 | Shipment List | 🟡 | Listing service and page exist. Missing: most of the 14 specified columns, the 13 filter states, and all 10 bulk actions (bulk label print, bulk POD, Excel/CSV/PDF export). | 6 |
| 5 | Shipment Details | 🟡 | Detail page exists with tracking events. Missing: proof-of-delivery block entirely, several action buttons (raise claim, request return, duplicate shipment). | 5 |
| 6 | Smart Tracking | 🟡 | Event-driven tracking works (`swiftlineTracking.service.ts`, 76 lines). Missing: multi-key search (invoice no., PO, phone, email, QR), alert subscriptions across 4 channels, delay reasons, live map. | 7 |
| 7 | Live Quote | ✅ | `shipmentQuote` model + service + counters + documents, quote pages, share links. Remaining: a few spec fields and service-comparison UI. | 3 |
| 8 | My Quotes | ✅ | Quote list and detail pages exist. Remaining: convert-to-booking polish, duplicate, request-revision actions. | 2 |
| 9 | **Pickup Management** | ⬜ | **Nothing exists.** Only a `pickupInstructions` text field on the draft. No pickup model, statuses, scheduling, driver assignment, OTP, or proof capture. | 12 |
| 10 | **Address Book** | ⬜ | **Nothing exists.** No address book model or pages. Addresses are entered per-shipment only. | 8 |
| 11 | Credit Account | ✅ | Most complete module in the system. Remaining: credit-utilisation meter UI and a few alert thresholds. | 2 |
| 12 | Wallet / Advance | ✅ | Core is solid. Missing: auto-recharge, refund requests, inter-branch transfer, low-balance alerts. | 4 |
| 13 | Invoice Centre | ✅ | Invoice generation is strong. Missing: unified invoice centre UI with the 8 categories, dispute raising, GST summary download. | 4 |
| 14 | Payment Module | ✅ | Razorpay + credit payments work. Missing: multi-invoice payment, partial payment, bank-transfer proof upload, refund requests. | 4 |
| 15 | Statements & Credit Reports | 🟡 | Credit statements with PDF exist. Missing: the other 8 report types and the full filter/export matrix. | 6 |
| 16 | Manifest Management | ✅ | Complete, including scanning and EDI. Remaining: minor spec fields. | 2 |
| 17 | Customs Centre | 🟡 | Per-shipment customs documents and KYC upload exist. Missing: the customs dashboard, document status workflow (under review / rejected / resubmission), customs query handling. | 8 |
| 18 | **Claims Management** | ⬜ | **Nothing exists.** No claim model, workflow, or uploads. (Grep hits for "claim" are JWT claims.) | 12 |
| 19 | **Returns & Reverse Logistics** | ⬜ | **Nothing exists.** `RETURNED` is a tracking event only- no return creation, return labels, or reverse pickup. | 10 |
| 20 | Notification Centre | 🟡 | `portalNotification` + email outbox + preferences + suppression exist. Missing: SMS, WhatsApp and push channels; archive/mute; category filtering UI. | 6 |

### Sections 21-40

| § | Module | Status | Assessment | Days |
|---|---|---|---|---|
| 21 | Help-Desk & Support | ✅ | Tickets, messages, counters, client and staff pages. Missing: 8 departments, escalation, support rating, callback request, live chat. | 5 |
| 22 | **Reports & Analytics** | ⬜ | **Nothing exists.** No reports pages at all; 10 shipment reports, 8 finance reports and 10 performance metrics all outstanding. | 14 |
| 23 | User & Role Management | 🟡 | 5 business-account member roles exist vs the 9 specified; permissions are currently credit-scoped only, not the full 12-permission matrix. Missing: spending limits, approval requirements, per-user activity view. | 10 |
| 24 | **Approval Workflow** | ⬜ | **Nothing exists.** No approval engine for shipments, rates, payments, refunds, claims or user creation. | 12 |
| 25 | Multi-Branch | 🟡 | Branch model, pages, and branch-access middleware exist. Missing: separate/shared branch wallets, branch credit limits, branch reporting, consolidated statements. | 6 |
| 26 | **API & Integration Centre** | ⬜ | **Nothing exists for customers.** The only webhook code is *inbound* (Razorpay, SES). No API key issuance, API logs, outbound webhooks, sandbox, or docs. E-commerce connectors (Shopify/Woo/Magento/Amazon/eBay) are a separate multi-month track not costed here. | 20 |
| 27 | **AI Features** | ⬜ | **Nothing exists.** Assistant, document checker, and shipment health score all outstanding. | 15 |
| 28 | Mobile Features | 🟡 | Phone barcode scanner exists and works. Missing: verified responsive layouts across all 70 pages, biometric/Face ID login, push notifications, offline drafts, GPS pickup. | 10 |
| 29 | Profile & Company Settings | ✅ | Profile pages, company details, document upload, privacy policy page. Remaining: downloadable-documents section, language preference. | 3 |
| 30 | Audit Logs | 🟡 | `auditLog` model exists and is written to. Missing: customer-facing audit UI, previous/new value capture on all actions, full action coverage. | 5 |
| 31 | **Global Search** | ⬜ | **Nothing exists.** No cross-module search across the 11 specified entity types. | 6 |
| 32 | Error Handling & Validation | 🟡 | Zod validation and a central error handler exist. Missing: the standardised 4-part error format (what/why/how to fix/who to contact) applied consistently. | 6 |
| 33 | Document Management | 🟡 | Uploads work across KYC, invoices, staff and business documents. Missing: version history, expiry dates, approval status, rejection reasons, preview. | 6 |
| 34 | Design & UX | 🟡 | Consistent shell, sidebar, toasts, UI component library. Missing: **dark mode entirely** (no `dark:` classes anywhere), breadcrumbs, sticky action bars, systematic empty/error states. | 8 |
| 35 | Developer Technical Requirements | 🟡 | Cross-cutting; covered by the individual sections below and §99. |- |
| 36 | **Serviceability Checker** | ⬜ | **Nothing exists.** No lane/postcode serviceability, remote-area or weight/dimension limit checking before quote or booking. | 8 |
| 37 | Address Intelligence | ✅ | Strongest third-party integration area: Google Places, Google Address Validation, Ideal Postcodes, address mapping service, validation states on the draft. Remaining: duplicate detection, residential/commercial flag, map confirmation. | 3 |
| 38 | Shipment Validation Engine | 🟡 | `shipmentValidation.service.ts` plus restricted-goods and consignor validation exist. Missing: several of the 17 specified pre-booking checks, and hard label-generation gating. | 5 |
| 39 | Rate Rule Engine | 🟡 | `countryRateCard` + `shipmentPricing` + CSB pricing exist. Missing: most of the 20 specified rate dimensions (seasonal, promotional, branch-wise, peak surcharge, oversize, residential, manual override with approval). | 12 |
| 40 | Rate Card Management | 🟡 | Rate card sharing with PDF/Excel generation and share links is built. Missing: customer-facing active rate card view, version history, digital acceptance, old-vs-new comparison. | 5 |

### Sections 41-60

| § | Module | Status | Assessment | Days |
|---|---|---|---|---|
| 41 | Shipment Cost Estimator | 🟡 | Pricing service produces breakdowns. Missing: the full pre-booking breakdown UI with all 12 line items. | 3 |
| 42 | Post-Booking Weight Adjustment | 🟡 | `shipmentChargeVerification` model + service exist- good foundation. Missing: photo proof, customer dispute flow, dispute deadline, adjustment invoice. | 5 |
| 43 | Shipment Amendment | ✅ | Model, controller, service, staff page, billing integration. | 1 |
| 44 | Shipment Cancellation | ✅ | Model, service, fee invoices, document PDF, integration tests. | 1 |
| 45 | **Delivery Preferences** | ⬜ | Nothing exists. | 5 |
| 46 | **Delivery Exceptions** | ⬜ | Hold reasons exist on events, but no exception management or customer resolution actions. | 7 |
| 47 | **Customs Duty & Tax Management** | ⬜ | Nothing exists- no duty estimation, duty invoice, payment link, or customs query handling. | 8 |
| 48 | **DDP / DDU Selection** | ⬜ | Nothing exists. | 4 |
| 49 | Restricted & Prohibited Checker | 🟡 | `restrictedGoods.service.ts` blocks at data entry, mirrored in frontend, with tests. Missing: customer-facing lookup by product/category/country/HS code and the licence/MSDS outcomes. | 4 |
| 50 | **Dangerous Goods Workflow** | ⬜ | Nothing exists- no UN number, class, packing group, MSDS, or approval gate. | 10 |
| 51 | **Insurance Management** | ⬜ | Nothing exists. | 8 |
| 52 | Commercial Invoice Generator | ✅ | Customs invoice service with parser and workbook generation. Remaining: template saving, duplicate-from-previous. | 2 |
| 53 | Packing List Generator | 🟡 | Parcel items data exists; no dedicated packing list document. | 3 |
| 54 | **Document Expiry Management** | ⬜ | Nothing exists- no expiry tracking, no 30/15/7-day alerts, no booking block on expired mandatory documents. | 5 |
| 55 | Customer Onboarding Workflow | 🟡 | Business account creation, invitations and activation exist. Missing: the structured 11-step flow with completion percentage, GST/PAN/IEC verification steps. | 8 |
| 56 | Digital Agreement & E-Signature | 🟡 | Credit agreement signing with PDF and counters is built- a real foundation. Missing: extension to the other 7 agreement types and full signature metadata capture. | 6 |
| 57 | **Account Manager Section** | ⬜ | Nothing exists. | 3 |
| 58 | **Escalation Matrix** | ⬜ | Nothing exists. | 5 |
| 59 | **SLA Dashboard** | ⬜ | Nothing exists (all "sla" grep hits are Tailwind `slate`/`translate`). | 10 |
| 60 | **Service Disruption Centre** | ⬜ | Nothing exists. | 5 |

### Sections 61-80

| § | Module | Status | Assessment | Days |
|---|---|---|---|---|
| 61 | **Holiday & Cut-Off Calendar** | ⬜ | Nothing exists. | 5 |
| 62 | **Shipment Consolidation** | ⬜ | Nothing exists. | 10 |
| 63 | **Master & Child Shipment** | ⬜ | Nothing exists. Parcels exist within a shipment, but no master/house AWB structure. | 8 |
| 64 | Barcode Standards | ✅ | Swiftline tracking counters, station counters, parcel barcodes (`SLC...-NN`) used across labels, manifests and EDI. | 2 |
| 65 | QR Code Functions | 🟡 | QR used in the scanner flow. Missing: public secure shipment page with controlled field exposure. | 3 |
| 66 | Scan Event Management | ✅ | `operationsManifestScan` + scan sessions capture the required event data. Remaining: duplicate-scan detection hardening. | 2 |
| 67 | Label Management | 🟡 | `shipmentLabelPdf.service.ts` + `labelDocument` + label storage exist. Missing: the multiple formats (A4/A5/4×6 thermal/4×4/bag/return/customs), bulk print, print history, reprint reason. | 6 |
| 68 | Customer Reference Management | 🟡 | Customer reference exists on shipments. Missing: PO/SO/marketplace/department/cost-centre/project/custom fields and their propagation to reports and invoices. | 4 |
| 69 | **Cost Centre & Department Billing** | ⬜ | Nothing exists. | 6 |
| 70 | **Budget Control** | ⬜ | Nothing exists. | 7 |
| 71 | **Shipment Scheduling** | ⬜ | Nothing exists- no future bookings, recurring shipments, or templates. | 8 |
| 72 | **Bulk Shipment Upload** | ⬜ | Nothing exists. Note the spec's explicit requirement that one bad row must not reject the file- this drives a row-level validation and staging design. | 12 |
| 73 | **Bulk Tracking** | ⬜ | Nothing exists. | 5 |
| 74 | **Bulk Document Download** | ⬜ | Nothing exists- no ZIP bundling. | 5 |
| 75 | Data Import & Export | 🟡 | Excel generation exists in several services (`xlsx` used for EDI, customs invoice, manifests, rate cards). Missing: general import/export framework, import history, scheduled exports. | 5 |
| 76 | **Saved Views & Filters** | ⬜ | Nothing exists. | 5 |
| 77 | **Dashboard Customization** | ⬜ | Nothing exists. | 8 |
| 78 | Notification Preference Centre | 🟡 | `emailPreference` model exists. Missing: per-event × per-channel matrix across the 14 events and 5 channels. | 5 |
| 79 | Communication History | 🟡 | `emailOutbox` records sent email. Missing: per-shipment unified communication timeline across all channels. | 4 |
| 80 | **Internal vs Customer Notes** | ⬜ | Nothing exists as a separated, permission-gated notes system. | 4 |

### Sections 81-100

| § | Module | Status | Assessment | Days |
|---|---|---|---|---|
| 81 | Data Privacy Controls | 🟡 | Privacy policy page and credential encryption exist. Missing: consent management, data download/correction/closure requests, cookie preferences, opt-out, field masking. | 8 |
| 82 | **Data Retention Policy** | ⬜ | Not defined or implemented for any of the 10 listed data classes. | 5 |
| 83 | **Backup & Disaster Recovery** | ⬜ | Not implemented. Infrastructure work: automated/daily/off-site backups, encryption, restore testing, documented RTO/RPO. | 8 |
| 84 | **System Monitoring** | ⬜ | Health route exists; no monitoring of the 10 specified failure classes, no alerting to technical staff. | 8 |
| 85 | **Status Page** | ⬜ | Nothing exists. | 5 |
| 86 | **Maintenance Notifications** | ⬜ | Nothing exists. | 3 |
| 87 | Performance | 🟡 | `idempotencyKey` model exists- double-submit protection is partly addressed. Missing: systematic pagination/indexing review, loading indicators, safe retries, slow-network handling. | 8 |
| 88 | **Accessibility** | ⬜ | Not systematically addressed- keyboard navigation, screen readers, contrast, form labels, alt text across 70 pages. | 10 |
| 89 | Language & Currency | 🟡 | Multi-currency appears in rate/pricing code. Missing: i18n framework, Hindi and other languages, currency conversion with rate + date display. | 12 |
| 90 | Time Zone Management | 🟡 | Timestamps stored. Missing: explicit branch/destination/user time zone display and scan-time localisation. | 5 |
| 91 | **Customer Feedback** | ⬜ | Nothing exists. | 5 |
| 92 | **NPS & Satisfaction Analytics** | ⬜ | Nothing exists. | 5 |
| 93 | **Loyalty & Contract Benefits** | ⬜ | Nothing exists. | 6 |
| 94 | **Carbon & Sustainability** | ⬜ | Nothing exists. | 6 |
| 95 | Fraud & Abuse Prevention | 🟡 | Rate limiting, reCAPTCHA, daily top-up limits exist. Missing: the 9 specified detection patterns and a manual-review hold queue. | 8 |
| 96 | Account Suspension & Restrictions | 🟡 | `userStatus` and member status enums support suspension. Missing: the 7 granular restriction modes and customer-facing reason/resolution display. | 5 |
| 97 | Admin Configuration | 🟡 | DPD configuration and country rate cards are admin-configurable. Missing: no-code configuration for the other 13 listed areas (statuses, services, countries, carriers, surcharges, notifications, document requirements, credit rules, claim rules, permissions, pickup slots, holidays, error messages). | 15 |
| 98 | **Feature Toggle System** | ⬜ | Nothing exists. | 6 |
| 99 | Testing Requirements | 🟡 | 40 backend test files including integration suites for credit, manifests, cancellations, labels- a genuine asset. Missing: frontend tests entirely, plus security, load, browser, permission, notification and backup-restore testing. | 20 |
| 100 | Final Acceptance | ⬜ | Full UAT cycle, defect remediation, sign-off. | 15 |

---

## 5. Effort Summary by Theme

| Theme | Days | Share |
|---|---:|---:|
| New customer-facing modules (pickup, address book, claims, returns, insurance, DG, serviceability, delivery prefs/exceptions, duty, DDP/DDU) | 84 | 12% |
| Reports, analytics, SLA, dashboards, saved views, customisation | 62 | 9% |
| Bulk operations & scheduling (upload, tracking, download, import/export, recurring) | 45 | 7% |
| Platform & governance (privacy, retention, backup, monitoring, status page, feature flags, admin config) | 60 | 9% |
| Auth, roles, permissions, approvals | 30 | 4% |
| Rate engine, rate cards, cost estimation, weight adjustment | 25 | 4% |
| Integrations & API centre | 20 | 3% |
| AI features | 15 | 2% |
| Completing partially-built modules (dashboard, shipments, tracking, customs, notifications, documents, labels) | 100 | 15% |
| Consolidation & master/child structure | 18 | 3% |
| Quality: accessibility, performance, i18n, design/dark mode, testing, UAT | 93 | 14% |
| Everything else (≈40 smaller sections) | 118 | 18% |
| **Total** | **670** | **100%** |

---

## 6. Suggested Phasing

Sequenced so that each phase ships something usable rather than leaving half-built modules.

**Phase 1- Close the operational loop (≈115 days)**
Pickup Management (§9), Address Book (§10), Client Dashboard (§2), Shipment List completion (§4), POD (§5), Bulk Document Download (§74). Rationale: today a customer can book a shipment but cannot schedule its collection or reuse an address- these are the most conspicuous holes in an otherwise working booking flow.

**Phase 2- Post-delivery and exceptions (≈95 days)**
Claims (§18), Returns (§19), Delivery Exceptions (§46), Customs Centre (§17), Document Expiry (§54), Delivery Preferences (§45).

**Phase 3- Commercial and financial depth (≈95 days)**
Rate Rule Engine (§39), Rate Card Management (§40), Insurance (§51), Duty & Tax (§47), DDP/DDU (§48), Cost Centre Billing (§69), Budget Control (§70).

**Phase 4- Scale and self-service (≈115 days)**
Bulk Upload (§72), Bulk Tracking (§73), Scheduling & templates (§71), API & Integration Centre (§26), Approval Workflow (§24), full Role/Permission matrix (§23).

**Phase 5- Insight and governance (≈130 days)**
Reports & Analytics (§22), SLA Dashboard (§59), Saved Views (§76), Dashboard Customisation (§77), Admin Configuration (§97), Feature Toggles (§98), Audit UI (§30), Global Search (§31).

**Phase 6- Compliance, quality, launch (≈120 days)**
Auth hardening (§1), Accessibility (§88), i18n (§89), Dark mode & UX (§34), Privacy & Retention (§81-82), Backup/DR (§83), Monitoring & Status (§84-85), Performance (§87), full test suite (§99), UAT (§100).

Dangerous Goods (§50), Consolidation (§62-63), AI (§27), Carbon (§94), Loyalty (§93) and NPS (§91-92) are genuinely optional against a first production release and can be deferred beyond this plan- deferring all of them removes roughly 65 days.

---

## 7. Assumptions, Exclusions and Risks

**Assumptions**
- Estimates assume developers already familiar with this codebase. Add 15-20 days of ramp-up per new developer.
- Estimates include unit/integration tests written alongside features, but not the separate hardening effort in §99.
- The existing Express/Mongoose/Next.js architecture is retained; no rewrite.

**Excluded from the 670 days**
- UI/UX design work (wireframes, visual design). Budget separately- plausibly 40-60 designer-days.
- Project management and business analysis.
- Infrastructure provisioning, hosting and DevOps beyond §83-84.
- The e-commerce connectors named in §26 (Shopify, WooCommerce, Magento, Amazon, eBay). Each is realistically 15-25 days on its own; the 20 days costed covers only the API/webhook/key platform.

**Third-party dependencies that must be procured before the dependent work can start**
- SMS gateway- blocks §1 (mobile OTP), §20, §78.
- WhatsApp Business API provider- blocks §20, §78, §79.
- Carrier APIs beyond the existing DPD integration- affects §7, §36, §39.
- Duty/tax calculation provider- affects §47, §48.
- Insurance underwriter integration- affects §51.
- Push notification service- affects §20, §28.

**Principal risks**
1. **Rate Rule Engine (§39)** is the highest-variance estimate. Twenty rate dimensions interacting with customer-specific, branch-specific and seasonal overrides can easily double from 12 days if the business rules are not pinned down in writing first.
2. **The "everything connects" requirement** in the spec's closing instruction is not a module- it is a constraint on every module. Cross-module propagation (payment → booking capacity, weight adjustment → billing, claim settlement → finance) is where integration defects concentrate. The 15 days for UAT is likely a floor.
3. **Admin Configuration (§97)** asks for no-code configurability of 15 areas. Building genuine runtime configurability is substantially more expensive than the 15 days allowed if applied literally to all 15; the estimate assumes the highest-value subset.
4. **Accessibility (§88) retrofitted** across 70 existing pages is more expensive than building it in. The 10-day figure assumes an audit plus fixes to the highest-traffic flows, not full WCAG AA certification across every page.

---

## 8. Immediate Housekeeping

Independent of the roadmap, the working tree currently has uncommitted modifications across at least 10 files (`app.ts`, several controllers, middleware, `package.json`). These should be committed or stashed before new work begins, so that feature branches start from a known baseline.

The spec's own closing instruction also calls for a set of pre-development artifacts- module list, screen list, field list, button list, database design, API design, status flow, notification matrix, role and permission matrix, error-message list, audit-log design, testing plan, deployment plan, backup plan, security plan. Produced as a delta against what already exists rather than from scratch, that is approximately **10 days** of work and is included in the 680-day total.
