# Payment Flow Reference

This document records the payment and billing behavior currently built in the portal. Keep it updated whenever prepaid balance, Razorpay, DPD label billing, or shipment finance behavior changes.

## Current Billing Model

There are two separate label payment paths:

1. Admin label creation uses `ADMIN_DIRECT`.
2. Client self-serve label creation uses `CLIENT_PREPAID`.

These paths are intentionally separate. Admins can keep creating operational labels through the DPD account while the client prepaid flow is developed and tested.

## Admin DPD Label Flow

Flow:

1. Admin reviews or updates a shipment draft.
2. Admin clicks create DPD label.
3. The portal validates the draft and DPD payload.
4. The portal calls the configured DPD API.
5. DPD bills the main Swiftline DPD account directly.
6. The saved DPD shipment is marked with `paymentSource: ADMIN_DIRECT`.

No client wallet top-up, reservation, or ledger debit is required for admin labels.

## Client Prepaid Label Flow

Client-created labels are designed to use wallet balance before the portal calls DPD.

Flow:

1. Client uploads or edits a shipment draft from the client dashboard.
2. Client submits create DPD label.
3. The server confirms the draft belongs to the client's active business account and allowed branch.
4. The server calculates the label charge. The browser is not trusted to send the amount.
5. The server reserves prepaid balance using `CLIENT_PREPAID`.
6. The portal calls DPD.
7. If DPD creates the label, the reservation is converted and the wallet cash balance is debited.
8. If DPD rejects the request, the reservation is released.
9. If DPD times out or returns an uncertain result, the reservation is marked review-required so admin can reconcile it.

The client cannot set `paymentSource`, charge amount, reservation status, or shipment charge status directly.

## Razorpay Top-Up Flow

Client top-ups use Razorpay order and webhook confirmation.

Flow:

1. Client requests a top-up with an amount in minor units.
2. The server validates the amount and requires an `Idempotency-Key`.
3. The server creates a Razorpay order and stores a `PaymentTopUp`.
4. The checkout signature endpoint only verifies the checkout response.
5. Wallet credit happens only after trusted Razorpay webhook confirmation.
6. `payment.captured` and `order.paid` are idempotent by Razorpay payment id.
7. Replayed webhooks do not double-credit the wallet.

## Local Razorpay Webhook Testing

When testing Razorpay locally, Razorpay cannot call `localhost:5000` directly. Use ngrok only as a temporary local-development bridge.

Local command:

```bash
ngrok http 5000
```

Add this webhook URL in the Razorpay Test Mode dashboard:

```text
https://your-ngrok-url.ngrok-free.app/api/v1/webhooks/razorpay
```

Enable these test webhook events:

- `payment.captured`
- `payment.failed`
- `order.paid`

Keep using the same `RAZORPAY_WEBHOOK_SECRET` in the backend `.env` and in the Razorpay webhook setup.

Remove or replace the ngrok URL when:

- testing is done for the day and the ngrok URL expires,
- the backend is deployed to a real staging or production domain,
- switching from Razorpay Test Mode to Live Mode.

Production must use the deployed backend URL instead:

```text
https://your-production-api-domain.com/api/v1/webhooks/razorpay
```

Do not hardcode the ngrok URL in the codebase. It belongs only in the Razorpay dashboard for local testing.

## Money Rules

All money values are stored and calculated as integer minor units, currently paise for INR.

Examples:

- Rs. 100.00 is stored as `10000`.
- Rs. 25.00 is stored as `2500`.

Do not use decimal floats for balances, charges, top-ups, reservations, or ledger entries.

Every money movement must produce exactly one append-only ledger entry. Balance field updates must happen inside the same MongoDB transaction as the ledger write.

## Built So Far

Implemented:

- Prepaid account, top-up, reservation, ledger, shipment charge, and webhook models.
- Atomic prepaid balance reservation and conversion services.
- Razorpay order helper, signature verification, webhook handler, and idempotency tests.
- Client prepaid account/top-up API endpoints.
- Client label billing service that reserves, completes, releases, or marks review-required.
- Admin label creation defaults to `ADMIN_DIRECT`.
- Client label creation route calls the prepaid billing path.

## Configuration

`CLIENT_DPD_LABEL_CHARGE_MINOR` controls the temporary server-derived client label charge.

Current default:

```env
CLIENT_DPD_LABEL_CHARGE_MINOR=0
```

When the value is `0`, client prepaid label creation is disabled with a clear server error. This avoids fake pricing before the real rate/tariff module is ready.

Set it to a positive integer minor-unit amount only when testing prepaid label creation.

Example:

```env
CLIENT_DPD_LABEL_CHARGE_MINOR=2500
```

That means Rs. 25.00 per label attempt.

## Still To Do

Before final production launch:

- Replace the temporary fixed `CLIENT_DPD_LABEL_CHARGE_MINOR` with real server-side rate calculation.
- Add admin finance screens for prepaid balances, top-ups, reservations, and shipment charges.
- Add client UI for wallet balance, top-up, top-up history, and prepaid label errors.
- Add reconciliation tooling for `REVIEW_REQUIRED` reservations.
- Decide whether admin-created labels can optionally charge a client wallet later. By default, they should remain `ADMIN_DIRECT`.
- Add production Razorpay keys, webhook secret, and webhook URL in Razorpay dashboard.
- Add final end-to-end tests once real DPD credentials are available.
