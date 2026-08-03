import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, test } from "node:test";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Branch } from "../models/branch.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { CountryRateCard } from "../models/countryRateCard.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { InvoiceUpload } from "../models/invoiceUpload.model.js";
import { LabelDocument } from "../models/labelDocument.model.js";
import { SwiftlineStationCounter } from "../models/swiftlineStationCounter.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import {
  createLabelForShipmentDraft,
  regenerateSimulatedShipmentLabels
} from "../services/dpdShipment.service.js";
import {
  buildRevisedShipmentSnapshot,
  readShipmentBookingSnapshot
} from "../services/shipmentBookingSnapshot.service.js";
import {
  ShipmentDraftPolicyError,
  beginShipmentDraftBooking
} from "../services/shipmentDraftPolicy.service.js";
import { allocateSwiftlineTrackingNumber } from "../services/swiftlineTracking.service.js";

const databaseName = `sl_shipment_labels_${Date.now()}`;
const generatedFiles = new Set<string>();

// A complete Indian consignor plus mandatory KYC uploads, so booking drafts pass
// the consignor validation added alongside consignor capture. "234567890124"
// carries a valid Verhoeff check digit.
const consignorFixture = {
  companyName: "Delhi Exports Pvt Ltd",
  contactName: "Ravi Sharma",
  email: "ravi@delhiexports.example",
  mobileCountryCode: "+91",
  mobileNumber: "9876543210",
  aadhaarNumber: "234567890124",
  countryCode: "IN",
  countryName: "India",
  postcode: "110001",
  addressLine1: "12 Connaught Place",
  townOrCity: "New Delhi",
  county: "Delhi"
};

function kycDocumentFixture(type: "aadhaar" | "pan" | "other", documentLabel: string) {
  return {
    type,
    documentLabel,
    originalName: `${type}.pdf`,
    storedName: `${type}-${Date.now()}.pdf`,
    mimeType: "application/pdf",
    size: 1024,
    path: `test://kyc/${type}.pdf`,
    uploadedAt: new Date()
  };
}

const kycDocumentsFixture = {
  aadhaar: kycDocumentFixture("aadhaar", "Aadhaar Card"),
  pan: kycDocumentFixture("pan", "PAN Card")
};

before(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: databaseName, family: 4, retryWrites: false });
  assert.equal(mongoose.connection.name, databaseName);
  await SwiftlineStationCounter.init();
});

