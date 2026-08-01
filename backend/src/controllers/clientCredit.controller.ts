import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { BusinessAccountMember } from "../models/businessAccountMember.model.js";
import { PaymentTermsAcceptance } from "../models/paymentTerms.model.js";
import { maxCreditLimitMinor } from "../models/financialTypes.js";
import {
  appendCreditLedgerEntry, ensureCreditAccount, getCurrentPaymentTerms,
  getMemberCreditPermissions, serializeCreditAccount
} from "../services/creditAccount.service.js";
import { getCreditRestrictionState } from "../services/creditOverdue.service.js";
import { notifyActiveAdmins } from "../services/portalNotification.service.js";

const requestCreditSchema = z.object({
  businessAccountId: z.string().trim().min(1),
  requestedCreditLimitMinor: z.number().int()
    .min(100, "Requested credit must be at least one rupee.")
    .max(maxCreditLimitMinor, "Requested credit limit cannot exceed INR 1,00,000."),
  reason: z.string().trim().min(10, "Explain why the credit facility is required.").max(500)
});

const acceptTermsSchema = z.object({
  businessAccountId: z.string().trim().min(1),
  termsVersion: z.string().trim().min(1),
  paymentReference: z.string().trim().max(120).optional().default("")
});

function userId(request: Request) {
  const id = (request as Request & { user?: { _id?: unknown } }).user?._id;
  return id && mongoose.Types.ObjectId.isValid(String(id)) ? new mongoose.Types.ObjectId(String(id)) : null;
}

async function membershipFor(request: Request, businessAccountId: string) {
  const currentUserId = userId(request);
  if (!currentUserId || !mongoose.Types.ObjectId.isValid(businessAccountId)) return null;
  return BusinessAccountMember.findOne({
    user: currentUserId,
    businessAccount: new mongoose.Types.ObjectId(businessAccountId),
    status: "active"
  }).exec();
}

export async function getClientCreditSummary(request: Request, response: Response): Promise<Response> {
  const businessAccountId = typeof request.query.businessAccountId === "string" ? request.query.businessAccountId : "";
  const membership = await membershipFor(request, businessAccountId);
  if (!membership) return response.status(404).json({ success: false, message: "Business account access was not found." });

  const account = await ensureCreditAccount(membership.businessAccount);
  const business = await BusinessAccount.findById(membership.businessAccount)
    .select("accountId status company.companyName kycReview.overallStatus agreementStatus depositStatus")
    .lean()
    .exec();
  if (!business) return response.status(404).json({ success: false, message: "Business account was not found." });

  const permissions = getMemberCreditPermissions(membership.role, membership.creditPermissions);
  const canViewBalances = permissions.includes("viewCreditBalance");
  const serialized = serializeCreditAccount(account);
  const restriction = await getCreditRestrictionState({
    businessAccountId: membership.businessAccount,
    gracePeriodDays: account.gracePeriodDays,
    maxOverdueDays: account.maxOverdueDays
  });
  const effectiveBookingCapacityMinor = restriction.level === "ALL_BOOKINGS_BLOCKED"
    ? 0
    : restriction.level === "CREDIT_BLOCKED"
      ? serialized.availableAdvanceMinor
      : serialized.availableBookingCapacityMinor;
  const businessAccount = {
    id: String(business._id),
    accountId: business.accountId,
    companyName: business.company.companyName,
    status: business.status,
    kycStatus: business.kycReview.overallStatus,
    agreementStatus: business.agreementStatus,
    depositStatus: business.depositStatus
  };

  return response.status(200).json({
    success: true,
    permissions,
    creditAccount: canViewBalances ? {
      ...serialized,
      canUseCredit: serialized.status === "ACTIVE"
        && permissions.includes("useCreditPayment")
        && !["CREDIT_BLOCKED", "ALL_BOOKINGS_BLOCKED"].includes(restriction.level),
      availableBookingCapacityMinor: effectiveBookingCapacityMinor,
      restriction,
      businessAccount
    } : {
      id: serialized.id,
      businessAccountId: serialized.businessAccountId,
      status: serialized.status,
      currency: serialized.currency,
      paymentTermsDays: serialized.paymentTermsDays,
      billingCycle: serialized.billingCycle,
      validUntil: serialized.validUntil,
      canUseCredit: serialized.status === "ACTIVE"
        && permissions.includes("useCreditPayment")
        && !["CREDIT_BLOCKED", "ALL_BOOKINGS_BLOCKED"].includes(restriction.level),
      restriction,
      businessAccount
    }
  });
}

