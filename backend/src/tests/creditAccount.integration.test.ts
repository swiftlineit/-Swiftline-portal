import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import { activateAdminCreditAccount, approveAdminCreditAccount } from "../controllers/adminCredit.controller.js";
import { updateBusinessAccountOperationalAction } from "../controllers/businessAccount.controller.js";
import {
  createAdminCreditAgreementDraft,
  getAdminCreditAgreement,
  getClientCreditAgreement,
  listAdminCreditAgreements,
  listClientCreditAgreements
} from "../controllers/creditAgreement.controller.js";
import {
  acceptClientPaymentTerms,
  getClientCreditSummary,
  requestClientCredit
} from "../controllers/clientCredit.controller.js";
import { env } from "../config/env.js";
import { deleteObject } from "../services/storage/storage.service.js";
import { AuditLog } from "../models/auditLog.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { BusinessAccountMember } from "../models/businessAccountMember.model.js";
import { BusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { Branch } from "../models/branch.model.js";
import { CreditLedgerEntry } from "../models/creditLedgerEntry.model.js";
import { CreditLimitHistory } from "../models/creditLimitHistory.model.js";
import { CreditAgreement } from "../models/creditAgreement.model.js";
import { CreditAgreementCounter } from "../models/creditAgreementCounter.model.js";
import { generateCreditAgreement } from "../services/creditAgreement.service.js";
import { PaymentTermsAcceptance } from "../models/paymentTerms.model.js";
import { User } from "../models/user.model.js";
import { fallbackPaymentTerms } from "../services/creditAccount.service.js";

const databaseName = `swiftline_credit_test_${Date.now()}`;

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

function controllerRequest(input: {
  userId: mongoose.Types.ObjectId;
  role: "admin" | "client";
  body?: unknown;
  params?: Record<string, string>;
  query?: Record<string, string>;
}) {
  return {
    user: { _id: input.userId, role: input.role },
    body: input.body ?? {},
    params: input.params ?? {},
    query: input.query ?? {},
    ip: "127.0.0.1",
    get: (header: string) => header.toLowerCase() === "user-agent" ? "swiftline-credit-integration-test" : undefined
  } as unknown as Request;
}

function approvalBody() {
  return {
    approvedCreditLimitMinor: 1_500_000,
    paymentTermsDays: 30,
    billingCycle: "MONTHLY",
    validFrom: "2026-07-16",
    validUntil: "2027-07-16",
    gracePeriodDays: 2,
    maxOverdueDays: 30,
    creditWarningThresholdPercent: 75,
    securityDepositRequiredMinor: 0,
    riskCategory: "LOW",
    internalRemarks: "Automated integration test approval",
    reason: "Verified by automated finance policy test"
  };
}

before(async () => {
  await mongoose.connect(env.MONGODB_URI, { dbName: databaseName, family: 4, retryWrites: false });
  assert.equal(mongoose.connection.name, databaseName, "Integration tests must use the isolated credit test database.");
  await Promise.all([
    BusinessAccount.init(),
    BusinessAccountMember.init(),
    BusinessCreditAccount.init(),
    Branch.init(),
    CreditLedgerEntry.init(),
    CreditLimitHistory.init(),
    CreditAgreement.init(),
    CreditAgreementCounter.init(),
    PaymentTermsAcceptance.init(),
    AuditLog.init(),
    User.init()
  ]);
});

after(async () => {
  if (mongoose.connection.readyState !== 0) {
    assert.ok(mongoose.connection.name.startsWith("swiftline_credit_test_"), "Refusing to clean a non-test database.");
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

describe("credit account database lifecycle", () => {
  test("request, approval, activation, privacy and terms acceptance remain consistent", async () => {
    const ownerId = new mongoose.Types.ObjectId();
    const operationsId = new mongoose.Types.ObjectId();
    const adminId = new mongoose.Types.ObjectId();
    const branch = await Branch.create({
      name: "Credit Test Branch",
      code: `CT-${Date.now()}`,
      status: "ACTIVE",
      address: { countryCode: "IN", countryName: "India", city: "Delhi" },
      operations: { supportedServices: [], shipmentCoverage: [], operatingCountries: ["IN"], workingDays: [] },
      createdBy: adminId
    });
    const business = await BusinessAccount.create({
      accountId: `CREDIT-TEST-${Date.now()}`,
      status: "approved",
      contact: {
        title: "mr.", firstName: "Credit", lastName: "Owner",
        email: `credit-${Date.now()}@example.test`, mobileType: "mobile",
        countryCode: "+91", mobileNumber: "9000000000", jobTitle: "Owner",
        department: "Finance", shipmentTypes: ["international_courier"]
      },
      company: {
        registrationCountry: "India", registrationId: "TEST1234", companyType: "pvt_ltd",
        companyName: "Swiftline Credit Test Account", registeredAddress: "Test Address",
        city: "Delhi", stateOrProvince: "Delhi", postalCode: "110001",
        addressCountry: "India", operatingCountries: ["India"], industry: "Testing",
        monthlyShipmentVolume: "1-10", requestedCreditLimit: { currency: "INR", amount: 20_000 }
      },
      kycReview: { overallStatus: "verified", checks: {} },
      agreementStatus: "signed",
      depositStatus: "not_required",
      assignedBranch: branch._id,
      createdBy: adminId
    });

    await BusinessAccountMember.create([
      { businessAccount: business._id, user: ownerId, role: "account_owner", status: "active", invitedBy: adminId, joinedAt: new Date() },
      { businessAccount: business._id, user: operationsId, role: "operations", status: "active", invitedBy: adminId, joinedAt: new Date() }
    ]);

    for (const action of ["deposit_required", "deposit_received"] as const) {
      const operationalUpdate = createResponseRecorder();
      await updateBusinessAccountOperationalAction(controllerRequest({
        userId: adminId,
        role: "admin",
        params: { accountId: business.accountId },
        body: { action }
      }), operationalUpdate.response);
      assert.equal(operationalUpdate.statusCode(), 200);
      const updated = operationalUpdate.body<{
        account: {
          status: string;
          agreementStatus: string;
          creditLimitStatus: string;
          assignedBranch: { _id: string; code: string };
          kycReview: { overallStatus: string };
        };
      }>().account;
      assert.equal(updated.assignedBranch.code, branch.code);
      assert.equal(String(updated.assignedBranch._id), String(branch._id));
      assert.equal(updated.status, "approved");
      assert.equal(updated.kycReview.overallStatus, "verified");
      assert.equal(updated.agreementStatus, "signed");
      assert.equal(updated.creditLimitStatus, "not_reviewed");
    }

    const removedAgreementAction = createResponseRecorder();
    await updateBusinessAccountOperationalAction(controllerRequest({
      userId: adminId,
      role: "admin",
      params: { accountId: business.accountId },
      body: { action: "agreement_generated" }
    }), removedAgreementAction.response);
    assert.equal(removedAgreementAction.statusCode(), 400);

    const afterOperationalUpdates = await BusinessAccount.findById(business._id).lean();
    assert.equal(String(afterOperationalUpdates?.assignedBranch), String(branch._id));
    assert.equal(afterOperationalUpdates?.status, "approved");
    assert.equal(afterOperationalUpdates?.kycReview.overallStatus, "verified");
    assert.equal(afterOperationalUpdates?.agreementStatus, "signed");

    const requested = createResponseRecorder();
    await requestClientCredit(controllerRequest({
      userId: ownerId,
      role: "client",
      body: { businessAccountId: String(business._id), requestedCreditLimitMinor: 2_000_000, reason: "Monthly international shipment volume requires shared company credit." }
    }), requested.response);
    assert.equal(requested.statusCode(), 201);
    assert.equal(requested.body<{ creditAccount: { status: string } }>().creditAccount.status, "PENDING_REVIEW");

    const approved = createResponseRecorder();
    await approveAdminCreditAccount(controllerRequest({
      userId: adminId, role: "admin", params: { businessAccountId: String(business._id) }, body: approvalBody()
    }), approved.response);
    assert.equal(approved.statusCode(), 200);
    assert.equal(approved.body<{ creditAccount: { status: string; approvedCreditLimitMinor: number } }>().creditAccount.status, "APPROVED");
    assert.equal(approved.body<{ creditAccount: { approvedCreditLimitMinor: number } }>().creditAccount.approvedCreditLimitMinor, 1_500_000);

    const draftResponse = createResponseRecorder();
    await createAdminCreditAgreementDraft(controllerRequest({
      userId: adminId,
      role: "admin",
      params: { businessAccountId: String(business._id) }
    }), draftResponse.response);
    assert.equal(draftResponse.statusCode(), 201);
    const draft = draftResponse.body<{
      agreement: {
        id: string;
        agreementNumber: string;
        version: number;
        status: string;
        termsVersion: string;
        snapshot: { business: { accountId: string }; credit: { approvedCreditLimitMinor: number } };
      };
    }>().agreement;
    assert.equal(draft.version, 1);
    assert.equal(draft.status, "DRAFT");
    assert.match(draft.agreementNumber, /^CA-CREDIT-TEST-\d+-V001$/);
    assert.equal(draft.snapshot.business.accountId, business.accountId);
    assert.equal(draft.snapshot.credit.approvedCreditLimitMinor, 1_500_000);

    const duplicateDraft = createResponseRecorder();
    await createAdminCreditAgreementDraft(controllerRequest({
      userId: adminId,
      role: "admin",
      params: { businessAccountId: String(business._id) }
    }), duplicateDraft.response);
    assert.equal(duplicateDraft.statusCode(), 409);
    assert.equal(duplicateDraft.body<{ code: string }>().code, "OPEN_AGREEMENT_EXISTS");

    const adminList = createResponseRecorder();
    await listAdminCreditAgreements(controllerRequest({
      userId: adminId,
      role: "admin",
      query: { businessAccountId: String(business._id), status: "DRAFT" }
    }), adminList.response);
    assert.equal(adminList.statusCode(), 200);
    assert.equal(adminList.body<{ agreements: unknown[] }>().agreements.length, 1);

    const adminDetail = createResponseRecorder();
    await getAdminCreditAgreement(controllerRequest({
      userId: adminId,
      role: "admin",
      params: { agreementId: draft.id }
    }), adminDetail.response);
    assert.equal(adminDetail.statusCode(), 200);
    assert.equal(adminDetail.body<{ auditHistory: Array<{ action: string }> }>().auditHistory[0]?.action, "CREDIT_AGREEMENT_DRAFT_CREATED");

    const ownerAgreements = createResponseRecorder();
    await listClientCreditAgreements(controllerRequest({
      userId: ownerId,
      role: "client",
      query: { businessAccountId: String(business._id) }
    }), ownerAgreements.response);
    assert.equal(ownerAgreements.statusCode(), 200);
    const ownerAgreement = ownerAgreements.body<{ agreements: Array<Record<string, unknown>> }>().agreements[0];
    assert.ok(ownerAgreement);
    assert.equal("createdBy" in ownerAgreement, false);

    const ownerAgreementDetail = createResponseRecorder();
    await getClientCreditAgreement(controllerRequest({
      userId: ownerId,
      role: "client",
      params: { agreementId: draft.id }
    }), ownerAgreementDetail.response);
    assert.equal(ownerAgreementDetail.statusCode(), 200);

    const operationsAgreements = createResponseRecorder();
    await listClientCreditAgreements(controllerRequest({
      userId: operationsId,
      role: "client",
      query: { businessAccountId: String(business._id) }
    }), operationsAgreements.response);
    assert.equal(operationsAgreements.statusCode(), 403);

    // Agreements go through the storage service now, so there is no temporary
    // directory to create or tear down- the local driver handles placement.
    const generated = await generateCreditAgreement({
      agreementId: new mongoose.Types.ObjectId(draft.id),
      generatedBy: adminId
    });
    assert.equal(generated.status, "GENERATED");
    assert.equal(generated.generatedDocument?.mimeType, "application/pdf");
    assert.match(generated.generatedDocument?.checksumSha256 ?? "", /^[a-f0-9]{64}$/);
    assert.ok((generated.generatedDocument?.size ?? 0) > 5_000);

    const repeated = await generateCreditAgreement({
      agreementId: new mongoose.Types.ObjectId(draft.id),
      generatedBy: adminId
    });
    assert.equal(repeated.generatedDocument?.checksumSha256, generated.generatedDocument?.checksumSha256);
    assert.equal(await AuditLog.countDocuments({
      entityType: "CREDIT_AGREEMENT",
      entityId: generated._id,
      action: "CREDIT_AGREEMENT_GENERATED"
    }), 1);

    if (generated.generatedDocument?.storageKey) {
      await deleteObject(generated.generatedDocument.storageKey).catch(() => undefined);
    }

    const activated = createResponseRecorder();
    await activateAdminCreditAccount(controllerRequest({
      userId: adminId, role: "admin", params: { businessAccountId: String(business._id) }
    }), activated.response);
    assert.equal(activated.statusCode(), 200);
    assert.equal(activated.body<{ creditAccount: { status: string; availableCreditMinor: number } }>().creditAccount.status, "ACTIVE");
    assert.equal(activated.body<{ creditAccount: { availableCreditMinor: number } }>().creditAccount.availableCreditMinor, 1_500_000);

    const ownerSummary = createResponseRecorder();
    await getClientCreditSummary(controllerRequest({
      userId: ownerId, role: "client", query: { businessAccountId: String(business._id) }
    }), ownerSummary.response);
    assert.equal(ownerSummary.statusCode(), 200);
    assert.equal(ownerSummary.body<{ creditAccount: { approvedCreditLimitMinor: number } }>().creditAccount.approvedCreditLimitMinor, 1_500_000);
    assert.equal(
      ownerSummary.body<{ creditAccount: { businessAccount: { depositStatus: string } } }>().creditAccount.businessAccount.depositStatus,
      "received"
    );

    const operationsSummary = createResponseRecorder();
    await getClientCreditSummary(controllerRequest({
      userId: operationsId, role: "client", query: { businessAccountId: String(business._id) }
    }), operationsSummary.response);
    assert.equal(operationsSummary.statusCode(), 200);
    const restrictedCredit = operationsSummary.body<{ creditAccount: Record<string, unknown> }>().creditAccount;
    assert.equal(restrictedCredit.approvedCreditLimitMinor, undefined);
    assert.equal(restrictedCredit.availableBookingCapacityMinor, undefined);
    assert.equal(restrictedCredit.canUseCredit, true);

    const operationsTerms = createResponseRecorder();
    await acceptClientPaymentTerms(controllerRequest({
      userId: operationsId,
      role: "client",
      body: { businessAccountId: String(business._id), termsVersion: fallbackPaymentTerms.version }
    }), operationsTerms.response);
    assert.equal(operationsTerms.statusCode(), 403);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const accepted = createResponseRecorder();
      await acceptClientPaymentTerms(controllerRequest({
        userId: ownerId,
        role: "client",
        body: { businessAccountId: String(business._id), termsVersion: fallbackPaymentTerms.version, paymentReference: "TOPUP-CREDIT-TEST-1" }
      }), accepted.response);
      assert.equal(accepted.statusCode(), 200);
    }

    assert.equal(await BusinessCreditAccount.countDocuments({ businessAccountId: business._id }), 1);
    assert.equal(await CreditAgreement.countDocuments({ businessAccountId: business._id }), 1);
    assert.equal((await CreditAgreementCounter.findOne({ businessAccountId: business._id }).lean())?.version, 1);
    assert.equal(await CreditLimitHistory.countDocuments({ businessAccountId: business._id }), 1);
    assert.equal(await PaymentTermsAcceptance.countDocuments({ businessAccountId: business._id }), 1);
    assert.equal(await AuditLog.countDocuments({ entityId: (await BusinessCreditAccount.findOne({ businessAccountId: business._id }).lean())?._id }), 1);

    const ledger = await CreditLedgerEntry.find({ businessAccountId: business._id }).sort({ createdAt: 1 }).lean();
    assert.deepEqual(ledger.map((entry) => entry.type), ["CREDIT_REQUESTED", "CREDIT_APPROVED", "CREDIT_ACTIVATED"]);
    assert.deepEqual(ledger.map((entry) => entry.availableCreditAfterMinor), [0, 0, 1_500_000]);

    const refreshedBusiness = await BusinessAccount.findById(business._id).lean();
    assert.equal(refreshedBusiness?.status, "approved", "Credit actions must not overwrite the business lifecycle status.");
    assert.equal(refreshedBusiness?.creditLimitStatus, "approved");
  });
});
