import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { createShipment } from "../controllers/dpdShipment.controller.js";
import { createManualShipmentDraft } from "../controllers/shipmentDraft.controller.js";
import { Branch } from "../models/branch.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentQuote } from "../models/shipmentQuote.model.js";
import { User } from "../models/user.model.js";
import {
  ShipmentQuoteError,
  convertShipmentQuoteToDraft,
  createShipmentDraftFromEstimate
} from "../services/shipmentQuote.service.js";
import {
  ManualShipmentDraftError,
  createBlankShipmentDraft,
  createIndividualShipmentDraft
} from "../services/manualShipmentDraft.service.js";
import {
  ShipmentDraftPolicyError,
  assertShipmentDraftMutationAllowed,
  canModifyShipmentDraft
} from "../services/shipmentDraftPolicy.service.js";

// Kept short: Atlas caps database names at 38 bytes.
const databaseName = `sl_draft_scope_${Date.now()}`;

/**
 * The service assigns its result inside a transaction callback, which leaves
 * TypeScript narrowing the return to `never`. Callers in shipmentQuote.service.ts
 * cast for the same reason; this keeps that in one place for the tests.
 */
const openBusinessDraft = (input: Parameters<typeof createBlankShipmentDraft>[0]) =>
  createBlankShipmentDraft(input) as unknown as Promise<InstanceType<typeof ShipmentDraft>>;

const adminId = new mongoose.Types.ObjectId();

let homeBranchId: mongoose.Types.ObjectId;
let otherBranchId: mongoose.Types.ObjectId;
let homeAccountId: mongoose.Types.ObjectId;
// Operations members: one holding the draft's branch, one holding a different
// branch, and one with nothing assigned at all.
let inBranchUserId: mongoose.Types.ObjectId;
let outOfBranchUserId: mongoose.Types.ObjectId;
let unassignedUserId: mongoose.Types.ObjectId;

async function createBranch(name: string) {
  const branch = await Branch.create({
    name,
    code: `SC${Math.floor(1000 + Math.random() * 8999)}`,
    status: "ACTIVE",
    address: { addressLine1: "1 Scope Road", city: "Delhi", state: "Delhi", postalCode: "110001", country: "India" },
    contact: { email: "scope@swiftline.test", countryCode: "+91", phone: "9000000000" },
    createdBy: adminId
  });
  return branch._id as mongoose.Types.ObjectId;
}

async function createOperationsUser(assignedBranches: mongoose.Types.ObjectId[]) {
  const user = await User.create({
    email: `ops${Date.now()}${Math.floor(Math.random() * 10000)}@swiftline.test`,
    role: "operations",
    assignedBranches
  });
  return user._id as mongoose.Types.ObjectId;
}

async function createBusinessAccount(assignedBranch: mongoose.Types.ObjectId) {
  const account = await BusinessAccount.create({
    accountId: `BA-SCOPE-${Date.now()}${Math.floor(Math.random() * 1000)}`,
    status: "approved",
    contact: {
      firstName: "Scope", lastName: "Customer", email: `scope${Date.now()}@example.com`,
      mobileType: "mobile", countryCode: "+91",
      mobileNumber: String(9100000000 + Math.floor(Math.random() * 800000))
    },
    company: {
      registrationCountry: "India",
      companyName: "Scope Customer Pvt Ltd",
      operatingCountries: ["India"]
    },
    assignedBranch,
    createdBy: adminId
  });
  return account._id as mongoose.Types.ObjectId;
}

/** A draft sitting in the home branch, which is what every check is made against. */
async function createDraft(branchId: mongoose.Types.ObjectId) {
  return ShipmentDraft.create({
    creationSource: "MANUAL",
    businessAccountId: homeAccountId,
    branchId,
    consigneeEnteredAddress: {
      companyName: "Scope Test Customer",
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
    createdBy: adminId
  });
}

before(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: databaseName, family: 4, retryWrites: false });
  assert.equal(mongoose.connection.name, databaseName, "Branch scope tests must use an isolated database.");
  await Promise.all([Branch.init(), BusinessAccount.init(), ShipmentDraft.init(), User.init()]);

  homeBranchId = await createBranch("Scope Home Branch");
  otherBranchId = await createBranch("Scope Other Branch");
  homeAccountId = await createBusinessAccount(homeBranchId);
  inBranchUserId = await createOperationsUser([homeBranchId]);
  outOfBranchUserId = await createOperationsUser([otherBranchId]);
  unassignedUserId = await createOperationsUser([]);
});

