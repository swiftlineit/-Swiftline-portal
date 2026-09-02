import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { AuditLog } from "../models/auditLog.model.js";
import { Branch } from "../models/branch.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { DpdShipment, dpdShipmentStatusValues } from "../models/dpdShipment.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentEvent } from "../models/shipmentEvent.model.js";
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
    ShipmentDraft.init(),
    ShipmentEvent.init()
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

  test("allows rebooking held, cancelled, and delivered source timelines", async () => {
    for (const status of ["ON_HOLD", "SHIPMENT_CANCELLED", "DELIVERED"] as const) {
      const source = await createSource("LABEL_RECEIVED");
      const carrier = await DpdShipment.findOne({ shipmentDraftId: source._id }).lean().exec();
      await ShipmentEvent.create({
        shipmentDraftId: source._id,
        dpdShipmentId: carrier?._id,
        status,
        note: status,
        createdBy: adminId,
        eventAt: new Date()
      });

      const draft = await rebook(source._id as mongoose.Types.ObjectId);
      assert.equal(String(draft.rebookedFromDraftId), String(source._id));
      assert.equal(draft.bookingState, "EDITABLE");
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

  test("copies booking data while resetting the new shipment identity", async () => {
    const source = await createSource("DPD_STATUS_UNKNOWN");
    source.csbType = "CSB_V";
    source.insuranceOptIn = true;
    source.forceGst = true;
    source.declarationNote = "HANDLE WITH CARE";
    source.serviceCode = "EXPRESS-TEST";
    source.consignorAddress = {
      companyName: "Source Sender",
      contactName: "Source Contact",
      email: "source@example.com",
      mobileCountryCode: "+91",
      mobileNumber: "9111111111",
      countryCode: "IN",
      countryName: "India",
      postcode: "110001",
      addressLine1: "Source Street",
      townOrCity: "Delhi",
      county: "Delhi",
      aadhaarNumber: ""
    } as never;
    source.parcelList[0]!.items = [{
      description: "Books",
      hsnCode: "4901",
      unitType: "PCS",
      quantity: 2,
      unitRate: 12
    }];
    await source.save();

    const draft = await rebook(source._id as mongoose.Types.ObjectId);

    assert.notEqual(String(draft._id), String(source._id));
    assert.equal(String(draft.rebookedFromDraftId), String(source._id));
    assert.equal(draft.businessAccountId?.toString(), source.businessAccountId?.toString());
    assert.equal(draft.branchId?.toString(), source.branchId?.toString());
    assert.equal(draft.csbType, source.csbType);
    assert.equal(draft.insuranceOptIn, source.insuranceOptIn);
    assert.equal(draft.forceGst, source.forceGst);
    assert.equal(draft.declarationNote, source.declarationNote);
    assert.equal(draft.serviceCode, source.serviceCode);
    // The parcel-item schema normalizes descriptions to uppercase on write;
    // rebook preserves the normalized stored value.
    assert.equal(draft.parcelList[0]?.items?.[0]?.description, "BOOKS");
    assert.equal(draft.parcelList[0]?.items?.[0]?.quantity, 2);
    assert.equal(draft.bookingState, "EDITABLE");
    assert.equal(draft.bookingAttemptId, "");
    assert.equal(draft.allocatedTrackingNumber, "");
    assert.equal(draft.deletedAt, null);
    assert.equal(await DpdShipment.countDocuments({ shipmentDraftId: draft._id }), 0);
  });

  test("accepts a legacy booked draft even when its carrier row is missing", async () => {
    const source = await createSource("LABEL_RECEIVED");
    await DpdShipment.deleteMany({ shipmentDraftId: source._id });
    source.bookingState = "BOOKED";
    await source.save();

    const draft = await rebook(source._id as mongoose.Types.ObjectId);
    assert.equal(String(draft.rebookedFromDraftId), String(source._id));
  });

  test("rejects an unbooked draft without creating anything", async () => {
    const source = await createSource("LABEL_RECEIVED");
    await DpdShipment.deleteMany({ shipmentDraftId: source._id });

    await assert.rejects(
      () => rebook(source._id as mongoose.Types.ObjectId),
      (error: unknown) => error instanceof ManualShipmentDraftError && error.statusCode === 409
    );
    assert.equal(await ShipmentDraft.countDocuments({ rebookedFromDraftId: source._id }), 0);
  });

  test("rejects invalid source identifiers and request keys before database mutation", async () => {
    await assert.rejects(
      () => rebookShipmentDraft({
        sourceDraftId: "not-an-object-id",
        createdBy: adminId,
        allowedBranchIds: null,
        idempotencyKey: "valid-key-123"
      }),
      (error: unknown) => error instanceof ManualShipmentDraftError && error.statusCode === 404
    );

    await assert.rejects(
      () => rebookShipmentDraft({
        sourceDraftId: new mongoose.Types.ObjectId().toString(),
        createdBy: adminId,
        allowedBranchIds: null,
        idempotencyKey: "short"
      }),
      (error: unknown) => error instanceof ManualShipmentDraftError && error.statusCode === 400
    );
  });

  test("keeps idempotency keys scoped to their source shipment", async () => {
    const firstSource = await createSource("LABEL_RECEIVED");
    const secondSource = await createSource("LABEL_RECEIVED");
    const key = `REBOOK-${new mongoose.Types.ObjectId()}`;

    const first = await rebook(firstSource._id as mongoose.Types.ObjectId, key);
    const second = await rebook(secondSource._id as mongoose.Types.ObjectId, key);

    assert.notEqual(String(first._id), String(second._id));
    assert.equal(await ShipmentDraft.countDocuments({ rebookIdempotencyKey: key }), 2);
  });

  test("rechecks the business account branch assignment at rebook time", async () => {
    const source = await createSource("LABEL_RECEIVED");
    await BusinessAccount.updateOne({ _id: accountId }, { $set: { assignedBranch: otherBranchId } });

    await assert.rejects(
      () => rebook(source._id as mongoose.Types.ObjectId),
      (error: unknown) => error instanceof ManualShipmentDraftError && error.statusCode === 403
    );

    await BusinessAccount.updateOne({ _id: accountId }, { $set: { assignedBranch: branchId } });
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
