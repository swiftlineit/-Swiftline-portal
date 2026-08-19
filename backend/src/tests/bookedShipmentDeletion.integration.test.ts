import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { AuditLog } from "../models/auditLog.model.js";
import { Branch } from "../models/branch.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import { User } from "../models/user.model.js";
import { deleteBookedShipment } from "../services/shipmentDraftDeletion.service.js";
import { ShipmentDraftPolicyError } from "../services/shipmentDraftPolicy.service.js";
import { allShipmentStatuses, listBookedShipments } from "../services/shipmentListing.service.js";

// Kept short: Atlas caps database names at 38 bytes.
const databaseName = `sl_booked_delete_${Date.now()}`;

const adminId = new mongoose.Types.ObjectId();

let branchId: mongoose.Types.ObjectId;
let accountId: mongoose.Types.ObjectId;

async function createBranch() {
  const branch = await Branch.create({
    name: "Delete Test Branch",
    code: `DT${Math.floor(1000 + Math.random() * 8999)}`,
    status: "ACTIVE",
    address: { addressLine1: "1 Delete Road", city: "Delhi", state: "Delhi", postalCode: "110001", country: "India" },
    contact: { email: "delete@swiftline.test", countryCode: "+91", phone: "9000000000" },
    createdBy: adminId
  });
  return branch._id as mongoose.Types.ObjectId;
}

async function createBusinessAccount(assignedBranch: mongoose.Types.ObjectId) {
  const account = await BusinessAccount.create({
    accountId: `BA-DEL-${Date.now()}${Math.floor(Math.random() * 1000)}`,
    status: "approved",
    contact: {
      firstName: "Delete", lastName: "Customer", email: `delete${Date.now()}@example.com`,
      mobileType: "mobile", countryCode: "+91",
      mobileNumber: String(9100000000 + Math.floor(Math.random() * 800000))
    },
    company: {
      registrationCountry: "India",
      companyName: "Delete Customer Pvt Ltd",
      operatingCountries: ["India"]
    },
    assignedBranch,
    createdBy: adminId
  });
  return account._id as mongoose.Types.ObjectId;
}

/** A draft plus the carrier booking that puts it on the booked-shipment list. */
async function createBookedShipment() {
  const draft = await ShipmentDraft.create({
    creationSource: "MANUAL",
    businessAccountId: accountId,
    branchId,
    consigneeEnteredAddress: {
      companyName: "Delete Test Customer",
      contactName: "Test Consignee",
      countryCode: "GB",
      countryName: "United Kingdom",
      postcode: "SW1A 1AA",
      addressLine1: "1 Test Street",
      townOrCity: "London"
    },
    parcelList: [{ sequence: 1, weightKg: 2, shipmentContentType: "PARCEL", contentsDescription: "Test goods" }],
    serviceType: "COURIER",
    serviceCode: "TEST",
    status: "NEEDS_REVIEW",
    allocatedTrackingNumber: `SL${Date.now()}`,
    createdBy: adminId
  });

  const booking = await DpdShipment.create({
    shipmentDraftId: draft._id,
    idempotencyKey: `del-${Date.now()}-${Math.random()}`,
    serviceCode: "TEST",
    status: "LABEL_RECEIVED"
  });

  return { draft, booking };
}

function listStaff() {
  return listBookedShipments({
    page: 1,
    limit: 50,
    actorRole: "admin",
    status: "",
    search: "",
    sort: "",
    bookingStatuses: allShipmentStatuses
  });
}

before(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: databaseName, family: 4, retryWrites: false });
  assert.equal(mongoose.connection.name, databaseName, "Deletion tests must use an isolated database.");
  await Promise.all([Branch.init(), BusinessAccount.init(), ShipmentDraft.init(), DpdShipment.init(), User.init()]);

  branchId = await createBranch();
  accountId = await createBusinessAccount(branchId);
});

after(async () => {
  if (mongoose.connection.readyState !== 0) {
    assert.ok(mongoose.connection.name.startsWith("sl_booked_delete_"), "Refusing to clean a non-test database.");
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

describe("admin deletion of a booked shipment", () => {
  test("removes the shipment from the booked list", async () => {
    const { draft } = await createBookedShipment();

    const before = await listStaff();
    assert.ok(
      before.shipments.some((shipment) => shipment.id === String(draft._id)),
      "the shipment should be listed before it is deleted"
    );

    await deleteBookedShipment({ draft, userId: adminId, portalRole: "admin" });

    const after = await listStaff();
    assert.ok(
      !after.shipments.some((shipment) => shipment.id === String(draft._id)),
      "the shipment should be gone from the list once deleted"
    );
  });

  test("keeps the carrier booking and the tax invoice", async () => {
    const { draft, booking } = await createBookedShipment();
    const invoice = await ShipmentInvoice.collection.insertOne({
      shipmentDraftId: draft._id,
      invoiceNumber: `SL-TEST-${Date.now()}`,
      currency: "INR",
      totalAmountMinor: 100000,
      status: "ISSUED",
      revision: 1
    });

    await deleteBookedShipment({ draft, userId: adminId, portalRole: "admin" });

    // The whole reason this delete is allowed to skip the deletion blockers is
    // that it destroys nothing. If either of these ever disappears, the safety
    // argument behind the endpoint no longer holds.
    assert.ok(await DpdShipment.findById(booking._id).exec(), "the carrier booking must survive");
    assert.ok(
      await ShipmentInvoice.collection.findOne({ _id: invoice.insertedId }),
      "the tax invoice must survive"
    );

    const stored = await ShipmentDraft.findById(draft._id).exec();
    assert.ok(stored, "the draft itself must survive; the delete is soft");
    assert.ok(stored?.deletedAt, "deletedAt must be stamped");
    assert.equal(String(stored?.deletedBy), String(adminId));
  });

  test("records an audit row naming the shipment", async () => {
    const { draft } = await createBookedShipment();
    await deleteBookedShipment({ draft, userId: adminId, portalRole: "admin" });

    const entry = await AuditLog.findOne({
      action: "BOOKED_SHIPMENT_DELETED",
      entityId: draft._id
    }).lean().exec();

    assert.ok(entry, "a BOOKED_SHIPMENT_DELETED audit row must be written");
    assert.equal(
      (entry?.metadata as { allocatedTrackingNumber?: string })?.allocatedTrackingNumber,
      draft.allocatedTrackingNumber
    );
  });

  test("refuses every role below admin", async () => {
    for (const role of ["operations", "delivery", "finance", "client", ""]) {
      const { draft } = await createBookedShipment();
      await assert.rejects(
        () => deleteBookedShipment({ draft, userId: adminId, portalRole: role }),
        (error: unknown) => error instanceof ShipmentDraftPolicyError && error.statusCode === 403,
        `role "${role}" must not be able to delete a booked shipment`
      );

      const stored = await ShipmentDraft.findById(draft._id).exec();
      assert.equal(stored?.deletedAt ?? null, null, `role "${role}" must leave the shipment live`);
    }
  });

  test("refuses a second delete of the same shipment", async () => {
    const { draft } = await createBookedShipment();
    await deleteBookedShipment({ draft, userId: adminId, portalRole: "admin" });

    await assert.rejects(
      () => deleteBookedShipment({ draft, userId: adminId, portalRole: "admin" }),
      (error: unknown) => error instanceof ShipmentDraftPolicyError && error.statusCode === 409
    );
  });
});
