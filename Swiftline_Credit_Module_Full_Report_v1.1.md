# SWIFTLINE CREDIT MODULE

## Full Functional and Technical Report

**Version:** 1.1  
**Status:** Complete development baseline  
**Prepared for:** Swiftline Cargo and Express Logistics  
**Report date:** 20-07-2026  
**Currency:** INR  
**Business time zone:** Asia/Kolkata  
**Portal date format:** DD-MM-YYYY

---

## 1. Executive Summary

The Swiftline Credit Module gives each business account one shared company-level financial facility. It combines Customer Advance and approved credit into a single booking-capacity figure while keeping the two balances financially separate.

The module covers the complete path from a customer requesting credit through Finance review, agreement signing, deposit receipt, activation, shipment booking, final charge verification, amendments, shipment invoices, billing statements, payments, overdue controls, cancellations, ledger reconciliation, notifications, and audit history.

Each shipment tax invoice remains the legal GST document. A credit billing statement is a non-tax collection document that groups eligible unpaid tax invoices and later financial adjustments. GST is not charged again on the billing statement.

## 2. Completed Capabilities

| Capability | Current behavior |
|---|---|
| Credit request | Eligible business members request a company credit facility and provide the requested limit and reason. |
| Finance review | Swiftline Admin/Finance configures the approved limit, payment terms, billing cycle, validity, risk category, overdue rules, warning threshold, and required deposit. |
| Credit agreement | A versioned agreement PDF is generated from an immutable account and terms snapshot and signed through the portal. |
| Security deposit | Razorpay payments confirm automatically. Bank transfer, UPI, cash, and cheque require Admin/Finance verification. |
| Customer Advance | Captured top-ups and excess statement payments become customer-owned advance funds. |
| Booking capacity | Available Customer Advance and available approved credit are combined for shipment eligibility. |
| Shipment booking | The server calculates the GST-inclusive shipment charge and atomically funds the booking. |
| Final charge verification | Operations verifies parcel weight and dimensions after Parcel Collected and before Warehouse Scan In. |
| Amendments | Client or Admin requests changes; only Admin approval changes shipment data and billing. |
| Invoice revisions | Approved financial amendments create a new immutable shipment invoice revision while preserving earlier versions. |
| Billing cycles | Finance closes completed weekly or monthly periods and generates consolidated business-account statements. |
| Payments | Razorpay and verified offline payments settle the oldest unpaid debt first. Partial and excess payments are supported. |
| Overdue controls | Grace warnings, credit-only restrictions, and full booking/amendment blocks are enforced. |
| Cancellations | Eligible shipments can be cancelled with Admin review, GST credit note, fee invoice, refund, and full financial history. |
| Notifications | In-portal notifications cover financial and operational events with links to the relevant page. |
| Ledger | Append-only financial entries are available to Client and Admin with CSV export. |

## 3. Roles and Access

### Client business roles

| Role | Credit financial pages | Request credit | Use booking capacity | Pay statements | Request cancellation |
|---|---:|---:|---:|---:|---:|
| Account Owner | Yes | Yes | Yes | Yes | Yes |
| Account Admin | Yes | Yes | Yes | Yes | Yes |
| Finance | Yes | Yes | Yes | Yes | No |
| Operations | No | No | Yes | No | Yes |
| Tracking Only | No | No | No | No | No |

Finance members can close a billing cycle from the client-side Finance workflow. Swiftline Admin/Finance staff can configure facilities, generate agreements, verify offline payments, close cycles, and review cancellations.

Every API enforces authentication, business-account membership, account-level data isolation, assigned-branch access, and role permissions. Hiding a button in the frontend is never the only access control.

## 4. Credit Account Lifecycle

The supported credit states are:

1. `NOT_REQUESTED` - no credit request exists; Customer Advance can still provide booking capacity.
2. `PENDING_REVIEW` - the customer request is awaiting Swiftline review.
3. `APPROVED` - Finance approved the facility, but activation requirements remain.
4. `ACTIVE` - approved credit can be used for shipment bookings.
5. `ON_HOLD` - use is temporarily stopped with a recorded reason.
6. `SUSPENDED` - the facility is suspended by Swiftline.
7. `EXPIRED` - the approved validity period has ended.
8. `REJECTED` - the request was rejected.
9. `CLOSED` - the facility is permanently closed.

Credit activation requires all applicable conditions:

- Business account status is Approved or Active.
- KYC overall status is Verified.
- Approved credit limit is greater than zero.
- Credit agreement is Signed.
- Required security deposit is Received, unless the required amount is zero.
- Credit validity has not expired.

