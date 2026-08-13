import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import {
  createClientClaim,
  getClientClaim,
  submitClientClaim,
  updateClientClaimDraft,
  waiveStaffClaimDocument
} from "../controllers/claim.controller.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { BusinessAccountMember } from "../models/businessAccountMember.model.js";
import { Branch } from "../models/branch.model.js";
import { Claim } from "../models/claim.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentEvent } from "../models/shipmentEvent.model.js";
import { User } from "../models/user.model.js";
import { startClaimReview, waiveClaimDocument } from "../services/claims/claimWorkflow.service.js";
import { buildClaimChecklistFor } from "../services/claims/claimChecklist.service.js";

/**
 * Integration coverage for the rules that only appear once real records exist:
 * cross-account isolation, the one-active-claim index, and whether a waiver
 * actually unblocks a claim.
 *
 * The unit suite proved every rule correct in isolation and still missed two
 * workflow-level holes, because a rule can be right and unreachable at the same
 * time. These tests exercise the controller and the database together.
 */

// Atlas caps database names at 38 bytes.
const databaseName = `swiftline_cl_test_${Date.now()}`;

function recorder() {
  let statusCode = 200;
  let body: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(payload: unknown) {
      body = payload;
      return response;
    }
  } as unknown as Response;
  return { response, statusCode: () => statusCode, body: <T>() => body as T };
}

function asRequest(input: {
  user: { _id: mongoose.Types.ObjectId; role: string; assignedBranches?: mongoose.Types.ObjectId[] };
  params?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string>;
}) {
  return {
    user: input.user,
    params: input.params ?? {},
    body: input.body ?? {},
    query: input.query ?? {}
  } as unknown as Request;
}

// Rethrows rather than swallowing: a handler that falls through to next() is a
// real failure, and a silent next() makes it look like an empty 200.
const noop = ((error?: unknown) => {
  if (error) throw error;
}) as never;

type Fixture = Awaited<ReturnType<typeof createAccount>>;

/** One business account with an owner, a branch, and a booked, collected shipment. */
async function createAccount(label: string) {
  const unique = `${label}${Date.now() % 100000}`;

  const owner = await User.create({
    firstName: label,
    lastName: "Owner",
    email: `${label.toLowerCase()}-owner-${unique}@example.com`,
    phone: `+9198765${String(Date.now()).slice(-5)}`,
    role: "client",
    userStatus: "active",
    isVerified: true,
    passwordHash: "stored-password-hash"
  });

  const branch = await Branch.create({
    name: `${label} Hub`,
    code: `${label.toUpperCase().slice(0, 3)}-${Date.now() % 10000}`,
    status: "ACTIVE",
    createdBy: owner._id,
    updatedBy: owner._id
  });

  const account = await BusinessAccount.create({
    accountId: `BA-${unique}`,
    status: "active",
    contact: {
      title: "mr.",
      firstName: label,
      lastName: "Owner",
      email: `${label.toLowerCase()}-contact-${unique}@example.com`,
      mobileType: "mobile",
      countryCode: "+91",
      mobileNumber: `98765${String(Date.now()).slice(-5)}`,
      jobTitle: "Director",
      department: "Management",
      shipmentTypes: ["international_cargo"]
    },
    company: {
      registrationCountry: "India",
      registrationId: `ABCDE${String(Date.now()).slice(-4)}F`,
      companyType: "pvt_ltd",
      companyName: `${label} Traders`,
      registeredAddress: "1 Trade Street",
      city: "New Delhi",
      stateOrProvince: "Delhi",
      postalCode: "110001",
      operatingCountries: ["India"],
      industry: "Retail",
      monthlyShipmentVolume: "1-50 shipments",
      requestedCreditLimit: { currency: "INR", amount: null }
    },
    assignedBranch: branch._id,
    createdBy: owner._id,
    updatedBy: owner._id
  });

  await BusinessAccountMember.create({
    businessAccount: account._id,
    user: owner._id,
    role: "account_owner",
    status: "active",
    assignedBranches: [],
    invitedBy: owner._id
  });

  const shipment = await ShipmentDraft.create({
    creationSource: "MANUAL",
    businessAccountId: account._id,
    branchId: branch._id,
    createdBy: owner._id,
    bookingState: "BOOKED",
    consigneeEnteredAddress: {
      companyName: `${label} Receiver`,
      countryCode: "GB",
      countryName: "United Kingdom",
      postcode: "SW1A 1AA",
      addressLine1: "1 Test Street",
      townOrCity: "London"
    },
    parcelCount: 1,
    parcelList: [
      {
        sequence: 1,
        weightKg: 2,
        lengthCm: 20,
        widthCm: 20,
        heightCm: 20,
        shipmentContentType: "PARCEL",
        // 4 units at ₹500 each — the snapshot should total 200,000 paise.
        items: [{ description: "Wool rug", quantity: 4, unitRate: 500, unitType: "PCS" }]
      }
    ]
  });

  await DpdShipment.create({
    shipmentDraftId: shipment._id,
    swiftlineTrackingNumber: `SL${Date.now()}${label.length}`,
    parcelNumbers: ["P1"],
    serviceCode: "DPD_CLASSIC",
    idempotencyKey: `booking-${unique}`
  });

  // Eligibility requires collection, read from the event trail.
  await ShipmentEvent.create({
    shipmentDraftId: shipment._id,
    status: "PARCEL_COLLECTED",
    eventAt: new Date(),
    createdBy: owner._id
  });

  return { owner, branch, account, shipment };
}

