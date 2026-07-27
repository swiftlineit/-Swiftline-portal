import mongoose from "mongoose";
import { BusinessCreditAccount, type IBusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { CreditLedgerEntry, type CreditLedgerEntryType } from "../models/creditLedgerEntry.model.js";
import { maxCreditLimitMinor } from "../models/financialTypes.js";
import type { BusinessAccountMemberRole, CreditPermission } from "../models/businessAccountMember.model.js";
import { PaymentTermsDocument } from "../models/paymentTerms.model.js";
import { notifyBusinessFinancialMembers } from "./portalNotification.service.js";

const roleCreditPermissions: Record<BusinessAccountMemberRole, CreditPermission[]> = {
  account_owner: ["requestCredit", "useCreditPayment", "viewCreditBalance", "viewCreditDetails", "makeCreditPayment"],
  account_admin: ["requestCredit", "useCreditPayment", "viewCreditBalance", "viewCreditDetails", "makeCreditPayment"],
  finance: ["requestCredit", "useCreditPayment", "viewCreditBalance", "viewCreditDetails", "makeCreditPayment"],
  operations: ["useCreditPayment"],
  tracking_only: []
};

export const fallbackPaymentTerms = {
  version: "2026-07-v1",
  title: "Swiftline Credit Account Payment Terms",
  effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
  sections: [
    { heading: "Credit account payments", content: "Payments are allocated to the oldest unpaid Swiftline invoices first. Any remaining amount is held as Customer Advance for future eligible shipment charges." },
    { heading: "Customer Advance", content: "Customer Advance is money received from the customer. It does not increase the approved credit limit and is used before approved credit for future bookings." },
    { heading: "Shipment charges", content: "Shipment reservations use the server-calculated GST-inclusive estimate. The final charge may change after approved amendments or operational weight and dimension verification." },
    { heading: "Invoices and statements", content: "Each finalized shipment receives its own GST tax invoice. Credit billing statements group unpaid shipment invoices and do not apply GST again." },
    { heading: "Account restrictions", content: "New credit-funded bookings may be restricted when available credit is insufficient, invoices are overdue, or the credit facility is held, suspended, expired, or closed." },
    { heading: "Assistance", content: "Contact your assigned Swiftline branch before paying if an account, invoice, or allocation detail appears incorrect." }
  ]
};

export function getMemberCreditPermissions(role: BusinessAccountMemberRole, explicitPermissions?: CreditPermission[]) {
  return explicitPermissions?.length ? [...new Set(explicitPermissions)] : [...roleCreditPermissions[role]];
}

export function canAccessCreditFinancials(role: BusinessAccountMemberRole) {
  return role === "account_owner" || role === "account_admin" || role === "finance";
}

export function canCloseClientBillingCycle(role: BusinessAccountMemberRole) {
  return role === "finance";
}

export function getCreditActivationBlockers(input: {
  businessStatus: string;
  kycStatus?: string;
  agreementStatus?: string;
  depositStatus?: string;
  securityDepositRequiredMinor: number;
  approvedCreditLimitMinor: number;
  validUntil?: Date | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return [
    !["approved", "active"].includes(input.businessStatus) ? "Business account must be approved or active." : "",
    input.kycStatus !== "verified" ? "KYC must be verified." : "",
    input.agreementStatus !== "signed" ? "Credit agreement must be signed." : "",
    input.securityDepositRequiredMinor > 0 && input.depositStatus !== "received" ? "Required security deposit must be received." : "",
    input.approvedCreditLimitMinor <= 0 ? "Approved credit limit must be greater than zero." : "",
    input.approvedCreditLimitMinor > maxCreditLimitMinor ? "Approved credit limit cannot exceed INR 1,00,000." : "",
    input.validUntil && input.validUntil <= now ? "Credit validity has already expired." : ""
  ].filter((blocker): blocker is string => Boolean(blocker));
}

// Approved credit is only spendable while the facility is ACTIVE and inside its
// validity window. Keeping this in one place ensures every API response, admin
// view, and the booking guard agree on what is actually available.
export function isCreditWindowOpen(
  account: Pick<IBusinessCreditAccount, "status" | "validFrom" | "validUntil">,
  now: Date = new Date()
) {
  if (account.status !== "ACTIVE") return false;
  if (account.validFrom && account.validFrom > now) return false;
  if (account.validUntil && account.validUntil <= now) return false;
  return true;
}

export function getCreditBalances(
  account: Pick<IBusinessCreditAccount,
    "approvedCreditLimitMinor" | "reservedCreditMinor" | "unbilledCreditMinor" |
    "invoicedOutstandingMinor" | "customerAdvanceBalanceMinor" | "reservedAdvanceMinor" |
    "status" | "validFrom" | "validUntil"
  >,
  now: Date = new Date()
) {
  const usedCreditMinor = account.reservedCreditMinor + account.unbilledCreditMinor + account.invoicedOutstandingMinor;
  const availableCreditMinor = isCreditWindowOpen(account, now)
    ? Math.max(account.approvedCreditLimitMinor - usedCreditMinor, 0)
    : 0;
  const availableAdvanceMinor = Math.max(account.customerAdvanceBalanceMinor - account.reservedAdvanceMinor, 0);

  return {
    usedCreditMinor,
    availableCreditMinor,
    availableAdvanceMinor,
    availableBookingCapacityMinor: availableAdvanceMinor + availableCreditMinor
  };
}

// Share of the approved limit that is committed (reserved + unbilled + invoiced),
// and whether that share has crossed the configured warning threshold.
export function getCreditUtilization(account: Pick<IBusinessCreditAccount,
  "approvedCreditLimitMinor" | "reservedCreditMinor" | "unbilledCreditMinor" |
  "invoicedOutstandingMinor" | "customerAdvanceBalanceMinor" | "reservedAdvanceMinor" |
  "status" | "validFrom" | "validUntil" | "creditWarningThresholdPercent"
>, now: Date = new Date()) {
  const { usedCreditMinor } = getCreditBalances(account, now);
  const utilizationPercent = account.approvedCreditLimitMinor > 0
    ? Math.round((usedCreditMinor / account.approvedCreditLimitMinor) * 100)
    : 0;
  const warningActive = isCreditWindowOpen(account, now)
    && account.approvedCreditLimitMinor > 0
    && utilizationPercent >= account.creditWarningThresholdPercent;

  return { utilizationPercent, warningActive };
}

export function serializeCreditAccount(account: IBusinessCreditAccount) {
  return {
    id: String(account._id),
    businessAccountId: String(account.businessAccountId),
    status: account.status,
    ...getCreditUtilization(account),
    currency: account.currency,
    requestedCreditLimitMinor: account.requestedCreditLimitMinor,
    requestReason: account.requestReason,
    requestedAt: account.requestedAt ?? null,
    approvedCreditLimitMinor: account.approvedCreditLimitMinor,
    reservedCreditMinor: account.reservedCreditMinor,
    unbilledCreditMinor: account.unbilledCreditMinor,
    invoicedOutstandingMinor: account.invoicedOutstandingMinor,
    customerAdvanceBalanceMinor: account.customerAdvanceBalanceMinor,
    reservedAdvanceMinor: account.reservedAdvanceMinor,
    ...getCreditBalances(account),
    paymentTermsDays: account.paymentTermsDays,
    billingCycle: account.billingCycle,
    validFrom: account.validFrom ?? null,
    validUntil: account.validUntil ?? null,
    gracePeriodDays: account.gracePeriodDays,
    maxOverdueDays: account.maxOverdueDays,
    creditWarningThresholdPercent: account.creditWarningThresholdPercent,
    securityDepositRequiredMinor: account.securityDepositRequiredMinor,
    riskCategory: account.riskCategory,
    internalRemarks: account.internalRemarks,
    holdReason: account.holdReason,
    reviewedAt: account.reviewedAt ?? null,
    activatedAt: account.activatedAt ?? null,
    version: account.version,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  };
}

export async function ensureCreditAccount(businessAccountId: mongoose.Types.ObjectId, session?: mongoose.ClientSession) {
  return BusinessCreditAccount.findOneAndUpdate(
    { businessAccountId },
    { $setOnInsert: { businessAccountId } },
    { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true, session }
  ).exec();
}

export async function appendCreditLedgerEntry(input: {
  account: IBusinessCreditAccount;
  type: CreditLedgerEntryType;
  reference: string;
  description: string;
  amountMinor?: number;
  idempotencyKey: string;
  createdBy: mongoose.Types.ObjectId | null;
  metadata?: Record<string, unknown>;
  session?: mongoose.ClientSession;
}) {
  const balances = getCreditBalances(input.account);
  const documents = await CreditLedgerEntry.create([{
    businessAccountId: input.account.businessAccountId,
    creditAccountId: input.account._id,
    type: input.type,
    reference: input.reference,
    description: input.description,
    amountMinor: input.amountMinor ?? 0,
    currency: input.account.currency,
    availableCreditAfterMinor: balances.availableCreditMinor,
    availableAdvanceAfterMinor: balances.availableAdvanceMinor,
    idempotencyKey: input.idempotencyKey,
    createdBy: input.createdBy,
    metadata: input.metadata ?? {}
  }], { session: input.session });
  return documents[0];
}

// Mark every active facility whose validity window has closed as EXPIRED. The
// available-credit math already treats a lapsed window as zero (isCreditWindowOpen);
// this makes the status explicit and blocks new bookings via the status guard.
export async function expireLapsedCreditAccounts(now = new Date()) {
  const result = await BusinessCreditAccount.updateMany(
    { status: "ACTIVE", validUntil: { $ne: null, $lt: now } },
    { $set: { status: "EXPIRED" }, $inc: { version: 1 } }
  ).exec();

  return { expired: result.modifiedCount };
}

// Notify finance members whose credit utilization has crossed the warning
// threshold. Keyed per day so an over-threshold account is nudged once daily
// rather than on every job run.
export async function notifyCreditUtilizationWarnings(now = new Date()) {
  const accounts = await BusinessCreditAccount.find({ status: "ACTIVE", approvedCreditLimitMinor: { $gt: 0 } }).exec();
  const dayKey = now.toISOString().slice(0, 10);
  let notified = 0;

  for (const account of accounts) {
    const { utilizationPercent, warningActive } = getCreditUtilization(account, now);
    if (!warningActive) continue;

    try {
      await notifyBusinessFinancialMembers(account.businessAccountId, {
        type: "CREDIT_UTILIZATION_WARNING",
        title: "Credit utilization is high",
        message: `Your credit facility is ${utilizationPercent}% used, at or above the ${account.creditWarningThresholdPercent}% warning level.`,
        href: "/client/credit",
        idempotencyKey: `CREDIT_WARNING:${String(account._id)}:${dayKey}`,
        metadata: { utilizationPercent, thresholdPercent: account.creditWarningThresholdPercent }
      });
      notified += 1;
    } catch (error) {
      console.error("Failed to send credit utilization warning", String(account._id), error);
    }
  }

  return { notified };
}

export async function getCurrentPaymentTerms() {
  const document = await PaymentTermsDocument.findOne({
    status: "PUBLISHED",
    effectiveFrom: { $lte: new Date() }
  }).sort({ effectiveFrom: -1 }).lean().exec();

  return document ? {
    version: document.version,
    title: document.title,
    effectiveFrom: document.effectiveFrom,
    sections: document.sections
  } : fallbackPaymentTerms;
}