after(async () => {
  if (mongoose.connection.readyState !== 0) {
    assert.ok(mongoose.connection.name.startsWith("sl_draft_scope_"), "Refusing to clean a non-test database.");
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

describe("operations branch scope on shipment draft mutations", () => {
  test("allows operations to modify a draft in its assigned branch", async () => {
    const draft = await createDraft(homeBranchId);

    assert.equal(
      await canModifyShipmentDraft({ draft, userId: inBranchUserId, portalRole: "operations" }),
      true
    );
    // The full assert also has to pass: an editable draft must not be refused.
    await assertShipmentDraftMutationAllowed({ draft, userId: inBranchUserId, portalRole: "operations" });
  });

  test("refuses operations a draft in a branch it does not hold", async () => {
    const draft = await createDraft(homeBranchId);

    assert.equal(
      await canModifyShipmentDraft({ draft, userId: outOfBranchUserId, portalRole: "operations" }),
      false
    );
    await assert.rejects(
      () => assertShipmentDraftMutationAllowed({ draft, userId: outOfBranchUserId, portalRole: "operations" }),
      (error: unknown) => error instanceof ShipmentDraftPolicyError && error.statusCode === 403
    );
  });

  test("refuses operations with no branch assignment", async () => {
    const draft = await createDraft(homeBranchId);

    assert.equal(
      await canModifyShipmentDraft({ draft, userId: unassignedUserId, portalRole: "operations" }),
      false
    );
  });

  test("leaves admin unrestricted", async () => {
    const draft = await createDraft(otherBranchId);

    assert.equal(
      await canModifyShipmentDraft({ draft, userId: adminId, portalRole: "admin" }),
      true
    );
  });

  test("refuses a role that owns no draft path at all", async () => {
    const draft = await createDraft(homeBranchId);

    assert.equal(
      await canModifyShipmentDraft({ draft, userId: inBranchUserId, portalRole: "delivery" }),
      false
    );
  });
});

describe("operations branch scope on draft creation", () => {
  test("opens a business draft in the caller's own branch", async () => {
    const draft = await openBusinessDraft({
      businessAccountId: String(homeAccountId),
      branchId: String(homeBranchId),
      createdBy: inBranchUserId,
      allowedBranchIds: [String(homeBranchId)]
    });

    assert.equal(String(draft.branchId), String(homeBranchId));
  });

  test("refuses a business draft in a branch the caller does not hold", async () => {
    await assert.rejects(
      () => createBlankShipmentDraft({
        businessAccountId: String(homeAccountId),
        branchId: String(homeBranchId),
        createdBy: outOfBranchUserId,
        allowedBranchIds: [String(otherBranchId)]
      }),
      (error: unknown) => error instanceof ManualShipmentDraftError && error.statusCode === 403
    );
  });

  test("refuses a walk-in draft in a branch the caller does not hold", async () => {
    await assert.rejects(
      () => createIndividualShipmentDraft({
        branchId: String(homeBranchId),
        customer: { contactName: "Walk In", mobileCountryCode: "+91", mobileNumber: "9876500031" },
        createdBy: outOfBranchUserId,
        allowedBranchIds: [String(otherBranchId)]
      }),
      (error: unknown) => error instanceof ManualShipmentDraftError && error.statusCode === 403
    );
  });

  test("scopes on the resolved branch, so a branch code is accepted", async () => {
    const branch = await Branch.findById(homeBranchId).lean().exec();
    assert.ok(branch);

    // The guard reads the resolved branch rather than the request value: a
    // caller naming its own branch by code must not be turned away as invalid.
    const draft = await openBusinessDraft({
      businessAccountId: String(homeAccountId),
      branchId: branch.code,
      createdBy: inBranchUserId,
      allowedBranchIds: [String(homeBranchId)]
    });

    assert.equal(String(draft.branchId), String(homeBranchId));
  });

  test("leaves an unrestricted caller free to pick any branch", async () => {
    const draft = await openBusinessDraft({
      businessAccountId: String(homeAccountId),
      branchId: String(homeBranchId),
      createdBy: adminId,
      allowedBranchIds: null
    });

    assert.equal(String(draft.branchId), String(homeBranchId));
  });
});

function createResponseRecorder() {
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

function requestAs(
  role: string,
  userId: mongoose.Types.ObjectId,
  body: Record<string, unknown>,
  options: { assignedBranches?: mongoose.Types.ObjectId[]; params?: Record<string, string> } = {}
) {
  return {
    user: { _id: userId, role, assignedBranches: options.assignedBranches ?? [] },
    body,
    params: options.params ?? {},
    query: {}
  } as unknown as Request;
}

const branchDeniedMessage = "You do not have access to this branch.";

/**
 * client.controller.ts reuses these staff handlers, resolving the branch from
 * the caller's account membership and writing it into the body before
 * delegating. A client holds no branch assignment of its own, so any branch
 * scope read off the user record here refuses every client booking. This is a
 * regression guard: scoping creation by `assignedBranches` alone broke exactly
 * this path.
 */
describe("client callers reaching the staff draft handlers", () => {
  test("creates a manual draft for a client, which carries no branch assignment", async () => {
    const clientUserId = new mongoose.Types.ObjectId();
    const recorder = createResponseRecorder();

    await createManualShipmentDraft(
      requestAs("client", clientUserId, {
        businessAccountId: String(homeAccountId),
        branchId: String(homeBranchId)
      }),
      recorder.response
    );

    assert.equal(recorder.statusCode(), 201, JSON.stringify(recorder.body()));
  });

  test("still refuses an operations caller outside its branches", async () => {
    const recorder = createResponseRecorder();

    await createManualShipmentDraft(
      requestAs(
        "operations",
        outOfBranchUserId,
        { businessAccountId: String(homeAccountId), branchId: String(homeBranchId) },
        { assignedBranches: [otherBranchId] }
      ),
      recorder.response
    );

    assert.equal(recorder.statusCode(), 403);
  });
});

/**
 * Booking is guarded in the controller rather than the draft policy, so it needs
 * its own cover. Only the refusal is asserted end to end: letting a booking
 * through reaches the carrier, which these tests do not stand up. The positive
 * case checks the branch guard is not what stops an in-branch caller.
 */
describe("operations branch scope on booking", () => {
  test("refuses booking a draft outside the caller's branches", async () => {
    const draft = await createDraft(homeBranchId);
    const recorder = createResponseRecorder();

    await createShipment(
      requestAs(
        "operations",
        outOfBranchUserId,
        {},
        { assignedBranches: [otherBranchId], params: { id: String(draft._id) } }
      ),
      recorder.response
    );

    assert.equal(recorder.statusCode(), 403);
    assert.equal(recorder.body<{ message: string }>().message, branchDeniedMessage);
  });

  test("does not stop an in-branch caller at the branch check", async () => {
    const draft = await createDraft(homeBranchId);
    const recorder = createResponseRecorder();

    await createShipment(
      requestAs(
        "operations",
        inBranchUserId,
        {},
        { assignedBranches: [homeBranchId], params: { id: String(draft._id) } }
      ),
      recorder.response
    );

    // Whatever happens next belongs to booking, not to branch access.
    assert.notEqual(recorder.body<{ message: string }>().message, branchDeniedMessage);
  });

  test("leaves admin free to book any branch", async () => {
    const draft = await createDraft(otherBranchId);
    const recorder = createResponseRecorder();

    await createShipment(
      requestAs("admin", adminId, {}, { params: { id: String(draft._id) } }),
      recorder.response
    );

    assert.notEqual(recorder.body<{ message: string }>().message, branchDeniedMessage);
  });
});

/**
 * The quote conversions run the branch check first, before the quote is claimed
 * or any rate is priced, so a refusal never leaves a quote marked as converting.
 * That also means these cases need no rate-card fixtures: a refused call returns
 * before reaching them.
 */
describe("operations branch scope on quote conversion", () => {
  const quoteInBranch = (branchId: mongoose.Types.ObjectId) =>
    new ShipmentQuote({ businessAccountId: homeAccountId, branchId, quoteNumber: "Q-SCOPE-1" });

  test("refuses converting a quote from a branch the caller does not hold", async () => {
    await assert.rejects(
      () => convertShipmentQuoteToDraft({
        quote: quoteInBranch(homeBranchId),
        userId: outOfBranchUserId,
        allowedBranchIds: [String(otherBranchId)]
      }),
      (error: unknown) => error instanceof ShipmentQuoteError
        && error.statusCode === 403
        && error.message === branchDeniedMessage
    );
  });

  test("refuses an estimate draft outside the caller's branches", async () => {
    await assert.rejects(
      () => createShipmentDraftFromEstimate({
        context: { businessAccountId: homeAccountId, branchId: homeBranchId } as never,
        request: {} as never,
        userId: outOfBranchUserId,
        allowedBranchIds: [String(otherBranchId)]
      }),
      (error: unknown) => error instanceof ShipmentQuoteError
        && error.statusCode === 403
        && error.message === branchDeniedMessage
    );
  });

  test("does not stop an unscoped client at the branch gate", async () => {
    // Clients pass null. Whatever fails later belongs to quote state or
    // pricing, never to branch access.
    await assert.rejects(
      () => convertShipmentQuoteToDraft({
        quote: quoteInBranch(homeBranchId),
        userId: outOfBranchUserId,
        allowedBranchIds: null
      }),
      (error: unknown) => error instanceof Error && error.message !== branchDeniedMessage
    );
  });

  test("lets operations convert a quote in its own branch past the gate", async () => {
    await assert.rejects(
      () => convertShipmentQuoteToDraft({
        quote: quoteInBranch(homeBranchId),
        userId: inBranchUserId,
        allowedBranchIds: [String(homeBranchId)]
      }),
      (error: unknown) => error instanceof Error && error.message !== branchDeniedMessage
    );
  });
});
