import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { AuditLog } from "../models/auditLog.model.js";
import { Branch } from "../models/branch.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { DpdShipment, dpdShipmentStatusValues } from "../models/dpdShipment.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ManualShipmentDraftError } from "../services/manualShipmentDraft.service.js";
import { rebookShipmentDraft } from "../services/rebookShipmentDraft.service.js";
import {
  deleteObject,
  getObjectBuffer,
  putObject,
  shipmentKycKey
} from "../services/storage/storage.service.js";

const databaseName = `sl_rebook_${Date.now()}`;
const adminId = new mongoose.Types.ObjectId();
const copiedStorageKeys: string[] = [];

let branchId: mongoose.Types.ObjectId;
let otherBranchId: mongoose.Types.ObjectId;
let accountId: mongoose.Types.ObjectId;

async function createBranch(name: string) {
  const branch = await Branch.create({
    name,
    code: `RB${Math.floor(1000 + Math.random() * 8999)}`,
    status: "ACTIVE",
    address: { addressLine1: "1 Rebook Road", city: "Delhi", state: "Delhi", postalCode: "110001", country: "India" },
    contact: { email: "rebook@swiftline.test", countryCode: "+91", phone: "9000000000" },
    createdBy: adminId
  });
  return branch._id as mongoose.Types.ObjectId;
}

async function createSource(status: typeof dpdShipmentStatusValues[number]) {
  const source = await ShipmentDraft.create({
    creationSource: "MANUAL",
    businessAccountId: accountId,
    customerType: "BUSINESS",
    branchId,
    consigneeEnteredAddress: {
      companyName: "Rebook Customer",
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
    status: "VALIDATION_FAILED",
    bookingState: "REVIEW_REQUIRED",
    createdBy: adminId
  });

  await DpdShipment.create({
    shipmentDraftId: source._id,
    idempotencyKey: `DPD-REBOOK-${new mongoose.Types.ObjectId()}`,
    serviceCode: "TEST",
    status,
    paymentSource: "ADMIN_DIRECT"
  });
  return source;
}

async function rebook(sourceDraftId: mongoose.Types.ObjectId, key = `REBOOK-${new mongoose.Types.ObjectId()}`) {
  return rebookShipmentDraft({
    sourceDraftId: String(sourceDraftId),
    createdBy: adminId,
    allowedBranchIds: null,
    idempotencyKey: key
  });
}

before(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: databaseName, family: 4, retryWrites: false });
  assert.equal(mongoose.connection.name, databaseName, "Rebook tests must use an isolated database.");
  await Promise.all([
    AuditLog.init(),
    Branch.init(),
    BusinessAccount.init(),
    DpdShipment.init(),
    ShipmentDraft.init()
  ]);

  branchId = await createBranch("Rebook Home Branch");
  otherBranchId = await createBranch("Rebook Other Branch");
  const account = await BusinessAccount.create({
    accountId: `BA-REBOOK-${Date.now()}`,
    status: "approved",
    contact: {
      firstName: "Rebook", lastName: "Customer", email: `rebook${Date.now()}@example.com`,
      mobileType: "mobile", countryCode: "+91", mobileNumber: "9100000000"
    },
    company: { registrationCountry: "India", companyName: "Rebook Customer Pvt Ltd", operatingCountries: ["India"] },
    assignedBranch: branchId,
    createdBy: adminId
  });
  accountId = account._id as mongoose.Types.ObjectId;
});

after(async () => {
  await Promise.all(copiedStorageKeys.map((key) => deleteObject(key).catch(() => undefined)));
  if (mongoose.connection.readyState !== 0) {
    assert.ok(mongoose.connection.name.startsWith("sl_rebook_"), "Refusing to clean a non-test database.");
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

describe("shipment rebook", () => {
  test("allows every carrier outcome", async () => {
    for (const status of dpdShipmentStatusValues) {
      const source = await createSource(status);
      const draft = await rebook(source._id as mongoose.Types.ObjectId);

      assert.equal(String(draft.rebookedFromDraftId), String(source._id));
      assert.equal(draft.bookingState, "EDITABLE");
      assert.ok((draft.rebookIdempotencyKey?.length ?? 0) >= 8);
    }
  });

  test("returns the same draft for a repeated request key", async () => {
    const source = await createSource("LABEL_RECEIVED");
    const key = `REBOOK-${new mongoose.Types.ObjectId()}`;
    const first = await rebook(source._id as mongoose.Types.ObjectId, key);
    const second = await rebook(source._id as mongoose.Types.ObjectId, key);

    assert.equal(String(second._id), String(first._id));
    assert.equal(await ShipmentDraft.countDocuments({ rebookedFromDraftId: source._id, rebookIdempotencyKey: key }), 1);
    assert.equal(await AuditLog.countDocuments({ action: "SHIPMENT_DRAFT_REBOOKED", entityId: first._id }), 1);
  });

  test("copies KYC to an independent storage key", async () => {
    const source = await createSource("LABEL_RECEIVED");
    const sourceKey = shipmentKycKey(String(source._id), "identity.pdf");
    const sourceBody = Buffer.from("rebook-kyc-test");
    await putObject({ key: sourceKey, body: sourceBody, contentType: "application/pdf", originalName: "identity.pdf" });
    copiedStorageKeys.push(sourceKey);
    source.kycDocuments = {
      aadhaar: {
        type: "aadhaar",
        documentLabel: "Aadhaar Card",
        originalName: "identity.pdf",
        storageKey: sourceKey,
        mimeType: "application/pdf",
        size: sourceBody.length,
        uploadedAt: new Date(),
        uploadedBy: adminId
      }
    };
    await source.save();

    const draft = await rebook(source._id as mongoose.Types.ObjectId);
    const copied = draft.kycDocuments?.aadhaar;
    assert.ok(copied);
    assert.notEqual(copied.storageKey, sourceKey);
    copiedStorageKeys.push(copied.storageKey);
    assert.deepEqual(await getObjectBuffer(copied.storageKey), sourceBody);
    await deleteObject(copied.storageKey);
    assert.deepEqual(await getObjectBuffer(sourceKey), sourceBody);
  });

  test("keeps operations branch isolation", async () => {
    const source = await createSource("LABEL_RECEIVED");

    await assert.rejects(
      () => rebookShipmentDraft({
        sourceDraftId: String(source._id),
        createdBy: adminId,
        allowedBranchIds: [String(otherBranchId)],
        idempotencyKey: `REBOOK-${new mongoose.Types.ObjectId()}`
      }),
      (error: unknown) => error instanceof ManualShipmentDraftError && error.statusCode === 403
    );
  });
});