Agreement, deposit, KYC, branch assignment, and client-access actions update only their own records. They do not overwrite the business account status or assigned branch.

## 5. Finance Configuration Fields

| Field | Purpose |
|---|---|
| Requested Credit Limit | Amount requested by the customer before Finance review. |
| Approved Credit Limit | Maximum Swiftline-funded credit facility. It does not include Customer Advance. |
| Payment Terms | Supported due periods are 0, 7, 15, 30, or 45 days from statement issue. |
| Billing Cycle | Weekly or Monthly statement grouping. |
| Grace Period Days | Warning period after the due date during which booking remains available. |
| Maximum Overdue Days | Age after which both credit and Customer Advance shipment activity are blocked. |
| Warning Threshold | Percentage of approved credit in use that triggers a low-capacity notification. |
| Required Deposit | Security held against the facility. It is not spending balance and does not increase booking capacity. |
| Valid From / Until | Approved facility validity window. |
| Risk Category | Internal Low, Medium, or High classification. |
| Finance Approver | Internal owner of the facility review. |
| Internal Remarks | Private Finance notes never exposed to customer users. |

## 6. Balance Model

The module stores money as integer minor units to avoid floating-point errors.

**Used Credit**

`Reserved Credit + Unbilled Credit + Invoiced Outstanding`

**Available Credit**

`Approved Limit - Used Credit`

**Available Customer Advance**

`Customer Advance Balance - Reserved Advance`

**Normal Booking Capacity**

`Available Customer Advance + Available Credit`

Customer Advance is used first. Approved credit funds only the remainder. A security deposit is never included in any booking-capacity calculation.

An advance-only customer works without an active credit facility: available credit is zero, while Customer Advance remains usable unless a maximum-overdue restriction blocks all shipment activity.

## 7. Agreement and Security Deposit

Finance generates an agreement from a snapshot of the approved account and credit terms. The snapshot and generated PDF are immutable and versioned. The customer views and signs the agreement in the portal, and the signing record stores the user, timestamp, IP information, and agreement version.

Required deposit handling:

- Razorpay: captured payment updates deposit receipt automatically.
- Offline payment: Bank transfer, UPI, cash, or cheque stays pending until Admin/Finance verifies it.
- The deposit has its own payment history and invoice/receipt.
- The deposit is collateral, not Customer Advance, and cannot be spent on shipments.
- Paying the deposit does not by itself activate credit; every activation requirement must be complete.

## 8. Customer Advance and Top-Ups

Top-ups are now treated as Customer Advance rather than a prepaid wallet.

- Customer Advance belongs to the customer.
- It is used before approved credit.
- It does not increase the approved credit limit.
- Excess statement payment becomes Customer Advance.
- Security deposit payments do not become Customer Advance.
- Captured top-ups and verified offline payments are idempotent and cannot be applied twice.

## 9. Shipment Booking and Funding

The server performs the authoritative shipment calculation using destination country, service type, parcel measurements, rate slab, chargeable weight, and 18% GST.

For each parcel:

- Courier volumetric weight = `L x W x H / 5000`.
- Cargo volumetric weight = `L x W x H / 6000`.
- Chargeable weight is the higher of Actual Weight and Volumetric Weight.
- The matching country/service rate slab supplies the per-KG charge.
- Parcel charges are calculated separately and summed.
- GST is included in the amount reserved at booking.

Booking uses one atomic balance reservation across Customer Advance and approved credit. If the full amount is not available, no partial financial record or shipment booking is left behind.

After successful booking:

- The reservation converts into a shipment charge.
- Customer Advance used is removed from the available advance balance.
- Credit used becomes an unbilled credit charge.
- A legal GST shipment invoice is generated.
- The immutable pricing snapshot preserves the applied rate and parcel calculation.

## 10. Final Charge Verification

Final charge verification is an explicit Operations/Admin action normally available after Parcel Collected and before Warehouse Scan In.

Operations enters the final actual weight and dimensions for every parcel. The server recalculates chargeable weight, rate, GST, and funding. Any difference is applied atomically and a revised invoice is generated when required.

Verification is blocked when:

- A shipment amendment is pending.
- A cancellation request is pending.
- The shipment has been cancelled.
- The shipment has already progressed to Warehouse Scan In or later.

## 11. Amendments and Invoice Revisions

Amendments are available through Parcel Collected and blocked after that point. Client and Admin can request supported changes, but only Admin approval changes shipment data.

Supported amendment areas include consignee details, delivery address, service type, parcel weight, dimensions, contents, and delivery instructions.

Flow:

