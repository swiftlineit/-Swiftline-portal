import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  formatAadhaarNumber,
  isValidAadhaarNumber,
  maskAadhaarNumber,
  normalizeAadhaarNumber
} from "../services/aadhaarValidation.service.js";
import type { IShipmentDraft } from "../models/shipmentDraft.model.js";
import { validateShipmentDraftFields } from "../services/shipmentValidation.service.js";

// Carries a valid Verhoeff check digit.
const validAadhaar = "234567890124";

describe("aadhaar number validation", () => {
  test("accepts a UIDAI number with a correct check digit", () => {
    assert.equal(isValidAadhaarNumber(validAadhaar), true);
    assert.equal(isValidAadhaarNumber("2345 6789 0124"), true);
  });

  test("rejects wrong check digits, bad lengths, and leading 0/1", () => {
    assert.equal(isValidAadhaarNumber("234567890123"), false);
    assert.equal(isValidAadhaarNumber("023456789012"), false);
    assert.equal(isValidAadhaarNumber("123456789012"), false);
    assert.equal(isValidAadhaarNumber("23456789012"), false);
  });

  test("normalizes, formats, and masks", () => {
    assert.equal(normalizeAadhaarNumber("2345-6789-0124"), validAadhaar);
    assert.equal(formatAadhaarNumber(validAadhaar), "2345 6789 0124");
    assert.equal(maskAadhaarNumber(validAadhaar), "XXXX XXXX 0124");
  });
});

function draftWith(overrides: {
  consignor?: Partial<IShipmentDraft["consignorAddress"]>;
  consignee?: Partial<IShipmentDraft["consigneeEnteredAddress"]>;
  kyc?: IShipmentDraft["kycDocuments"];
  useForAll?: boolean;
  parcels?: Array<Record<string, unknown>>;
}) {
  const consignor = {
    companyName: "Delhi Exports",
    contactName: "Ravi Sharma",
    email: "ravi@delhi.example",
    mobileCountryCode: "+91",
    mobileNumber: "9876543210",
    aadhaarNumber: validAadhaar,
    countryCode: "IN",
    countryName: "India",
    postcode: "110001",
    addressLine1: "12 Connaught Place",
    townOrCity: "New Delhi",
    county: "Delhi",
    ...overrides.consignor
  };
  const consignee = {
    companyName: "Example Retail",
    contactName: "Asha Patel",
    email: "asha@example.com",
    mobileCountryCode: "+44",
    mobileNumber: "7123456789",
    countryCode: "GB",
    countryName: "United Kingdom",
    postcode: "SW1A 2AA",
    addressLine1: "10 Downing Street",
    townOrCity: "London",
    county: "Greater London",
    ...overrides.consignee
  };
  const kyc = overrides.kyc ?? {
    aadhaar: { storedName: "a.pdf" },
    pan: { storedName: "p.pdf" }
  };

  const parcelList = overrides.parcels ?? [{ sequence: 1, weightKg: 5, lengthCm: 10, widthCm: 10, heightCm: 10, shipmentContentType: "PARCEL", contentsDescription: "Clothing" }];

  return {
    consignorAddress: consignor,
    consigneeEnteredAddress: consignee,
    kycUseForAllParcels: overrides.useForAll ?? true,
    kycDocuments: kyc,
    parcelList,
    parcelCount: parcelList.length,
    addressValidationStatus: "VALIDATED"
  } as unknown as IShipmentDraft;
}