async function submitClaim(fixture: Fixture, claimId: string) {
  const result = recorder();
  await submitClientClaim(
    asRequest({
      user: { _id: fixture.owner._id, role: "client" },
      params: { claimId },
      body: { declarationAccepted: true }
    }),
    result.response,
    noop
  );
  const payload = result.body<{ success?: boolean; message?: string }>();
  if (!payload?.success) {
    throw new Error(`submit failed (${result.statusCode()}): ${payload?.message}`);
  }
  return result;
}

async function fileClaim(fixture: Fixture) {
  const created = recorder();
  await createClientClaim(
    asRequest({
      user: { _id: fixture.owner._id, role: "client" },
      body: { shipmentDraftId: String(fixture.shipment._id), category: "PHYSICAL_DAMAGE" }
    }),
    created.response,
    noop
  );

  const payload = created.body<{ claim?: { id: string }; message?: string }>();
  if (!payload?.claim) throw new Error(`claim not created (${created.statusCode()}): ${payload?.message}`);
  const claimId = payload.claim.id;

  await updateClientClaimDraft(
    asRequest({
      user: { _id: fixture.owner._id, role: "client" },
      params: { claimId },
      body: {
        requestedAmountMinor: 100_000,
        description: "Two rugs arrived torn along one edge.",
        affectedItems: [{ parcelSequence: 1, itemIndex: 0, quantityAffected: 2 }]
      }
    }),
    recorder().response,
    noop
  );

  return claimId;
}

let alpha: Fixture;
let beta: Fixture;
let staff: InstanceType<typeof User>;

before(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: databaseName, family: 4, retryWrites: false });
  alpha = await createAccount("Alpha");
  beta = await createAccount("Beta");
  staff = await User.create({
    firstName: "Ops",
    lastName: "User",
    email: `ops-${Date.now()}@example.com`,
    phone: `+9198761${String(Date.now()).slice(-5)}`,
    role: "operations",
    userStatus: "active",
    isVerified: true,
    passwordHash: "stored-password-hash",
    assignedBranches: [alpha.branch._id]
  });
});

after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

describe("cross-account isolation", () => {
  test("a claim from another account answers not found, not forbidden", async () => {
    const claimId = await fileClaim(alpha);

    const result = recorder();
    await getClientClaim(
      asRequest({ user: { _id: beta.owner._id, role: "client" }, params: { claimId } }),
      result.response,
      noop
    );

    // 404 rather than 403: a "forbidden" would confirm the claim exists to
    // someone with no right to know that.
    assert.equal(result.statusCode(), 404);
    assert.match(result.body<{ message: string }>().message, /not found/i);
  });

  test("a shipment from another account cannot be claimed against", async () => {
    const result = recorder();
    await createClientClaim(
      asRequest({
        user: { _id: beta.owner._id, role: "client" },
        body: { shipmentDraftId: String(alpha.shipment._id), category: "TOTAL_LOSS" }
      }),
      result.response,
      noop
    );

    assert.equal(result.statusCode(), 404);
  });
});

describe("one active claim per shipment", () => {
  test("the second claim on a shipment is refused", async () => {
    const fixture = await createAccount("Gamma");
    const claimId = await fileClaim(fixture);

    await submitClientClaim(
      asRequest({
        user: { _id: fixture.owner._id, role: "client" },
        params: { claimId },
        body: { declarationAccepted: true }
      }),
      recorder().response,
      noop
    );

    const second = recorder();
    await createClientClaim(
      asRequest({
        user: { _id: fixture.owner._id, role: "client" },
        body: { shipmentDraftId: String(fixture.shipment._id), category: "SHORTAGE" }
      }),
      second.response,
      noop
    );

    assert.equal(second.statusCode(), 409);
    assert.match(second.body<{ message: string }>().message, /already open/i);
  });

  test("the database index refuses a duplicate even if the check is bypassed", async () => {
    const fixture = await createAccount("Delta");
    const claimId = await fileClaim(fixture);
    await submitClientClaim(
      asRequest({
        user: { _id: fixture.owner._id, role: "client" },
        params: { claimId },
        body: { declarationAccepted: true }
      }),
      recorder().response,
      noop
    );

    // Written straight to the model, skipping every service-level guard. The
    // partial unique index is the real guarantee; the friendly 409 above only
    // avoids reaching it.
    await assert.rejects(
      () =>
        Claim.create({
          businessAccountId: fixture.account._id,
          branchId: fixture.branch._id,
          shipmentDraftId: fixture.shipment._id,
          claimantUserId: fixture.owner._id,
          category: "TOTAL_LOSS",
          status: "SUBMITTED",
          requestedAmountMinor: 5000
        }),
      /duplicate key/i
    );
  });
});

