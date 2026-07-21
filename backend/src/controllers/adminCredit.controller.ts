import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { AuditLog } from "../models/auditLog.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { BusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { CreditLimitHistory } from "../models/creditLimitHistory.model.js";
import { maxCreditLimitMinor } from "../models/financialTypes.js";
import { appendCreditLedgerEntry, ensureCreditAccount, getCreditActivationBlockers, serializeCreditAccount } from "../services/creditAccount.service.js";
import { getCreditRestrictionState } from "../services/creditOverdue.service.js";

const approvalSchema = z.object({
  approvedCreditLimitMinor: z.number().int()
    .positive("Approved credit limit must be greater than zero.")
    .max(maxCreditLimitMinor, "Approved credit limit cannot exceed INR 1,00,000."),
  paymentTermsDays: z.union([z.literal(0), z.literal(7), z.literal(15), z.literal(30), z.literal(45)]),
  billingCycle: z.enum(["WEEKLY", "MONTHLY"]),
  validFrom: z.string().trim().optional().default(""),
  validUntil: z.string().trim().optional().default(""),
  gracePeriodDays: z.number().int().min(0).max(90),
  maxOverdueDays: z.number().int().min(0).max(365),
  creditWarningThresholdPercent: z.number().int().min(1).max(100),
  securityDepositRequiredMinor: z.number().int().min(0),
  riskCategory: z.enum(["LOW", "MEDIUM", "HIGH"]),
  internalRemarks: z.string().trim().max(2000).optional().default(""),
  reason: z.string().trim().min(5, "Provide a reason for the credit decision.").max(500)
});

const reasonSchema = z.object({ reason: z.string().trim().min(5).max(500) });

function userId(request: Request) {
  const id = (request as Request & { user?: { _id?: unknown } }).user?._id;
  return id && mongoose.Types.ObjectId.isValid(String(id)) ? new mongoose.Types.ObjectId(String(id)) : null;
}