1. Client or Admin changes fields and requests a charge preview.
2. The server compares the request with the current saved shipment.
3. Only fields that actually changed are stored and displayed.
4. Current and requested parcel pricing are shown side by side.
5. The request remains pending without changing shipment data or balances.
6. Admin approves or rejects from the Amendments page.
7. Approval rechecks available capacity and applies the financial difference atomically.
8. A new immutable shipment invoice revision is generated.

If an increase cannot be funded, approval is blocked with a contact-branch message. A reduction restores credit first and refunds any remaining value to Customer Advance.

If an amendment is approved after the original invoice is already on a statement, the issued statement is never rewritten. The difference appears as an adjustment on the next statement.

## 12. Shipment Tax Invoices

Every booked shipment has a GST tax invoice containing the customer GSTIN, supplier branch GSTIN, parties, shipment reference, parcel-level weights and charges, taxable value, GST split, and total amount.

Invoice rules:

- The invoice number remains stable across revisions.
- Revisions are shown as Invoice 1, Invoice 2, and so on.
- Older revisions remain viewable and immutable.
- View, Download, and Print actions are available to authorized users.
- The document states that it is computer generated from Swiftline Portal.

## 13. Billing Statements

Statements are consolidated per business account across all eligible branches and use INR only.

- Weekly period: Monday through Sunday in Asia/Kolkata.
- Monthly period: first through last calendar day in Asia/Kolkata.
- Due date is calculated from the statement issue date.
- Manual cycle closing is currently available to Admin/Finance.
- Closing is idempotent; the same completed period cannot create a second statement.

Statements contain shipment invoices, cancellation fee invoices, and approved billing adjustments. They do not calculate GST again.

Issued statement lines and totals are historical records. Payments and valid credit adjustments update the settled and outstanding figures without silently replacing the original lines.

## 14. Payments and Allocation

Supported methods:

- Razorpay online payment, confirmed automatically after verification.
- Bank transfer, UPI, cash, and cheque, verified manually by Admin/Finance.

Allocation order:

1. Oldest unpaid billing statement first.
2. Oldest unpaid tax document within that statement first.
3. Partial payments are allowed.
4. Excess payment becomes Customer Advance.

Only a verified payment restores available credit. Pending or failed payments do not change balances.

## 15. Overdue Controls

The module applies three stages:

1. **Within grace period:** warning is shown; credit and Customer Advance bookings remain available.
2. **After grace period:** approved credit use is blocked; Customer Advance remains available.
3. **After maximum overdue days:** all new shipment bookings and amendments are blocked, including advance-funded activity.

Paying the overdue statement recalculates the restriction immediately. Client and Admin balance views use the same restriction result.

## 16. Shipment Cancellation and Voiding

Cancellation is a complete financial workflow, not a deletion.

### Eligibility

- Client cancellation is allowed only while the shipment is at Shipment Booked.
- Once Parcel Collected, client cancellation is blocked.
- Admin can approve an operational exception until Warehouse Scan In.
- The entire shipment is cancelled; individual parcel cancellation is not supported in this version.
- Account Owner, Account Admin, and Operations may request cancellation.
- Finance and Tracking Only cannot request cancellation.

### Pending request lock

While a cancellation request is pending, the system blocks:

- Amendments.
- Final charge verification.
- Hold and release actions.
- Tracking-status progression.

### Admin review

Admin sees the original charge, requested reason, cancellation fee, GST, refundable amount, and account/branch context. Approval requires:

- Carrier cancellation confirmation.
- Explicit financial settlement confirmation.
- Optional carrier reference.
- Mandatory explanation when the fee before GST is above INR 700.

### Fee and refund

- Standard fee before GST: INR 700.
- GST: 18%.
- Standard fee total: INR 826.
- Admin may enter a higher carrier/handling fee with a reason.
- If the shipment amount is below the fee, the fee is capped at the shipment amount.
- Cancellation never creates an extra payable amount beyond the original shipment charge.
- Refundable amount is credited to Customer Advance after approval.

### Financial documents

- A full GST credit note reverses the original shipment invoice.
- Credit note sequence: `CN/26-27/00001`.
- A separate cancellation-fee tax invoice records the fee and GST.
- Both documents support View, Download, and Print.
- The original shipment invoice becomes VOID but is never deleted.

### Credit and statement treatment

- The original invoice's remaining credit is reversed.
- Any unpaid portion of the cancellation fee becomes a new unbilled credit charge.
- Any true refundable remainder becomes Customer Advance.
- If the original invoice was already on a statement, the historical statement lines and total remain unchanged.
- The original statement receives the valid settlement credit against its outstanding amount.
- Only the unpaid cancellation-fee invoice appears on the next billing statement.