describe("submission", () => {
  test("allocates a financial-year claim number and freezes the shipment", async () => {
    const fixture = await createAccount("Epsilon");
    const claimId = await fileClaim(fixture);

    await submitClaim(fixture, claimId);

    const claim = await Claim.findById(claimId).exec();
    assert.match(claim!.claimNumber!, /^CLM\/\d{2}-\d{2}\/\d{5}$/);
    assert.ok(claim!.shipmentSnapshot, "the shipment was not snapshotted");
    assert.equal(claim!.shipmentSnapshot!.totalDeclaredValueMinor, 200_000);
    // Recorded against the wording actually shown, which is still provisional.
    assert.match(claim!.declarationVersion, /-draft$/);
  });

  test("refuses submission without the declaration", async () => {
    const fixture = await createAccount("Zeta");
    const claimId = await fileClaim(fixture);

    const result = recorder();
    await submitClientClaim(
      asRequest({
        user: { _id: fixture.owner._id, role: "client" },
        params: { claimId },
        body: { declarationAccepted: false }
      }),
      result.response,
      noop
    );

    assert.equal(result.statusCode(), 400);
  });
});

describe("document waiver", () => {
  test("unblocks a claim whose evidence cannot be produced", async () => {
    const fixture = await createAccount("Eta");
    const claimId = await fileClaim(fixture);
    await submitClientClaim(
      asRequest({
        user: { _id: fixture.owner._id, role: "client" },
        params: { claimId },
        body: { declarationAccepted: true }
      }),
      recorder().response,
      noop
    );

    const claim = await Claim.findById(claimId).exec();
    const before = await buildClaimChecklistFor(claim!);
    assert.equal(before.complete, false, "a fresh claim should need evidence");

    // Waive everything still outstanding.
    for (const item of before.items.filter((entry) => entry.required)) {
      await waiveClaimDocument({
        claimId,
        actorUserId: String(staff._id),
        category: item.category,
        reason: "Shipper does not itemise consignments of this type."
      });
    }

    const after = await buildClaimChecklistFor((await Claim.findById(claimId).exec())!);
    assert.equal(after.complete, true, "waived requirements should not block completion");
  });

  test("refuses a waiver with no reason and refuses to waive twice", async () => {
    const fixture = await createAccount("Theta");
    const claimId = await fileClaim(fixture);

    await assert.rejects(
      () =>
        waiveClaimDocument({
          claimId,
          actorUserId: String(staff._id),
          category: "VALUE_PROOF",
          reason: "   "
        }),
      /reason/i
    );

    await waiveClaimDocument({
      claimId,
      actorUserId: String(staff._id),
      category: "VALUE_PROOF",
      reason: "Vendor invoice destroyed with the goods."
    });

    await assert.rejects(
      () =>
        waiveClaimDocument({
          claimId,
          actorUserId: String(staff._id),
          category: "VALUE_PROOF",
          reason: "Duplicate."
        }),
      /already been waived/i
    );
  });

  test("only roles with the waive permission may waive", async () => {
    const fixture = await createAccount("Iota");
    const claimId = await fileClaim(fixture);

    const financeUser = await User.create({
      firstName: "Finance",
      lastName: "User",
      email: `finance-${Date.now()}@example.com`,
      phone: `+9198760${String(Date.now()).slice(-5)}`,
      role: "finance",
      userStatus: "active",
      isVerified: true,
      passwordHash: "stored-password-hash",
      assignedBranches: [fixture.branch._id]
    });

    const result = recorder();
    await waiveStaffClaimDocument(
      asRequest({
        user: { _id: financeUser._id, role: "finance", assignedBranches: [fixture.branch._id] },
        params: { claimId },
        body: { category: "VALUE_PROOF", reason: "Not obtainable." }
      }),
      result.response,
      noop
    );

    // Finance can pay a claim but must not be able to lower the evidence bar it
    // was assessed against.
    assert.equal(result.statusCode(), 403);
  });
});

describe("branch scoping", () => {
  test("staff cannot reach a claim outside their assigned branches", async () => {
    const claimId = await fileClaim(beta);

    const result = recorder();
    await waiveStaffClaimDocument(
      asRequest({
        // Assigned to alpha's branch only.
        user: { _id: staff._id, role: "operations", assignedBranches: [alpha.branch._id] },
        params: { claimId },
        body: { category: "VALUE_PROOF", reason: "Out of scope." }
      }),
      result.response,
      noop
    );

    assert.equal(result.statusCode(), 404);
  });

  test("an operations user can start review on their own branch", async () => {
    const fixture = await createAccount("Kappa");
    const claimId = await fileClaim(fixture);
    await submitClaim(fixture, claimId);

    const claim = await startClaimReview({ claimId, actorUserId: String(staff._id) });
    assert.equal(claim.status, "UNDER_REVIEW");
  });
});