describe("consignor draft validation", () => {
  test("a complete consignor and KYC set produces no consignor issues", () => {
    const issues = validateShipmentDraftFields(draftWith({}));
    assert.equal(issues.some((issue) => issue.toLowerCase().includes("consignor")), false);
    assert.equal(issues.some((issue) => issue.toLowerCase().includes("aadhaar")), false);
    assert.equal(issues.some((issue) => issue.toLowerCase().includes("kyc") || issue.toLowerCase().includes("upload")), false);
  });

  test("flags a bad shared Aadhaar number", () => {
    const issues = validateShipmentDraftFields(draftWith({ consignor: { aadhaarNumber: "234567890123" } }));
    assert.ok(issues.includes("Enter a valid 12 digit Aadhaar number"));
  });

  test("requires the Aadhaar card but not PAN", () => {
    const issues = validateShipmentDraftFields(draftWith({ kyc: {} }));
    assert.ok(issues.includes("Upload the Aadhaar card"));
    assert.equal(issues.some((issue) => issue.toLowerCase().includes("pan")), false);
  });

  test("requires per-parcel Aadhaar + card when KYC is not shared", () => {
    const issues = validateShipmentDraftFields(draftWith({
      useForAll: false,
      parcels: [
        { sequence: 1, weightKg: 5, lengthCm: 10, widthCm: 10, heightCm: 10, shipmentContentType: "PARCEL", contentsDescription: "A" },
        { sequence: 2, weightKg: 6, lengthCm: 10, widthCm: 10, heightCm: 10, shipmentContentType: "PARCEL", contentsDescription: "B", aadhaarNumber: validAadhaar, kycDocuments: { aadhaar: { storedName: "p2.pdf" } } }
      ]
    }));
    assert.ok(issues.includes("Parcel 1: Aadhaar number is required"));
    assert.ok(issues.includes("Parcel 1: upload the Aadhaar card"));
    // Parcel 2 is KYC-complete. It still raises the HSN issue every legacy parcel
    // does (its contents predate per-item capture), so only KYC issues are excluded.
    assert.equal(
      issues.some((issue) => issue.startsWith("Parcel 2") && issue.toLowerCase().includes("aadhaar")),
      false
    );
  });

  test("rejects matching consignor and consignee identity", () => {
    const issues = validateShipmentDraftFields(draftWith({
      consignee: { contactName: "Ravi Sharma", email: "ravi@delhi.example", mobileCountryCode: "+91", mobileNumber: "9876543210" }
    }));
    assert.ok(issues.includes("Consignor and consignee contact names must be different"));
    assert.ok(issues.includes("Consignor and consignee mobile numbers must be different"));
    assert.ok(issues.includes("Consignor and consignee email addresses must be different"));
  });

  test("rejects a parcel whose contents description names a restricted item", () => {
    const issues = validateShipmentDraftFields(draftWith({
      parcels: [{ sequence: 1, weightKg: 5, lengthCm: 10, widthCm: 10, heightCm: 10, shipmentContentType: "PARCEL", contentsDescription: "SNACKS, GOLD RING" }]
    }));
    // Restricted goods are now reported against the individual item that names
    // them. A legacy parcel with only a description reads as its single item.
    assert.ok(issues.includes("Parcel 1 item 1: Gold / Silver / Precious Metals is a restricted item and cannot be shipped"));
  });

  test("allows a parcel whose description merely contains a keyword substring", () => {
    const issues = validateShipmentDraftFields(draftWith({
      parcels: [{ sequence: 1, weightKg: 5, lengthCm: 10, widthCm: 10, heightCm: 10, shipmentContentType: "PARCEL", contentsDescription: "CASHEW NUTS, SNACKS" }]
    }));
    assert.equal(issues.some((issue) => issue.toLowerCase().includes("restricted")), false);
  });

  test("requires an HSN code on every declared item", () => {
    const issues = validateShipmentDraftFields(draftWith({
      parcels: [{
        sequence: 1, weightKg: 5, lengthCm: 10, widthCm: 10, heightCm: 10, shipmentContentType: "PARCEL",
        items: [{ description: "Cookies", hsnCode: "19053100" }, { description: "Clothes", hsnCode: "" }],
        contentsDescription: "Cookies, Clothes"
      }]
    }));
    assert.ok(issues.includes("Parcel 1 item 2: HSN code is required"));
    // The complete item raises nothing.
    assert.equal(issues.some((issue) => issue.startsWith("Parcel 1 item 1")), false);
  });

  test("rejects a malformed HSN code", () => {
    const issues = validateShipmentDraftFields(draftWith({
      parcels: [{
        sequence: 1, weightKg: 5, lengthCm: 10, widthCm: 10, heightCm: 10, shipmentContentType: "PARCEL",
        items: [{ description: "Cookies", hsnCode: "190" }],
        contentsDescription: "Cookies"
      }]
    }));
    assert.ok(issues.includes("Parcel 1 item 1: enter a valid 4, 6 or 8 digit HSN code"));
  });

  test("does not demand HSN codes on the amendment path, but still rejects malformed ones", () => {
    // Shipments booked before HSN capture existed must stay amendable.
    const legacy = validateShipmentDraftFields(draftWith({
      parcels: [{
        sequence: 1, weightKg: 5, lengthCm: 10, widthCm: 10, heightCm: 10, shipmentContentType: "PARCEL",
        contentsDescription: "Handicrafts"
      }]
    }), { requireConsignorDetails: false, requireItemHsnCodes: false });
    assert.equal(legacy.some((issue) => issue.includes("HSN code is required")), false);

    const malformed = validateShipmentDraftFields(draftWith({
      parcels: [{
        sequence: 1, weightKg: 5, lengthCm: 10, widthCm: 10, heightCm: 10, shipmentContentType: "PARCEL",
        items: [{ description: "Handicrafts", hsnCode: "12" }],
        contentsDescription: "Handicrafts"
      }]
    }), { requireConsignorDetails: false, requireItemHsnCodes: false });
    assert.ok(malformed.includes("Parcel 1 item 1: enter a valid 4, 6 or 8 digit HSN code"));
  });

  test("skips consignor checks when the caller opts out (amendment path)", () => {
    const issues = validateShipmentDraftFields(draftWith({ consignor: { contactName: "" }, kyc: {} }), {
      requireConsignorDetails: false
    });
    assert.equal(issues.some((issue) => issue.toLowerCase().includes("consignor")), false);
  });
});
