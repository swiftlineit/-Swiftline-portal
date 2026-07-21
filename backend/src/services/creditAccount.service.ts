import mongoose from "mongoose";
import { BusinessCreditAccount, type IBusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { CreditLedgerEntry, type CreditLedgerEntryType } from "../models/creditLedgerEntry.model.js";
import { maxCreditLimitMinor } from "../models/financialTypes.js";
import type { BusinessAccountMemberRole, CreditPermission } from "../models/businessAccountMember.model.js";
import { PaymentTermsDocument } from "../models/paymentTerms.model.js";

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

export function getCreditBalances(account: Pick<IBusinessCreditAccount,
  "approvedCreditLimitMinor" | "reservedCreditMinor" | "unbilledCreditMinor" |
  "invoicedOutstandingMinor" | "customerAdvanceBalanceMinor" | "reservedAdvanceMinor" | "status"
>) {
  const usedCreditMinor = account.reservedCreditMinor + account.unbilledCreditMinor + account.invoicedOutstandingMinor;
  const availableCreditMinor = account.status === "ACTIVE"
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

export function serializeCreditAccount(account: IBusinessCreditAccount) {
  return {
    id: String(account._id),
    businessAccountId: String(account.businessAccountId),
    status: account.status,
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
  createdBy: mongoose.Types.ObjectId;
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
