import assert from "node:assert/strict";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import {
  BusinessAccount,
  DocumentType,
  IBusinessDocument,
  IBusinessKycReview
} from "../models/businessAccount.model.js";
import {
  businessAccountStatusTransitions,
  deriveKycOverallStatus,
  getDocumentRequirementError,
  getRequiredKycCheckKeys,
  kycGatedStatuses
} from "../controllers/businessAccount.controller.js";
import {
  isHttpOrHttpsUrl,
  isValidBusinessContactEmail,
  isValidPhoneForCountryCode,
  isValidPostalCodeForCountry,
  getPrimaryRegistrationError
} from "../services/businessAccountRules.js";

function testDocument(type: DocumentType): IBusinessDocument {
  return {
    type,
    originalName: `${type}.pdf`,
    storedName: `${type}-stored.pdf`,
    mimeType: "application/pdf",
    size: 1024,
    path: `/tmp/${type}.pdf`,
    uploadedAt: new Date()
  };
}

function emptyReview(overrides: Partial<IBusinessKycReview> = {}): IBusinessKycReview {
  return {
    overallStatus: "documents_pending",
    checks: {},
    finalDecision: null,
    reviewStartedAt: null,
    reviewedAt: null,
    reviewedBy: null,
    ...overrides
  };
}

const requiredDocuments = {
  aadhaarCard: testDocument("aadhaarCard"),
  panCard: testDocument("panCard")
};

function validAccountData(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "BA-2026-100001",
    status: "draft",
    contact: {
      title: "mr.",
      firstName: "John",
      lastName: "Doe",
      email: "john@acme.com",
      mobileType: "mobile",
      countryCode: "+91",
      mobileNumber: "9876543210",
      jobTitle: "Director",
      department: "Management",
      shipmentTypes: ["international_cargo"]
    },
    company: {
      registrationCountry: "India",
      registrationId: "ABCDE1234F",
      companyType: "pvt_ltd",
      companyName: "Acme Exports",
      registeredAddress: "1 Trade Street",
      city: "New Delhi",
      stateOrProvince: "Delhi",
      postalCode: "110001",
      operatingCountries: ["India"],
      industry: "Retail",
      monthlyShipmentVolume: "1-50 shipments",
      requestedCreditLimit: { currency: "INR", amount: null }
    },
    createdBy: new mongoose.Types.ObjectId(),
    ...overrides
  };
}

describe("business account status transitions", () => {
  it("permits only the defined lifecycle moves", () => {
    assert.deepEqual(businessAccountStatusTransitions.draft, ["pending_review"]);
    assert.ok(businessAccountStatusTransitions.pending_review.includes("approved"));
    assert.ok(businessAccountStatusTransitions.pending_review.includes("rejected"));
    assert.ok(businessAccountStatusTransitions.approved.includes("active"));
    assert.ok(businessAccountStatusTransitions.active.includes("suspended"));
    assert.ok(businessAccountStatusTransitions.suspended.includes("active"));
  });

  it("blocks skipping straight from draft to active", () => {
    assert.ok(!businessAccountStatusTransitions.draft.includes("active"));
  });

  it("treats rejected as terminal", () => {
    assert.deepEqual(businessAccountStatusTransitions.rejected, []);
  });

  it("gates approval and activation behind KYC", () => {
    assert.deepEqual([...kycGatedStatuses].sort(), ["active", "approved"]);
  });
});