function accountId(request: Request) {
  const id = typeof request.params.businessAccountId === "string" ? request.params.businessAccountId : "";
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

function dateOrNull(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function businessSummary(account: { _id: unknown; accountId: string; status: string; company: { companyName?: string }; kycReview?: { overallStatus?: string }; agreementStatus?: string; depositStatus?: string }) {
  return {
    id: String(account._id), accountId: account.accountId, status: account.status,
    companyName: account.company.companyName || account.accountId,
    kycStatus: account.kycReview?.overallStatus || "documents_pending",
    agreementStatus: account.agreementStatus || "not_generated",
    depositStatus: account.depositStatus || "not_required"
  };
}

async function serializeAdminCreditAccount(account: InstanceType<typeof BusinessCreditAccount>) {
  const serialized = serializeCreditAccount(account);
  const restriction = await getCreditRestrictionState({
    businessAccountId: account.businessAccountId,
    gracePeriodDays: account.gracePeriodDays,
    maxOverdueDays: account.maxOverdueDays
  });
  const availableBookingCapacityMinor = restriction.level === "ALL_BOOKINGS_BLOCKED"
    ? 0
    : restriction.level === "CREDIT_BLOCKED"
      ? serialized.availableAdvanceMinor
      : serialized.availableBookingCapacityMinor;

  return { ...serialized, availableBookingCapacityMinor, restriction };
}

export async function listAdminCreditAccounts(_request: Request, response: Response): Promise<Response> {
  const businesses = await BusinessAccount.find({ status: { $in: ["approved", "active"] } })
    .select("accountId status company.companyName kycReview.overallStatus agreementStatus depositStatus")
    .sort({ updatedAt: -1 }).lean().exec();
  const creditAccounts = await BusinessCreditAccount.find({ businessAccountId: { $in: businesses.map((account) => account._id) } }).exec();
  const byBusinessId = new Map(creditAccounts.map((account) => [String(account.businessAccountId), account]));
  return response.status(200).json({
    success: true,
    creditAccounts: await Promise.all(businesses.map(async (business) => {
      const account = byBusinessId.get(String(business._id));
      return account
        ? { ...await serializeAdminCreditAccount(account), businessAccount: businessSummary(business) }
        : {
            id: "", businessAccountId: String(business._id), status: "NOT_REQUESTED", currency: "INR",
            requestedCreditLimitMinor: 0, approvedCreditLimitMinor: 0, usedCreditMinor: 0,
            availableCreditMinor: 0, availableAdvanceMinor: 0, availableBookingCapacityMinor: 0,
            paymentTermsDays: 30, billingCycle: "MONTHLY", businessAccount: businessSummary(business)
          };
    }))
  });
}

export async function getAdminCreditAccount(request: Request, response: Response): Promise<Response> {
  const businessAccountId = accountId(request);
  if (!businessAccountId) return response.status(404).json({ success: false, message: "Business account not found." });
  const business = await BusinessAccount.findById(businessAccountId).exec();
  if (!business) return response.status(404).json({ success: false, message: "Business account not found." });
  const account = await ensureCreditAccount(businessAccountId);
  const history = await CreditLimitHistory.find({ businessAccountId }).sort({ changedAt: -1 }).limit(50).lean().exec();
  const summary = businessSummary(business);
  return response.status(200).json({
    success: true,
    creditAccount: { ...await serializeAdminCreditAccount(account), businessAccount: summary },
    businessAccount: summary,
    limitHistory: history
  });
}

export async function approveAdminCreditAccount(request: Request, response: Response): Promise<Response> {
  const currentUserId = userId(request);
  const businessAccountId = accountId(request);
  if (!currentUserId) return response.status(401).json({ success: false, message: "Please sign in again." });
  if (!businessAccountId) return response.status(404).json({ success: false, message: "Business account not found." });
  const parsed = approvalSchema.safeParse(request.body);
  if (!parsed.success) return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message || "Check the credit approval details." });
  const validFrom = dateOrNull(parsed.data.validFrom);
  const validUntil = dateOrNull(parsed.data.validUntil);
  if (parsed.data.validFrom && !validFrom) return response.status(400).json({ success: false, message: "Valid-from date is invalid." });
  if (parsed.data.validUntil && !validUntil) return response.status(400).json({ success: false, message: "Valid-until date is invalid." });
  if (validFrom && validUntil && validUntil <= validFrom) return response.status(400).json({ success: false, message: "Credit expiry must be after its start date." });
  if (parsed.data.maxOverdueDays < parsed.data.gracePeriodDays) {
    return response.status(400).json({ success: false, message: "Maximum overdue days cannot be shorter than the grace period." });
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const business = await BusinessAccount.findById(businessAccountId).session(session).exec();
      if (!business) throw new Error("BUSINESS_NOT_FOUND");
      const account = await ensureCreditAccount(businessAccountId, session);
      const previousLimitMinor = account.approvedCreditLimitMinor;
      account.status = "APPROVED";
      account.approvedCreditLimitMinor = parsed.data.approvedCreditLimitMinor;
      account.paymentTermsDays = parsed.data.paymentTermsDays;
      account.billingCycle = parsed.data.billingCycle;
      account.validFrom = validFrom;
      account.validUntil = validUntil;
      account.gracePeriodDays = parsed.data.gracePeriodDays;
      account.maxOverdueDays = parsed.data.maxOverdueDays;
      account.creditWarningThresholdPercent = parsed.data.creditWarningThresholdPercent;
      account.securityDepositRequiredMinor = parsed.data.securityDepositRequiredMinor;
      account.riskCategory = parsed.data.riskCategory;
      account.internalRemarks = parsed.data.internalRemarks;
      account.reviewedBy = currentUserId;
      account.reviewedAt = new Date();
      account.holdReason = "";
      account.version += 1;
      await account.save({ session });
      business.creditLimitStatus = "approved";
      business.updatedBy = currentUserId;
      await business.save({ session });
      if (previousLimitMinor !== account.approvedCreditLimitMinor) {
        await CreditLimitHistory.create([{
          businessAccountId, creditAccountId: account._id, previousLimitMinor,
          newLimitMinor: account.approvedCreditLimitMinor, reason: parsed.data.reason,
          changedBy: currentUserId, changedAt: new Date()
        }], { session });
      }
      await appendCreditLedgerEntry({
        account, type: previousLimitMinor ? "LIMIT_CHANGED" : "CREDIT_APPROVED",
        reference: `CREDIT-APPROVAL-${account.version}`, description: "Business credit facility approved.",
        amountMinor: account.approvedCreditLimitMinor,
        idempotencyKey: `CREDIT_APPROVAL:${String(account._id)}:${account.version}`,
        createdBy: currentUserId, metadata: { previousLimitMinor, reason: parsed.data.reason }, session
      });
      result = serializeCreditAccount(account);
    });
    return response.status(200).json({ success: true, message: "Credit facility approved. Activate it after all requirements are complete.", creditAccount: result });
  } catch (error) {
    if (error instanceof Error && error.message === "BUSINESS_NOT_FOUND") return response.status(404).json({ success: false, message: "Business account not found." });
    throw error;
  } finally { await session.endSession(); }
}

