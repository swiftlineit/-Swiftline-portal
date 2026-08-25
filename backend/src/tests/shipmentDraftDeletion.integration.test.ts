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
  deleteShipmentDrafts,
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

async function createDraft(shipmentImportEntryId?: mongoose.Types.ObjectId) {
  return ShipmentDraft.create({
    creationSource: shipmentImportEntryId ? "SHIPMENT_IMPORT" : "MANUAL",
    shipmentImportEntryId: shipmentImportEntryId ?? null,
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
      status: "LABEL_RECEIVED"
    });

    await assert.rejects(
      deleteAsAdmin(draft),
      (error: unknown) => error instanceof ShipmentDraftPolicyError
    );
  });

  test("frees the shipment import entry for a fresh draft", async () => {
    const shipmentImportEntryId = new mongoose.Types.ObjectId();
    const draft = await createDraft(shipmentImportEntryId);
    await deleteAsAdmin(draft);

    const replacement = await createDraft(shipmentImportEntryId);
    assert.notEqual(String(replacement._id), String(draft._id));

    const live = await ShipmentDraft.countDocuments({ shipmentImportEntryId, deletedAt: null }).exec();
    assert.equal(live, 1);
  });

  test("allows only one live draft per shipment import entry", async () => {
    const shipmentImportEntryId = new mongoose.Types.ObjectId();
    await createDraft(shipmentImportEntryId);

    await assert.rejects(
      createDraft(shipmentImportEntryId),
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

  test("refuses to restore once the import entry has a newer draft", async () => {
    const shipmentImportEntryId = new mongoose.Types.ObjectId();
    const draft = await createDraft(shipmentImportEntryId);
    await deleteAsAdmin(draft);
    await createDraft(shipmentImportEntryId);

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

  test("bulk deletes every selected draft and audits each one", async () => {
    const first = await createDraft();
    const second = await createDraft();

    const deletedIds = await deleteShipmentDrafts({
      drafts: [first, second],
      userId: adminUserId,
      portalRole: "admin"
    });

    assert.deepEqual(deletedIds.map(String), [String(first._id), String(second._id)]);
    assert.equal(await ShipmentDraft.countDocuments({ _id: { $in: deletedIds }, deletedAt: null }), 0);
    const audits = await AuditLog.find({
      action: "SHIPMENT_DRAFT_DELETED",
      entityId: { $in: deletedIds }
    }).lean().exec();
    assert.equal(audits.length, 2);
    assert.ok(audits.every((audit) => audit.metadata.bulkDelete === true));
  });

  test("bulk deletion changes nothing when one selected draft is protected", async () => {
    const deletable = await createDraft();
    const protectedDraft = await createDraft();
    await DpdShipment.create({
      shipmentDraftId: protectedDraft._id,
      idempotencyKey: `DEL-BULK-${String(protectedDraft._id)}`,
      dpdShipmentId: `TESTBLK-${String(protectedDraft._id).slice(-8)}`,
      serviceCode: "TEST",
      paymentSource: "BUSINESS_ACCOUNT",
      status: "LABEL_RECEIVED"
    });

    await assert.rejects(
      deleteShipmentDrafts({
        drafts: [deletable, protectedDraft],
        userId: adminUserId,
        portalRole: "admin"
      }),
      (error: unknown) => error instanceof ShipmentDraftPolicyError
    );

    const stillLive = await ShipmentDraft.countDocuments({
      _id: { $in: [deletable._id, protectedDraft._id] },
      deletedAt: null
    }).exec();
    assert.equal(stillLive, 2);
  });
});