### Completed state

After approval, the shipment timeline ends with Shipment Cancelled. Amendments, verification, hold/release, and future tracking progression remain permanently blocked.

## 17. Notifications

Current in-portal notifications include:

- Credit statement generated.
- Credit statement due soon.
- Credit statement overdue.
- Payment confirmed.
- Offline payment awaiting verification.
- Credit capacity running low.
- Shipment cancellation requested.
- Shipment cancellation completed.
- Shipment cancellation rejected.

Notifications use clear messages, timestamps, read/unread state, and direct links to the relevant action or document.

## 18. Ledger and Reconciliation

The append-only credit ledger records requests, approvals, activation, reservations, booking conversion, amendments, final verification, statements, payments, advances, refunds, and cancellations.

Client and Admin account statement views show the same resulting balances. CSV export supports Finance reconciliation. Issued invoices, credit notes, fee invoices, agreements, statements, and ledger entries are retained for audit history.

## 19. Main Portal Routes

| Area | Route |
|---|---|
| Client Credit Account | `/client/credit` |
| Client Statements | `/client/credit/statements` |
| Client Statement Detail | `/client/credit/statements/[statementId]` |
| Client Ledger | `/client/credit/ledger` |
| Client Payments and Advance | `/client/payments` |
| Payment Terms | `/client/credit/payment-terms` |
| Client Shipment and Cancellation | `/client/shipments/[draftId]` |
| Admin Credit Accounts | `/dashboard/credit-accounts` |
| Admin Credit Detail and Reconciliation | `/dashboard/credit-accounts/[businessAccountId]` |
| Admin Amendments | `/dashboard/amendments` |
| Admin Cancellations | `/dashboard/cancellations` |
| Admin Shipment Detail | `/dashboard/shipments/[draftId]` |

## 20. Verification Evidence

The completed implementation has passed:

- Backend TypeScript production build.
- Frontend ESLint verification.
- Frontend Next.js production build with 30 routes.
- Credit balance, permission, activation, and model safeguard tests.
- Agreement snapshot, PDF, storage, and lifecycle tests.
- Atomic shipment booking and release tests.
- Amendment preview, increase, reduction, and insufficient-capacity tests.
- Shipment invoice revision tests.
- Weekly/monthly billing-cycle and immutable-statement tests.
- Online/offline, partial, excess, and idempotent payment tests.
- Grace-period and overdue-restriction tests.
- Six shipment-cancellation policy tests.
- Two MongoDB cancellation transaction tests, including next-cycle fee billing.
- Manual role-access, statement, payment, notification, invoice, ledger, and restriction scenarios.

## 21. Deferred Production Enhancements

The current module is complete for the development baseline. The following are intentional later enhancements:

- Automatic scheduled weekly/monthly cycle closing.
- Email notifications in addition to portal notifications.
- External Razorpay or bank refund processing from a completed cancellation.
- Partial parcel cancellation.
- Finance dashboard for aged receivables and collection KPIs.
- Accountant review and final legal approval of GST agreement, credit-note, and fee-invoice wording before production launch.

## 22. Recommended Next Portal Work

Before starting a new domain, perform one manual cancellation acceptance test using a real development account: request, approve, verify balances, open both documents, and close the next billing cycle.

The recommended next major module is **Shipment Tracking and Operations Visibility** because the portal already stores a reliable shipment-event timeline. This module should provide:

- Client Track Shipment search and shipment list filters.
- A dedicated tracking-detail page with the current milestone, completed timeline, and exception state.
- Admin operations queue by branch, route, status, hold, and delayed activity.
- Shipment reference and parcel number search.
- Customer-visible versus internal-only event notes.
- Proof of delivery and delivery completion details when available.
- Tracking notifications linked to the affected shipment.

After tracking, the recommended order is:

1. Pickup Requests and branch pickup operations.
2. Support Tickets linked to business accounts and shipments.
3. Claims and exception handling for Lost, Damaged, and Returned shipments.
4. Operational and Finance reporting dashboards.
5. Automatic billing-cycle scheduling and email notifications.

## 23. Completion Statement

The Swiftline Credit Module now provides one consistent, auditable financial record from credit request through agreement, deposit, shipment booking, amendments, invoicing, statement generation, collection, overdue restriction, cancellation, refund, and reconciliation.

The module is complete for the current development phase. Its remaining items are production automation, external refund execution, advanced reporting, and final legal/accounting review rather than missing core financial behavior.
