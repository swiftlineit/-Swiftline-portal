import assert from "node:assert/strict";
import { describe, it } from "node:test";
import mongoose from "mongoose";
import { Branch } from "../models/branch.model.js";
import {
  branchStatusTransitions,
  getActiveBranchValidationError
} from "../controllers/branch.controller.js";

// A fully valid active-branch shape; individual tests override one field at a time.
function activeBranchInput(overrides: Record<string, unknown> = {}) {
  return {
    labelCode: "DEL",
    address: {
      countryCode: "IN",
      countryName: "India",
      city: "New Delhi",
      postalCode: "110001",
      address: "1 Trade Street"
    },
    contact: { email: "delhi@swiftline.test", phone: "+919876543210" },
    operations: {
      supportedServices: ["AIR_FREIGHT"],
      shipmentCoverage: ["DOMESTIC"],
      operatingCountries: [],
      workingDays: ["MONDAY"]
    },
    baseCurrency: "INR",
    gstin: "06ABCDE1234F1Z5",
    ...overrides
  };
}

function validBranchData(overrides: Record<string, unknown> = {}) {
  return {
    name: "Delhi Hub",
    code: "DEL-HUB",
    labelCode: "DEL",
    status: "DRAFT",
    createdBy: new mongoose.Types.ObjectId(),
    ...overrides
  };
}

describe("branch status transitions", () => {
  it("only allows a draft to move to active", () => {
    assert.deepEqual(branchStatusTransitions.DRAFT, ["ACTIVE"]);
  });

  it("never allows an active branch back to draft", () => {
    assert.ok(!branchStatusTransitions.ACTIVE.includes("DRAFT"));
  });

  it("lets an active branch be deactivated, suspended, or closed", () => {
    assert.deepEqual([...branchStatusTransitions.ACTIVE].sort(), ["CLOSED", "INACTIVE", "SUSPENDED"]);
  });

  it("allows inactive and suspended branches to return to active", () => {
    assert.ok(branchStatusTransitions.INACTIVE.includes("ACTIVE"));
    assert.ok(branchStatusTransitions.SUSPENDED.includes("ACTIVE"));
  });

  it("treats closed as terminal", () => {
    assert.deepEqual(branchStatusTransitions.CLOSED, []);
  });
});

describe("active branch requirements", () => {
  it("accepts a fully configured branch", () => {
    assert.equal(getActiveBranchValidationError(activeBranchInput()), null);
  });

  it("requires a three-letter station code", () => {
    assert.equal(getActiveBranchValidationError(activeBranchInput({ labelCode: "" })), "Station code is required");
    assert.equal(
      getActiveBranchValidationError(activeBranchInput({ labelCode: "DL" })),
      "Station code must be exactly three uppercase letters"
    );
  });

  it("requires a GSTIN for Indian branches", () => {
    assert.equal(
      getActiveBranchValidationError(activeBranchInput({ gstin: "" })),
      "GSTIN is required for Indian branches"
    );
  });

  it("does not require a GSTIN outside India", () => {
    const input = activeBranchInput({
      gstin: "",
      address: {
        countryCode: "AE",
        countryName: "United Arab Emirates",
        city: "Dubai",
        postalCode: "00000",
        address: "1 Trade Street"
      }
    });
    assert.equal(getActiveBranchValidationError(input), null);
  });

  it("requires operating countries once coverage is not domestic-only", () => {
    const input = activeBranchInput({
      operations: {
        supportedServices: ["AIR_FREIGHT"],
        shipmentCoverage: ["INTERNATIONAL"],
        operatingCountries: [],
        workingDays: ["MONDAY"]
      }
    });
    assert.equal(
      getActiveBranchValidationError(input),
      "Select at least one operating country for international coverage"
    );
  });

  it("accepts international coverage once operating countries are listed", () => {
    const input = activeBranchInput({
      operations: {
        supportedServices: ["AIR_FREIGHT"],
        shipmentCoverage: ["INTERNATIONAL"],
        operatingCountries: ["IN", "AE"],
        workingDays: ["MONDAY"]
      }
    });
    assert.equal(getActiveBranchValidationError(input), null);
  });

  it("reports missing contact and operational fields", () => {
    assert.equal(getActiveBranchValidationError(activeBranchInput({ contact: { email: "", phone: "" } })), "Email is required");
    assert.equal(getActiveBranchValidationError(activeBranchInput({ baseCurrency: "" })), "Base currency is required");
  });
});

describe("branch model validation", () => {
  it("accepts a valid draft branch", async () => {
    await assert.doesNotReject(new Branch(validBranchData()).validate());
  });

  it("rejects a short name and a malformed code", async () => {
    const branch = new Branch(validBranchData({ name: "AB", code: "bad code!" }));
    await assert.rejects(branch.validate(), (error: unknown) => {
      const errors = (error as { errors?: Record<string, unknown> }).errors ?? {};
      return Boolean(errors.name && errors.code);
    });
  });

  it("defaults a new branch to DRAFT with no activation timestamp", () => {
    const branch = new Branch(validBranchData({ status: undefined }));
    assert.equal(branch.status, "DRAFT");
    assert.equal(branch.activatedAt ?? null, null);
  });
});