describe("deriveKycOverallStatus", () => {
  it("stays documents_pending until required documents are present", () => {
    assert.equal(deriveKycOverallStatus({}, emptyReview()), "documents_pending");
    assert.equal(deriveKycOverallStatus({ aadhaarCard: testDocument("aadhaarCard") }, emptyReview()), "documents_pending");
  });

  it("is submitted when documents are present but review has not started", () => {
    assert.equal(deriveKycOverallStatus(requiredDocuments, emptyReview()), "submitted");
  });

  it("is verified only when every required check is verified", () => {
    const review = emptyReview({
      reviewStartedAt: new Date(),
      checks: {
        contactDetails: { status: "verified" },
        companyDetails: { status: "verified" },
        aadhaarCard: { status: "verified" },
        panCard: { status: "verified" }
      }
    });
    assert.equal(deriveKycOverallStatus(requiredDocuments, review), "verified");
  });

  it("reports additional_information_required when a check needs info", () => {
    const review = emptyReview({
      reviewStartedAt: new Date(),
      checks: { aadhaarCard: { status: "information_required", note: "Blurry scan" } }
    });
    assert.equal(deriveKycOverallStatus(requiredDocuments, review), "additional_information_required");
  });

  it("is rejected on a rejected check or a final decision", () => {
    assert.equal(
      deriveKycOverallStatus(requiredDocuments, emptyReview({ checks: { panCard: { status: "reject" } } })),
      "rejected"
    );
    assert.equal(
      deriveKycOverallStatus(requiredDocuments, emptyReview({ finalDecision: "rejected" })),
      "rejected"
    );
  });
});

describe("KYC document helpers", () => {
  it("requires Aadhaar and PAN before submission", () => {
    assert.equal(getDocumentRequirementError({}), "Aadhaar Card is required");
    assert.equal(getDocumentRequirementError({ aadhaarCard: testDocument("aadhaarCard") }), "PAN Card Copy is required");
    assert.equal(getDocumentRequirementError(requiredDocuments), null);
  });

  it("adds optional uploaded documents to the required check list", () => {
    const keys = getRequiredKycCheckKeys({ ...requiredDocuments, gstCertificate: testDocument("gstCertificate") });
    assert.ok(keys.includes("gstCertificate"));
    assert.ok(!keys.includes("iecCertificate"));
  });
});

describe("business account field rules", () => {
  it("accepts company and allow-listed personal email domains, rejects typo TLDs", () => {
    assert.equal(isValidBusinessContactEmail("ops@acme.com"), true);
    assert.equal(isValidBusinessContactEmail("person@gmail.com"), true);
    assert.equal(isValidBusinessContactEmail("person@gmail.con"), false);
    assert.equal(isValidBusinessContactEmail("person@gmail.org"), false);
  });

  it("validates a phone number against its country code", () => {
    assert.equal(isValidPhoneForCountryCode("+91", "9876543210"), true);
    assert.equal(isValidPhoneForCountryCode("+91", "123"), false);
  });

  it("validates postal codes and registration IDs per country", () => {
    assert.equal(isValidPostalCodeForCountry("India", "110001"), true);
    assert.equal(isValidPostalCodeForCountry("India", "11001"), false);
    assert.equal(getPrimaryRegistrationError("India", "ABCDE1234F"), "");
    assert.notEqual(getPrimaryRegistrationError("India", "INVALID"), "");
  });

  it("accepts only http and https website URLs", () => {
    assert.equal(isHttpOrHttpsUrl("https://acme.com"), true);
    assert.equal(isHttpOrHttpsUrl("http://acme.com"), true);
    assert.equal(isHttpOrHttpsUrl("javascript:alert(1)"), false);
    assert.equal(isHttpOrHttpsUrl("not a url"), false);
  });
});

describe("business account model validation", () => {
  it("accepts a fully populated account", async () => {
    await assert.doesNotReject(new BusinessAccount(validAccountData()).validate());
  });

  it("requires at least one operating country for a company account", async () => {
    const account = new BusinessAccount(validAccountData({
      company: { ...validAccountData().company, operatingCountries: [] }
    }));
    await assert.rejects(account.validate(), (error: unknown) => {
      const errors = (error as { errors?: Record<string, unknown> }).errors ?? {};
      return Boolean(errors["company.operatingCountries"]);
    });
  });

  it("allows a companyless account to skip operating countries", async () => {
    const account = new BusinessAccount(validAccountData({
      company: { ...validAccountData().company, noCompany: true, operatingCountries: [] }
    }));
    await assert.doesNotReject(account.validate());
  });
});