export async function requestClientCredit(request: Request, response: Response): Promise<Response> {
  const currentUserId = userId(request);
  if (!currentUserId) return response.status(401).json({ success: false, message: "Please sign in again." });
  const parsed = requestCreditSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message || "Check the credit request details." });

  const membership = await membershipFor(request, parsed.data.businessAccountId);
  if (!membership) return response.status(404).json({ success: false, message: "Business account access was not found." });
  const permissions = getMemberCreditPermissions(membership.role, membership.creditPermissions);
  if (!permissions.includes("requestCredit")) return response.status(403).json({ success: false, message: "Your account role cannot request a credit facility." });

  const businessAccount = await BusinessAccount.findById(membership.businessAccount).exec();
  if (!businessAccount || !["approved", "active"].includes(businessAccount.status)) {
    return response.status(409).json({ success: false, message: "The business account must be approved before requesting credit." });
  }

  const session = await mongoose.startSession();
  try {
    let result: ReturnType<typeof serializeCreditAccount> | undefined;
    await session.withTransaction(async () => {
      const account = await ensureCreditAccount(membership.businessAccount, session);
      if (!["NOT_REQUESTED", "REJECTED"].includes(account.status)) {
        throw new Error("CREDIT_REQUEST_EXISTS");
      }
      account.status = "PENDING_REVIEW";
      account.requestedCreditLimitMinor = parsed.data.requestedCreditLimitMinor;
      account.requestReason = parsed.data.reason;
      account.requestedBy = currentUserId;
      account.requestedAt = new Date();
      account.version += 1;
      await account.save({ session });
      await appendCreditLedgerEntry({
        account, type: "CREDIT_REQUESTED", reference: `CREDIT-REQUEST-${account.version}`,
        description: "Business credit facility requested.", amountMinor: account.requestedCreditLimitMinor,
        idempotencyKey: `CREDIT_REQUEST:${String(account._id)}:${account.version}`,
        createdBy: currentUserId, session
      });
      result = serializeCreditAccount(account);
    });

    await notifyActiveAdmins({
      type: "CREDIT_REQUEST_SUBMITTED",
      title: "Credit facility requested",
      message: `${businessAccount.company.companyName || businessAccount.accountId} requested a credit facility and is awaiting review.`,
      href: `/dashboard/credit-accounts#credit-account-${String(membership.businessAccount)}`,
      idempotencyKey: `CREDIT_REQUEST_SUBMITTED:${String(membership.businessAccount)}:${result?.version ?? 0}`,
      businessAccountId: membership.businessAccount,
      metadata: { requestedCreditLimitMinor: parsed.data.requestedCreditLimitMinor }
    });
    return response.status(201).json({ success: true, message: "Credit request submitted for review.", creditAccount: result });
  } catch (error) {
    if (error instanceof Error && error.message === "CREDIT_REQUEST_EXISTS") {
      return response.status(409).json({ success: false, message: "A credit request is already under review or has been approved." });
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function getClientPaymentTerms(_request: Request, response: Response): Promise<Response> {
  return response.status(200).json({ success: true, terms: await getCurrentPaymentTerms() });
}

export async function acceptClientPaymentTerms(request: Request, response: Response): Promise<Response> {
  const currentUserId = userId(request);
  if (!currentUserId) return response.status(401).json({ success: false, message: "Please sign in again." });
  const parsed = acceptTermsSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, message: "Payment terms acceptance is incomplete." });
  const membership = await membershipFor(request, parsed.data.businessAccountId);
  if (!membership) return response.status(404).json({ success: false, message: "Business account access was not found." });
  const permissions = getMemberCreditPermissions(membership.role, membership.creditPermissions);
  if (!permissions.includes("makeCreditPayment")) {
    return response.status(403).json({ success: false, message: "Your account role cannot make payments for this business account." });
  }
  const currentTerms = await getCurrentPaymentTerms();
  if (parsed.data.termsVersion !== currentTerms.version) {
    return response.status(409).json({ success: false, message: "Payment terms changed. Review the latest version before continuing." });
  }

  await PaymentTermsAcceptance.findOneAndUpdate(
    { businessAccountId: membership.businessAccount, userId: currentUserId, termsVersion: currentTerms.version, paymentReference: parsed.data.paymentReference },
    { $setOnInsert: { acceptedAt: new Date(), ipAddress: request.ip || "unknown", userAgent: request.get("user-agent") || "" } },
    { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true }
  ).exec();
  return response.status(200).json({ success: true, message: "Payment terms acceptance recorded." });
}
