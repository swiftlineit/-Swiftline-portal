# S3 Storage Integration Plan

Migrating every document upload in the portal from local disk to S3, behind one
storage abstraction so the two can be switched by configuration.

Status: code complete. Claims was built S3-native, and all ten existing upload
sites now read and write through the storage service. Nothing in the application
touches `private_uploads/` except the local driver itself, which is what
`STORAGE_DRIVER=local` selects.

The remaining work is infrastructure verification — the unchecked rows in
section 7.

---

## 1. Why this exists

Every upload today lands on the API server's local disk under `private_uploads/`,
in ten separate roots. That has three problems:

1. **Files are not in your database backup.** A restore from a MongoDB dump gives
   you records pointing at documents that no longer exist. For claim evidence,
   which carries an eight-year retention obligation, that is the bad case.
2. **No encryption at rest.** Disk-level encryption is an infrastructure concern
   the application cannot assert anything about.
3. **It does not survive more than one API server.** Any horizontal scaling, or
   any container restart on ephemeral storage, loses files.

S3 solves all three. The migration is also the moment to impose one consistent
key structure, because the current roots grew organically.

---

## 2. Configuration

### Environment variables

Three already exist for SES and are reused as-is — S3 needs no separate
credentials:

| Variable | Existing | Notes |
|---|---|---|
| `AWS_REGION` | yes | Defaults to `ap-south-1` |
| `AWS_ACCESS_KEY_ID` | yes | Omit on EC2/ECS to use the instance role |
| `AWS_SECRET_ACCESS_KEY` | yes | Omit on EC2/ECS to use the instance role |

New:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `STORAGE_DRIVER` | no | `local` | `local` or `s3`. The migration switch |
| `S3_BUCKET` | when driver is `s3` | — | Bucket name only, not an ARN or URL |
| `S3_SIGNED_URL_TTL_SECONDS` | no | `300` | Download link lifetime |
| `S3_KEY_PREFIX` | no | — | Namespaces one bucket across environments |
| `S3_ENDPOINT` | no | — | For MinIO or LocalStack in development |

`STORAGE_DRIVER` defaults to `local` deliberately. Nothing changes behaviour
until it is set, tests keep running without AWS credentials, and a rollback is a
config change rather than a deploy.

### Bucket settings

| Setting | Value | Why |
|---|---|---|
| Block Public Access | All four ON | Access is only ever through signed URLs |
| Default encryption | SSE-S3 (AES-256) | The at-rest encryption local disk could not provide |
| Versioning | Enabled | Makes retention and legal hold real — an overwrite or delete stays recoverable |
| Lifecycle expiry | **None** | An expiry rule would destroy evidence under an eight-year retention duty |
| Lifecycle transition | Optional: Standard-IA after 90 days | Cost saving with no correctness risk |
| CORS | Not required | Uploads pass through the API; the browser never talks to S3 directly |

> **Attention — lifecycle rules.** It is easy to add a "delete after N days" rule
> for cost control and not realise it applies to claim evidence under legal hold.
> If a lifecycle expiry rule is ever added, it must exclude the `claims/` prefix.

### IAM policy