export async function activateAdminCreditAccount(request: Request, response: Response): Promise<Response> {
  const currentUserId = userId(request);
  const businessAccountId = accountId(request);
  if (!currentUserId) return response.status(401).json({ success: false, message: "Please sign in again." });
  if (!businessAccountId) return response.status(404).json({ success: false, message: "Business account not found." });
  const business = await BusinessAccount.findById(businessAccountId).exec();
  const account = await BusinessCreditAccount.findOne({ businessAccountId }).exec();
  if (!business || !account) return response.status(404).json({ success: false, message: "Credit account not found." });
  if (account.status !== "APPROVED") return response.status(409).json({ success: false, message: "Approve the credit facility before activation." });
  const blockers = getCreditActivationBlockers({
    businessStatus: business.status,
    kycStatus: business.kycReview.overallStatus,
    agreementStatus: business.agreementStatus,
    depositStatus: business.depositStatus,
    securityDepositRequiredMinor: account.securityDepositRequiredMinor,
    approvedCreditLimitMinor: account.approvedCreditLimitMinor,
    validUntil: account.validUntil
  });
  if (blockers.length) return response.status(409).json({ success: false, message: blockers[0], blockers });

  account.status = "ACTIVE";
  account.activatedBy = currentUserId;
  account.activatedAt = new Date();
  account.version += 1;
  await account.save();
  await appendCreditLedgerEntry({
    account, type: "CREDIT_ACTIVATED", reference: `CREDIT-ACTIVATION-${account.version}`,
    description: "Business credit facility activated.", idempotencyKey: `CREDIT_ACTIVATION:${String(account._id)}:${account.version}`,
    createdBy: currentUserId
  });
  await AuditLog.create({
    action: "CREDIT_ACCOUNT_ACTIVATED", entityType: "BUSINESS_CREDIT_ACCOUNT", entityId: account._id,
    performedBy: currentUserId, performedAt: new Date(), metadata: { businessAccountId }
  });
  return response.status(200).json({ success: true, message: "Credit facility activated.", creditAccount: serializeCreditAccount(account) });
}

export async function rejectAdminCreditAccount(request: Request, response: Response): Promise<Response> {
  const currentUserId = userId(request);
  const businessAccountId = accountId(request);
  const parsed = reasonSchema.safeParse(request.body);
  if (!currentUserId) return response.status(401).json({ success: false, message: "Please sign in again." });
  if (!businessAccountId) return response.status(404).json({ success: false, message: "Business account not found." });
  if (!parsed.success) return response.status(400).json({ success: false, message: "Provide a reason for rejection." });
  const account = await ensureCreditAccount(businessAccountId);
  if (!["NOT_REQUESTED", "PENDING_REVIEW", "APPROVED", "REJECTED"].includes(account.status)) {
    return response.status(409).json({ success: false, message: "This credit facility cannot be rejected in its current status." });
  }
  account.status = "REJECTED";
  account.internalRemarks = parsed.data.reason;
  account.reviewedBy = currentUserId;
  account.reviewedAt = new Date();
  account.version += 1;
  await account.save();
  await BusinessAccount.findByIdAndUpdate(businessAccountId, { creditLimitStatus: "not_approved", updatedBy: currentUserId }).exec();
  await appendCreditLedgerEntry({
    account, type: "CREDIT_REJECTED", reference: `CREDIT-REJECTION-${account.version}`,
    description: "Business credit request rejected.", idempotencyKey: `CREDIT_REJECTION:${String(account._id)}:${account.version}`,
    createdBy: currentUserId, metadata: { reason: parsed.data.reason }
  });
  return response.status(200).json({ success: true, message: "Credit request rejected.", creditAccount: serializeCreditAccount(account) });
}