after(async () => {
  for (const filePath of generatedFiles) {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  if (mongoose.connection.readyState !== 0) {
    assert.ok(mongoose.connection.name.startsWith("sl_shipment_labels_"));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

describe("Swiftline tracking sequence", () => {
  test("allocates unique daily numbers during concurrent bookings", async () => {
    const date = new Date("2026-07-20T06:30:00.000Z");
    const numbers = await Promise.all(Array.from({ length: 12 }, () => (
      allocateSwiftlineTrackingNumber({ stationCode: "DEL", date })
    )));

    assert.equal(new Set(numbers).size, 12);
    assert.deepEqual(
      numbers.map((value) => Number(value.slice(-3))).sort((left, right) => left - right),
      Array.from({ length: 12 }, (_, index) => index + 1)
    );
  });

  test("allows only one concurrent booking lock for the same draft", async () => {
    const draft = await ShipmentDraft.create({
      invoiceUploadId: new mongoose.Types.ObjectId(),
      businessAccountId: new mongoose.Types.ObjectId(),
      branchId: new mongoose.Types.ObjectId(),
      sender: {},
      consigneeEnteredAddress: {
        companyName: "Example Retail Ltd",
        contactName: "Asha Patel",
        email: "asha@example.com",
        mobileCountryCode: "+44",
        mobileNumber: "7123456789",
        countryCode: "GB",
        countryName: "United Kingdom",
        postcode: "SW1A 2AA",
        addressLine1: "10 Downing Street",
        townOrCity: "London"
      },
      consigneeValidatedAddress: {
        companyName: "Example Retail Ltd",
        contactName: "Asha Patel",
        email: "asha@example.com",
        mobileCountryCode: "+44",
        mobileNumber: "7123456789",
        countryCode: "GB",
        countryName: "United Kingdom",
        postcode: "SW1A 2AA",
        addressLine1: "10 Downing Street",
        townOrCity: "London"
      },
      addressValidationStatus: "VALIDATED",
      parcelList: [{
        sequence: 1,
        weightKg: 7,
        lengthCm: 30,
        widthCm: 20,
        heightCm: 10,
        shipmentContentType: "PARCEL",
        contentsDescription: "Clothing"
      }],
      serviceType: "COURIER",
      status: "READY_FOR_DPD",
      bookingState: "EDITABLE",
      createdBy: new mongoose.Types.ObjectId()
    });
    const [firstView, secondView] = await Promise.all([
      ShipmentDraft.findById(draft._id).orFail().exec(),
      ShipmentDraft.findById(draft._id).orFail().exec()
    ]);

    const attempts = await Promise.allSettled([
      beginShipmentDraftBooking({ draft: firstView, bookingAttemptId: "attempt-one" }),
      beginShipmentDraftBooking({ draft: secondView, bookingAttemptId: "attempt-two" })
    ]);
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    assert.ok(rejected && rejected.status === "rejected");
    assert.ok(rejected.reason instanceof ShipmentDraftPolicyError);

    const locked = await ShipmentDraft.findById(draft._id).orFail().lean().exec();
    assert.equal(locked.bookingState, "BOOKING");
    assert.ok(["attempt-one", "attempt-two"].includes(locked.bookingAttemptId));
    assert.ok(locked.lockedAt);
  });

  test("creates shipment labels for BA-2026-800823 / Drifter Co", async () => {
    const userId = new mongoose.Types.ObjectId();
    const branch = await Branch.create({
      name: "Drifter Co Branch",
      code: `DR-${Date.now()}`,
      labelCode: "DRF",
      status: "ACTIVE",
      gstin: "09BIQPK8904E1ZW",
      invoiceSacCode: "996812",
      baseCurrency: "INR",
      address: {
        countryCode: "IN",
        countryName: "India",
        city: "Delhi",
        stateOrProvince: "Delhi",
        postalCode: "110001",
        address: "Swiftline Test Branch"
      },
      contact: { email: "branch@driftercono.example", phone: "+91 9999999999" },
      operations: { supportedServices: [], shipmentCoverage: ["INTERNATIONAL"], operatingCountries: ["GB"], workingDays: [] },
      createdBy: userId
    });

    const account = await BusinessAccount.create({
      accountId: "BA-2026-800823",
      status: "active",
      contact: {
        title: "mr.",
        firstName: "Drifter",
        lastName: "Cono",
        email: "contact@driftercono.example",
        mobileType: "mobile",
        countryCode: "+91",
        mobileNumber: "9000000000",
        jobTitle: "Owner",
        department: "Operations",
        shipmentTypes: ["international_courier"]
      },
      company: {
        registrationCountry: "India",
        registrationId: `DRIFTER-${Date.now()}`,
        companyType: "pvt_ltd",
        companyName: "Drifter Co",
        registeredAddress: "Drifter Co HQ",
        city: "Delhi",
        stateOrProvince: "Delhi",
        postalCode: "110002",
        addressCountry: "India",
        gstin: "09BIQPK8904E1ZD",
        operatingCountries: ["United Kingdom"],
        industry: "Trading",
        monthlyShipmentVolume: "1-10",
        requestedCreditLimit: { currency: "INR", amount: 0 }
      },
      kycReview: { overallStatus: "verified", checks: {} },
      assignedBranch: branch._id,
      createdBy: userId
    });

    await CountryRateCard.create({
      countryCode: "GB",
      countryName: "United Kingdom",
      service: "COURIER",
      fromKg: 0.01,
      toKg: 25,
      chargesPerKg: 200,
      maxBoxKg: 25,
      createdBy: userId
    });

    const upload = await InvoiceUpload.create({
      businessAccountId: account._id,
      branchId: branch._id,
      templateVersion: "TEST-1.0",
      invoiceNumber: `DRIFTER-INV-${Date.now()}`,
      shipmentReference: `DRIFTER-SHIP-${Date.now()}`,
      originalFilename: "drifter-branch.pdf",
      storagePath: "test://drifter-branch.pdf",
      fileChecksum: new mongoose.Types.ObjectId().toHexString().padEnd(64, "0"),
      extractedData: {},
      status: "PARSED",
      uploadedBy: userId
    });

    const draft = await ShipmentDraft.create({
      invoiceUploadId: upload._id,
      businessAccountId: account._id,
      branchId: branch._id,
      sender: { name: branch.name, code: branch.code },
      consignorAddress: consignorFixture,
      kycDocuments: kycDocumentsFixture,
      consigneeEnteredAddress: {
        companyName: "Drifter Co",
        contactName: "Rohit Kapoor",
        email: "rohit@driftercono.example",
        mobileCountryCode: "+91",
        mobileNumber: "9876501234",
        countryCode: "GB",
        countryName: "United Kingdom",
        postcode: "SW1A 1AA",
        addressLine1: "1 Drifter House",
        townOrCity: "London",
        county: "Greater London"
      },
      consigneeValidatedAddress: {
        companyName: "Drifter Co",
        contactName: "Rohit Kapoor",
        email: "rohit@driftercono.example",
        mobileCountryCode: "+91",
        mobileNumber: "9876501234",
        countryCode: "GB",
        countryName: "United Kingdom",
        postcode: "SW1A 1AA",
        addressLine1: "1 Drifter House",
        townOrCity: "London",
        county: "Greater London"
      },
      addressValidationStatus: "VALIDATED",
      addressValidationResult: { outcome: "VALID" },
      parcelList: [{
        sequence: 1,
        weightKg: 5,
        lengthCm: 30,
        widthCm: 20,
        heightCm: 10,
        shipmentContentType: "PARCEL",
        items: [{ description: "Books", hsnCode: "49019900", unitType: "Pkt", quantity: 1, unitRate: 500 }],
        contentsDescription: "Books",
        shipmentReference1: "DRIFTER-BOX-1"
      }],
      serviceType: "COURIER",
      status: "READY_FOR_DPD",
      bookingState: "EDITABLE",
      createdBy: userId
    });

    const result = await createLabelForShipmentDraft(String(draft._id), userId, {
      actor: "admin",
      paymentSource: "TEST"
    });

    result.labels.forEach((label) => generatedFiles.add(label.storagePath));
    assert.equal(result.labels.filter((label) => label.labelType === "DPD").length, 1);
    assert.equal(result.labels.filter((label) => label.labelType === "SWIFTLINE").length, 1);
    assert.ok(result.labels.some((label) => label.labelType === "SWIFTLINE"));
    assert.ok(result.dpdShipment._id);
    assert.ok(result.labels.some((label) => label.parcelNumber.startsWith("SLC")));
  });

  test("books two parcels once and keeps charge, invoice and all four labels aligned", async () => {
    const userId = new mongoose.Types.ObjectId();
    const branch = await Branch.create({
      name: "Shipment Booking Test Branch",
      code: `SBT-${Date.now()}`,
      labelCode: "DL",
      status: "ACTIVE",
      gstin: "09BIQPK8904E1ZW",
      invoiceSacCode: "996812",
      baseCurrency: "INR",
      address: {
        countryCode: "IN",
        countryName: "India",
        city: "Delhi",
        stateOrProvince: "Delhi",
        postalCode: "110001",
        address: "Swiftline Test Branch"
      },
      contact: { email: "branch@example.test", phone: "+91 9999999999" },
      operations: { supportedServices: [], shipmentCoverage: ["INTERNATIONAL"], operatingCountries: ["GB"], workingDays: [] },
      createdBy: userId
    });
    const account = await BusinessAccount.create({
      accountId: `BOOKING-TEST-${Date.now()}`,
      status: "active",
      contact: {
        title: "mr.", firstName: "Booking", lastName: "Owner",
        email: `booking-${Date.now()}@example.test`, mobileType: "mobile",
        countryCode: "+91", mobileNumber: "9000000000", jobTitle: "Owner",
        department: "Operations", shipmentTypes: ["international_courier"]
      },
      company: {
        registrationCountry: "India", registrationId: "BOOKING123", companyType: "pvt_ltd",
        companyName: "Booking Test Company", registeredAddress: "Customer Address",
        city: "Delhi", stateOrProvince: "Delhi", postalCode: "110002",
        addressCountry: "India", gstin: "09BIQPK8904E1ZD", operatingCountries: ["United Kingdom"],
        industry: "Testing", monthlyShipmentVolume: "1-10",
        requestedCreditLimit: { currency: "INR", amount: 0 }
      },
      kycReview: { overallStatus: "verified", checks: {} },
      assignedBranch: branch._id,
      createdBy: userId
    });
    await CountryRateCard.create({
      countryCode: "GB",
      countryName: "United Kingdom",
      service: "COURIER",
      fromKg: 0.01,
      toKg: 25,
      chargesPerKg: 200,
      maxBoxKg: 25,
      createdBy: userId
    });
    const upload = await InvoiceUpload.create({
      businessAccountId: account._id,
      branchId: branch._id,
      templateVersion: "TEST-1.0",
      invoiceNumber: `TEST-INV-${Date.now()}`,
      shipmentReference: `TEST-SHIP-${Date.now()}`,
      originalFilename: "booking-test.pdf",
      storagePath: "test://booking-test.pdf",
      fileChecksum: new mongoose.Types.ObjectId().toHexString().padEnd(64, "0"),
      extractedData: {},
      status: "PARSED",
      uploadedBy: userId
    });
    const draft = await ShipmentDraft.create({
      invoiceUploadId: upload._id,
      businessAccountId: account._id,
      branchId: branch._id,
      sender: { name: branch.name, code: branch.code },
      consignorAddress: consignorFixture,
      kycDocuments: kycDocumentsFixture,
      consigneeEnteredAddress: {
        companyName: "Example Retail Ltd",
        contactName: "Asha Patel",
        email: "asha@example.com",
        mobileCountryCode: "+44",
        mobileNumber: "7123456789",
        countryCode: "GB",
        countryName: "United Kingdom",
        postcode: "SW1A 2AA",
        addressLine1: "10 Downing Street",
        townOrCity: "London",
        county: "Greater London"
      },
      consigneeValidatedAddress: {
        companyName: "Example Retail Ltd",
        contactName: "Asha Patel",
        email: "asha@example.com",
        mobileCountryCode: "+44",
        mobileNumber: "7123456789",
        countryCode: "GB",
        countryName: "United Kingdom",
        postcode: "SW1A 2AA",
        addressLine1: "10 Downing Street",
        townOrCity: "London",
        county: "Greater London"
      },
      addressValidationStatus: "VALIDATED",
      addressValidationResult: { outcome: "VALID" },
      parcelList: [
        // Booking requires an HS code, quantity and unit rate per declared item,
        // since all three print on the customs (shipment) invoice.
        { sequence: 1, weightKg: 7, lengthCm: 30, widthCm: 20, heightCm: 10, shipmentContentType: "PARCEL", items: [{ description: "Clothing", hsnCode: "62034200", unitType: "Pkt", quantity: 4, unitRate: 250 }], contentsDescription: "Clothing", shipmentReference1: "BOX-A" },
        { sequence: 2, weightKg: 11, lengthCm: 40, widthCm: 30, heightCm: 20, shipmentContentType: "PARCEL", items: [{ description: "Shoes", hsnCode: "64039900", unitType: "Pkt", quantity: 2, unitRate: 900 }], contentsDescription: "Shoes", shipmentReference1: "BOX-B" }
      ],
      serviceType: "COURIER",
      status: "READY_FOR_DPD",
      bookingState: "EDITABLE",
      createdBy: userId
    });

    const first = await createLabelForShipmentDraft(String(draft._id), userId, {
      actor: "admin",
      paymentSource: "TEST"
    });
    first.labels.forEach((label) => generatedFiles.add(label.storagePath));
    assert.equal(first.reused, false);
    assert.equal(first.labels.length, 4);
    assert.equal(first.labels.filter((label) => label.labelType === "DPD").length, 2);
    assert.equal(first.labels.filter((label) => label.labelType === "SWIFTLINE").length, 2);
    assert.equal(first.shipmentInvoice.totalAmountMinor, 424800);
    const invoicePricing = first.shipmentInvoice.pricingSnapshot as { parcels: unknown[] };
    assert.equal(invoicePricing.parcels.length, 2);

    const snapshot = first.dpdShipment.bookingSnapshot as {
      parcels: Array<{ actualWeightKg: number; carrierParcelNumber: string; swiftlineParcelNumber: string }>;
      payment: { totalAmountMinor: number };
      pricing: {
        parcels: Array<Record<string, unknown>>;
        baseAmount: number;
        gstAmount: number;
        totalAmount: number;
        missingRate: boolean;
        exceedsMaxBoxKg: boolean;
        gstRate: number;
      };
    };
    assert.deepEqual(snapshot.parcels.map((parcel) => parcel.actualWeightKg), [7, 11]);
    assert.equal(snapshot.payment.totalAmountMinor, first.shipmentInvoice.totalAmountMinor);
    assert.deepEqual(
      first.labels.map((label) => label.parcelNumber).sort(),
      snapshot.parcels.flatMap((parcel) => [parcel.carrierParcelNumber, parcel.swiftlineParcelNumber]).sort()
    );

    const second = await createLabelForShipmentDraft(String(draft._id), userId, {
      actor: "admin",
      paymentSource: "TEST"
    });
    assert.equal(second.reused, true);
    assert.equal(String(second.dpdShipment._id), String(first.dpdShipment._id));
    assert.equal(second.shipmentInvoice.invoiceNumber, first.shipmentInvoice.invoiceNumber);
    assert.equal(await DpdShipment.countDocuments({ shipmentDraftId: draft._id }), 1);
    assert.equal(await ShipmentInvoice.countDocuments({ shipmentDraftId: draft._id }), 1);
    assert.equal(await LabelDocument.countDocuments({ dpdShipmentId: first.dpdShipment._id }), 4);

    const lockedDraft = await ShipmentDraft.findById(draft._id).orFail().lean().exec();
    assert.equal(lockedDraft.bookingState, "BOOKED");

    const swiftlineUpload = await InvoiceUpload.create({
      businessAccountId: account._id,
      branchId: branch._id,
      templateVersion: "TEST-1.0",
      invoiceNumber: `SWIFTLINE-INV-${Date.now()}`,
      shipmentReference: `SWIFTLINE-SHIP-${Date.now()}`,
      originalFilename: "swiftline-booking-test.pdf",
      storagePath: "test://swiftline-booking-test.pdf",
      fileChecksum: new mongoose.Types.ObjectId().toHexString().padEnd(64, "1"),
      extractedData: {},
      status: "PARSED",
      uploadedBy: userId
    });
    const swiftlineDraft = await ShipmentDraft.create({
      invoiceUploadId: swiftlineUpload._id,
      businessAccountId: account._id,
      branchId: branch._id,
      sender: draft.sender,
      consignorAddress: consignorFixture,
      kycDocuments: kycDocumentsFixture,
      consigneeEnteredAddress: draft.consigneeEnteredAddress,
      consigneeValidatedAddress: draft.consigneeValidatedAddress,
      addressValidationStatus: "VALIDATED",
      addressValidationResult: { outcome: "VALID" },
      parcelList: draft.parcelList,
      serviceType: "COURIER",
      status: "READY_FOR_DPD",
      bookingState: "EDITABLE",
      createdBy: userId
    });
    const swiftlineOnly = await createLabelForShipmentDraft(String(swiftlineDraft._id), userId, {
      actor: "admin",
      paymentSource: "TEST",
      bookingProvider: "SWIFTLINE"
    });
    swiftlineOnly.labels.forEach((label) => generatedFiles.add(label.storagePath));
    assert.equal(swiftlineOnly.dpdShipment.bookingProvider, "SWIFTLINE");
    assert.equal(swiftlineOnly.dpdShipment.dpdShipmentId, "");
    assert.deepEqual(swiftlineOnly.dpdShipment.parcelNumbers, []);
    assert.equal(swiftlineOnly.labels.length, 2);
    assert.ok(swiftlineOnly.labels.every((label) => label.labelType === "SWIFTLINE"));
    assert.equal(swiftlineOnly.shipmentInvoice.totalAmountMinor, first.shipmentInvoice.totalAmountMinor);

    const swiftlineReuse = await createLabelForShipmentDraft(String(swiftlineDraft._id), userId, {
      actor: "admin",
      paymentSource: "TEST",
      bookingProvider: "DPD"
    });
    assert.equal(swiftlineReuse.reused, true);
    assert.equal(swiftlineReuse.labels.length, 2);
    assert.ok(swiftlineReuse.labels.every((label) => label.labelType === "SWIFTLINE"));

    const amendedDraft = await ShipmentDraft.findById(draft._id).orFail().exec();
    amendedDraft.parcelList = amendedDraft.parcelList.map((parcel) => ({
      ...parcel,
      weightKg: parcel.weightKg + 1
    }));
    amendedDraft.bookingState = "REVIEW_REQUIRED";
    await amendedDraft.save();

    const originalSnapshot = readShipmentBookingSnapshot(first.dpdShipment.bookingSnapshot);
    assert.ok(originalSnapshot);
    const revisedPricing = {
      ...originalSnapshot.pricing,
      baseAmount: 4000,
      gstAmount: 720,
      totalAmount: 4720
    };
    const revisedSnapshot = buildRevisedShipmentSnapshot({
      previousSnapshot: originalSnapshot,
      draft: amendedDraft,
      pricing: revisedPricing,
      advanceAmountMinor: 0,
      creditAmountMinor: 472000
    });
    const amendedShipment = await DpdShipment.findById(first.dpdShipment._id).orFail().exec();
    amendedShipment.currentShipmentSnapshot = revisedSnapshot as unknown as Record<string, unknown>;
    amendedShipment.snapshotRevision = 2;
    amendedShipment.status = "DPD_CREATED";
    await amendedShipment.save();

    const revisedLabels = await regenerateSimulatedShipmentLabels(
      amendedShipment._id as mongoose.Types.ObjectId,
      userId
    );
    revisedLabels.forEach((label) => generatedFiles.add(label.storagePath));
    assert.equal(revisedLabels.length, 4);
    assert.ok(revisedLabels.every((label) => label.labelVersion === 2));
    assert.equal(await LabelDocument.countDocuments({ dpdShipmentId: amendedShipment._id }), 4);
    assert.deepEqual(
      (readShipmentBookingSnapshot(amendedShipment.bookingSnapshot)?.parcels ?? [])
        .map((parcel) => parcel.actualWeightKg),
      [7, 11]
    );
    assert.deepEqual(revisedSnapshot.parcels.map((parcel) => parcel.actualWeightKg), [8, 12]);
    assert.equal((await ShipmentDraft.findById(draft._id).orFail().lean().exec()).bookingState, "BOOKED");
  });
});