The application needs four actions, scoped to the one bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PortalObjectAccess",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::YOUR_BUCKET_NAME",
        "arn:aws:s3:::YOUR_BUCKET_NAME/*"
      ]
    }
  ]
}
```

`ListBucket` is on the bucket ARN; the object actions are on `/*`. Both entries
are needed.

> **Attention — do not reuse the SES user's key if it is broadly scoped.** The
> credentials are shared by configuration, but the *policy* attached to them
> should grant only SES send permissions plus the block above. If the existing
> key carries a wider policy, narrow it now rather than after the migration.

---

## 3. Key structure

S3 has no directories. A key is a single string; the console renders `/` as
folders. Nothing is pre-created — writing an object creates every implied prefix.
So the bucket is created empty and the layout below appears as uploads happen.

### Layout

```
[{prefix}/]{module}/{owner-id}/{document-type}/{uuid}.{ext}
```

| Module | Key pattern | Replaces |
|---|---|---|
| Business account KYC | `business-accounts/{businessAccountId}/kyc/{uuid}.{ext}` | `private_uploads/business-accounts` |
| Branch KYC | `branches/{branchId}/kyc/{uuid}.{ext}` | `private_uploads/branches` |
| Shipment KYC | `shipments/{shipmentDraftId}/kyc/{uuid}.{ext}` | `private_uploads/shipment-kyc` |
| Shipping labels | `shipments/{shipmentDraftId}/labels/{uuid}.pdf` | `private_uploads/labels` |
| Invoice uploads | `invoices/{invoiceId}/{uuid}.{ext}` | `private_uploads/invoices` |
| Credit agreements | `credit-agreements/{agreementId}/{uuid}.pdf` | `private_uploads/` root |
| POD evidence | `pod/{assignmentId}/evidence/{uuid}.{ext}` | `private_uploads/pod-evidence` |
| Pickup proofs | `pickups/{pickupRequestId}/proof/{uuid}.{ext}` | `private_uploads/pickup-proofs` |
| Staff documents | `staff/{userId}/documents/{uuid}.{ext}` | `private_uploads/staff` |
| Profile images | `profile-images/{userId}/{uuid}.{ext}` | `private_uploads/profile-images` |
| **Claim evidence** | `claims/{claimId}/evidence/{uuid}.{ext}` | new |
| **Claim payment proof** | `claims/{claimId}/payment-proof/{uuid}.{ext}` | new |
| **Claim beneficiary proof** | `claims/{claimId}/beneficiary/{uuid}.{ext}` | new |

### Rules the structure enforces

- **The filename is always a server-generated UUID.** A client-supplied name
  never reaches the key. The original name is kept as database metadata only.
  This closes path traversal, double-extension tricks, and collisions in one go.
- **The owner id is in the key.** A key alone identifies what it belongs to,
  which makes orphan detection and per-account deletion straightforward.
- **Everything for one claim shares the `claims/{claimId}/` prefix.** Legal hold,
  retention, and account deletion operate on a prefix rather than a file list.
- **Grouping is by owner, not by date.** Documents are always retrieved through a
  database record that holds the key, never by browsing, so a date hierarchy
  would add nothing.

---

## 4. The abstraction

One service with two drivers. Callers never learn which is active.

```
services/storage/
  storage.service.ts      Public interface — put, get, delete, signed URL
  localDriver.ts          Existing private_uploads behaviour
  s3Driver.ts             S3 implementation
  keys.ts                 Key builders, one per module
```

The interface stays deliberately small:

| Method | Purpose |
|---|---|
| `putObject(key, body, contentType)` | Store bytes, return the key |
| `getObjectStream(key)` | Read for server-side streaming |
| `deleteObject(key)` | Remove |
| `getSignedDownloadUrl(key, filename)` | Time-limited direct link |
| `objectExists(key)` | Health and orphan checks |

### What callers store

Records persist **the key only** — never an absolute path, never a URL. This is
the single most important rule in the migration.

Every record now stores `storageKey`. The fields that used to hold a path or a
multer filename — `path`, `storedName`, `storagePath`, `filePath` — are gone from
`user`, `businessAccount`, `branch`, `shipmentDraft`, `invoiceUpload`,
`labelDocument`, `pickupEvidence`, and `pod`.

One deliberate exception: `invoiceUpload.storageKey` may be empty. An individual
(walk-in) shipment is keyed in at the counter and has no uploaded workbook, but
the shipment chain still requires an invoice record to point at. Readers treat an
empty key as "there is nothing to read", not as a broken reference.

### Download path

Two options, and the choice differs by document type:

1. **Signed URL** — the API returns a short-lived S3 link and the browser fetches
   it directly. Cheaper and faster; the URL is a bearer token for its lifetime.
2. **Streamed through the API** — the server authorises, then pipes the bytes.
   The file is never reachable without a live session.

In the end **every** download streams through the API. Signed URLs remain
available on the S3 driver and are the right tool for bulk or public-ish
documents, but nothing in the portal is in that category: KYC documents carry
Aadhaar, PAN, and tax identifiers, POD and pickup proofs carry recipient
signatures, and claim documents carry loss photographs and bank details. A
signed URL forwarded in an email stays readable until it expires; a streamed
response dies with the session.

There is also no generic "fetch by key" endpoint, deliberately. Every document is
reached through the endpoint that owns it — `/api/v1/branches/:id/documents/:n`,
`/api/v1/staff/:id/documents/:type`, and so on — so the check is always "may
*this* user see *this* record", never "is this user signed in".

---

## 5. What the conversion changed

**The portal was pre-production, so there was no production data to migrate.**
Existing local files were development artefacts and were discarded, which removed
the backfill step, the copy-verify-delete dance, and the dual-read window that
would otherwise have dominated this work.

> **Attention — existing development records are now unreadable.** Every affected
> collection changed field names, so rows written before this change point at
> nothing. Drop and re-seed the development database rather than trying to repair
> them.

All ten sites are converted:

| Module | Record field now | Was |
|---|---|---|
| Profile images | `user.profileImage.storageKey` | `path` + `storedName` |
| Staff documents | `user.staffProfile.documents.*.storageKey` | `path` + `storedName` |
| Business account KYC | `businessAccount.documents.*.storageKey` | `path` + `storedName` |
| Branch KYC | `branch.documents[].storageKey`, `branch.images[].storageKey` | `filePath`, and images were bare relative paths |
| Shipment KYC | `shipmentDraft…kycDocuments.*.storageKey` | `path` + `storedName` |
| Shipping labels | `labelDocument.storageKey` | `storagePath` |
| Invoice uploads | `invoiceUpload.storageKey` | `storagePath` |
| Credit agreements | `creditAgreement…storageKey` | already a key; the resolver was rewritten |
| Pickup proofs | `pickupProof.storageKey` | `path` + `storedName` |
| POD evidence | `podRevision.evidence[].storageKey` | `path` + `storedName` |

Three structural changes came with it:

**Uploads are buffered in memory.** Every multer instance moved from
`diskStorage` to `memoryStorage` behind one factory, `middleware/memoryUpload.ts`.
There is no temporary file, so the orphan-cleanup code that every upload
middleware and most of the controllers behind them carried is gone. A rejected
request now just drops a buffer.

**Signature checks read the buffer.** The four near-identical copies of
"open the file multer wrote and read its first eight bytes" collapsed into
`services/storage/fileSignature.ts`.

**Branch files got real endpoints.** Branch images and documents were the only
consumers of the `/api/v1/files` static mount, and they are now served by
`GET /api/v1/branches/:branchId/{images,documents}/:index` under the same
branch-access check as the rest of the record.

### The security fix that came with this

`/api/v1/files` mounted the entire `private_uploads/` tree behind `attachUser` +
`requireAuthenticated` — nothing more. Any authenticated user of any role who
could guess or observe a stored path could read any other account's KYC
documents, invoices, or credit agreements. It is deleted, and nothing generic
replaces it.

---

## 6. Verification

Done, on the local driver:

- Both projects typecheck clean.
- 467 unit tests pass; 87 of 89 integration tests pass. The two failures are in
  `individualShipment.integration.test.ts` and assert on name casing
  (`'ASHA KUMARI'` vs `'Asha Kumari'`) — they fail identically on the unmodified
  code, so they predate this work and are unrelated to storage.
- Uploading the same file twice produces two distinct keys.
- A key containing `..` is refused before any driver call.

Still to do, and needing the real bucket:

- With `STORAGE_DRIVER=s3`, upload, download, and delete for each module.
- A signed URL stops working after its TTL.
- A key from one business account cannot be read by a member of another.
- Deleting a claim under legal hold is refused before any S3 call is made.
- A restore drill: recreate the database from backup and confirm every document
  reference still resolves.

---

## 7. Open items

| Item | Owner | Status |
|---|---|---|
| Bucket created | Infrastructure | Done — `swiftline-prod-storage-…-ap-south-1-an`, `ap-south-1` |
| Claims wired to the storage service | Backend | Done |
| Convert the ten existing upload sites | Backend | Done |
| POD schema change (absolute paths → keys) | Backend | Done |
| Remove the `/api/v1/files` static mount | Backend | Done |
| IAM policy narrowed to the block above | Infrastructure | Unverified |
| Block Public Access, SSE-S3, versioning confirmed on the bucket | Infrastructure | Unverified |
| Confirm no lifecycle expiry rule covers `claims/` | Infrastructure | Unverified |
| End-to-end check against the real bucket with `STORAGE_DRIVER=s3` | Backend | Not done — the suite runs on the local driver |

> **Attention — environment naming.** The configured bucket is named `-prod-` and
> `S3_KEY_PREFIX=production`, while the portal is otherwise described as
> pre-production. If a development environment points at this bucket, dev uploads
> land in production storage and the no-backfill shortcut in section 5 stops
> applying, because real objects then exist. Worth confirming which environment
> holds these values before the first client document is uploaded.
