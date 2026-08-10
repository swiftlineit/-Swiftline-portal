# S3 Storage Integration Plan

Migrating every document upload in the portal from local disk to S3, behind one
storage abstraction so the two can be switched by configuration.

Status: in progress. Claims is being built S3-native; the ten existing upload
sites migrate afterwards, one at a time.

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

The codebase already contains both the right and wrong pattern:

- **Right:** `creditAgreementStorage.service.ts` stores `storageKey` and resolves
  it through one function. Migrating it means rewriting that function.
- **Wrong:** `pod.controller.ts` persists `path: file.path`, an absolute local
  path, on every evidence row. Those rows need backfilling before POD can move.

New code follows the credit-agreement pattern without exception.

### Download path

Two options, and the choice differs by document type:

1. **Signed URL** — the API returns a short-lived S3 link and the browser fetches
   it directly. Cheaper and faster; the URL is a bearer token for its lifetime.
2. **Streamed through the API** — the server authorises, then pipes the bytes.
   The file is never reachable without a live session.

Claim evidence, beneficiary proofs, and payment proofs stream through the API.
The rest may use signed URLs. The reason is that a signed URL forwarded in an
email remains valid until it expires, and claim documents can contain
loss photographs and bank identifiers.

---

## 5. Rollout sequence

**The portal is pre-production, so there is no production data to migrate.**
Existing local files are development artefacts and can be discarded. That removes
the backfill step, the copy-verify-delete dance, and the dual-read window that
would otherwise dominate this work.

Claims is built S3-native from the start. The ten existing sites are converted
afterwards, and each is now a two-step change rather than four:

1. Point writes and reads at the storage service.
2. Delete the module's local root.

> **Attention — this only holds while the portal is pre-production.** The moment
> real client documents exist, converting a module requires the full
> copy-verify-delete backfill and a dual-read window. If any of these modules
> reach production before conversion, revisit this section rather than following
> the two-step version.

Recommended order — least to most risky:

| Order | Module | Risk | Note |
|---|---|---|---|
| 1 | Profile images | Low | Small, non-critical, easy to verify |
| 2 | Shipping labels | Low | Regenerable if a file is lost |
| 3 | Staff documents | Low | Low volume |
| 4 | Branch KYC | Medium | Compliance documents |
| 5 | Business account KYC | Medium | Compliance documents |
| 6 | Shipment KYC | Medium | Higher volume |
| 7 | Invoice uploads | Medium | Financial records |
| 8 | Credit agreements | Medium | Already key-based, so mostly mechanical |
| 9 | Pickup proofs | High | Volume of image data |
| 10 | POD evidence | High | **Stores absolute paths — needs backfill first** |

### The POD exception

POD evidence rows persist `path: file.path`, an absolute filesystem path, rather
than a storage key. Converting it is a schema change plus a controller rewrite,
not a driver swap, so it stays last regardless of the shortcut above. Existing
development rows can simply be dropped and re-created.

---

## 6. Verification

- With `STORAGE_DRIVER=local`, every existing test passes unchanged.
- With `STORAGE_DRIVER=s3`, upload, download, and delete work for each migrated
  module.
- Uploading the same file twice produces two distinct keys.
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
| IAM policy narrowed to the block above | Infrastructure | Unverified |
| Block Public Access, SSE-S3, versioning confirmed on the bucket | Infrastructure | Unverified |
| Confirm no lifecycle expiry rule covers `claims/` | Infrastructure | Unverified |
| Convert the ten existing upload sites | Backend | Not started |
| POD schema change (absolute paths → keys) | Backend | Deferred to step 10 |

> **Attention — environment naming.** The configured bucket is named `-prod-` and
> `S3_KEY_PREFIX=production`, while the portal is otherwise described as
> pre-production. If a development environment points at this bucket, dev uploads
> land in production storage and the no-backfill shortcut in section 5 stops
> applying, because real objects then exist. Worth confirming which environment
> holds these values before the first client document is uploaded.
