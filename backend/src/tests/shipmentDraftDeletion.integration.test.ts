import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { AuditLog } from "../models/auditLog.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import {
  deleteShipmentDraft,
  restoreShipmentDraft
} from "../services/shipmentDraftDeletion.service.js";
import { ShipmentDraftPolicyError } from "../services/shipmentDraftPolicy.service.js";

// Kept short: Atlas caps database names at 38 bytes, and the timestamp alone is 13.
const databaseName = `sl_draft_del_${Date.now()}`;
const adminUserId = new mongoose.Types.ObjectId();

before(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: databaseName, family: 4, retryWrites: false });
  assert.equal(mongoose.connection.name, databaseName);
  await Promise.all([
    AuditLog.init(), DpdShipment.init(), ShipmentDraft.init(), ShipmentInvoice.init()
  ]);
});

after(async () => {
  if (mongoose.connection.readyState !== 0) {
    assert.ok(mongoose.connection.name.startsWith("sl_draft_del_"));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

async function createDraft(invoiceUploadId = new mongoose.Types.ObjectId()) {
  return ShipmentDraft.create({
    invoiceUploadId,
    businessAccountId: new mongoose.Types.ObjectId(),
    branchId: new mongoose.Types.ObjectId(),
    consigneeEnteredAddress: {
      companyName: "Deletion Test Customer",
      contactName: "Test Consignee",
      countryCode: "GB",
      countryName: "United Kingdom",
      postcode: "SW1A 1AA",
      addressLine1: "1 Test Street",
      townOrCity: "London"
    },
    parcelList: [{
      sequence: 1,
      weightKg: 2,
      shipmentContentType: "PARCEL",
      contentsDescription: "Test goods"
    }],
    serviceType: "COURIER",
    serviceCode: "TEST",
    status: "NEEDS_REVIEW",
    createdBy: adminUserId
  });
}

function deleteAsAdmin(draft: Awaited<ReturnType<typeof createDraft>>) {
  return deleteShipmentDraft({ draft, userId: adminUserId, portalRole: "admin" });
}

describe("shipment draft deletion", () => {
  test("marks an unbooked draft deleted without destroying it", async () => {
    const draft = await createDraft();

    await deleteAsAdmin(draft);

    const stored = await ShipmentDraft.findById(draft._id).exec();
    assert.ok(stored, "the draft document must survive a soft delete");
    assert.ok(stored.deletedAt instanceof Date);
    assert.equal(String(stored.deletedBy), String(adminUserId));
    // The parcel data is what makes the delete recoverable.
    assert.equal(stored.parcelList.length, 1);

    const audit = await AuditLog.findOne({
      action: "SHIPMENT_DRAFT_DELETED",
      entityId: draft._id
    }).exec();
    assert.ok(audit, "deletion must be audited");
  });

  test("hides deleted drafts from live queries", async () => {
    const draft = await createDraft();
    await deleteAsAdmin(draft);

    const live = await ShipmentDraft.findOne({ _id: draft._id, deletedAt: null }).exec();
    assert.equal(live, null);
  });

  test("refuses a draft whose carrier booking was rejected", async () => {
    const draft = await createDraft();
    // A rejected booking returns the draft to EDITABLE but leaves the carrier
    // record behind, so booking state alone is not a safe deletion gate.
    await DpdShipment.create({
      shipmentDraftId: draft._id,
      idempotencyKey: `DEL-REJECTED-${String(draft._id)}`,
      dpdShipmentId: `TEST-${String(draft._id).slice(-8)}`,
      serviceCode: "TEST",
      paymentSource: "BUSINESS_ACCOUNT",
      shippingEnvironment: "MOCK",
      status: "DPD_REJECTED"
    });

    await assert.rejects(
      deleteAsAdmin(draft),
      (error: unknown) => error instanceof ShipmentDraftPolicyError && error.statusCode === 409
    );

    const stored = await ShipmentDraft.findById(draft._id).exec();
    assert.equal(stored?.deletedAt ?? null, null);
  });

  test("refuses a booked draft", async () => {
    const draft = await createDraft();
    await DpdShipment.create({
      shipmentDraftId: draft._id,
      idempotencyKey: `DEL-BOOKED-${String(draft._id)}`,
      dpdShipmentId: `TESTB-${String(draft._id).slice(-8)}`,
      serviceCode: "TEST",
      paymentSource: "BUSINESS_ACCOUNT",
      shippingEnvironment: "MOCK",
      status: "LABEL_RECEIVED"
    });

    await assert.rejects(
      deleteAsAdmin(draft),
      (error: unknown) => error instanceof ShipmentDraftPolicyError
    );
  });

  test("frees the invoice upload for a fresh draft", async () => {
    const invoiceUploadId = new mongoose.Types.ObjectId();
    const draft = await createDraft(invoiceUploadId);
    await deleteAsAdmin(draft);

    // The whole point of soft deleting rather than blocking: the same invoice
    // can be uploaded again, which the old plain unique index would have refused.
    const replacement = await createDraft(invoiceUploadId);
    assert.notEqual(String(replacement._id), String(draft._id));

    const live = await ShipmentDraft.countDocuments({ invoiceUploadId, deletedAt: null }).exec();
    assert.equal(live, 1);
  });

  test("allows only one live draft per invoice upload", async () => {
    const invoiceUploadId = new mongoose.Types.ObjectId();
    await createDraft(invoiceUploadId);

    await assert.rejects(
      createDraft(invoiceUploadId),
      (error: unknown) => (error as { code?: number }).code === 11000
    );
  });

  test("restores a deleted draft", async () => {
    const draft = await createDraft();
    await deleteAsAdmin(draft);

    const restored = await restoreShipmentDraft({
      draftId: draft._id as mongoose.Types.ObjectId,
      userId: adminUserId,
      portalRole: "admin"
    });

    assert.equal(restored.deletedAt ?? null, null);
    const audit = await AuditLog.findOne({
      action: "SHIPMENT_DRAFT_RESTORED",
      entityId: draft._id
    }).exec();
    assert.ok(audit, "restoring must be audited");
  });

  test("refuses to restore once the invoice has a newer draft", async () => {
    const invoiceUploadId = new mongoose.Types.ObjectId();
    const draft = await createDraft(invoiceUploadId);
    await deleteAsAdmin(draft);
    await createDraft(invoiceUploadId);

    await assert.rejects(
      restoreShipmentDraft({
        draftId: draft._id as mongoose.Types.ObjectId,
        userId: adminUserId,
        portalRole: "admin"
      }),
      (error: unknown) => error instanceof ShipmentDraftPolicyError && error.statusCode === 409
    );
  });

  test("refuses a second delete of the same draft", async () => {
    const draft = await createDraft();
    await deleteAsAdmin(draft);

    await assert.rejects(
      deleteAsAdmin(draft),
      (error: unknown) => error instanceof ShipmentDraftPolicyError
    );
  });
});
