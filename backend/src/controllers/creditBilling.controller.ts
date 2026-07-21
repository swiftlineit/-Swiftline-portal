import type { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { env } from "../config/env.js";
import { AuditLog } from "../models/auditLog.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { BusinessAccountMember } from "../models/businessAccountMember.model.js";
import { CreditLedgerEntry } from "../models/creditLedgerEntry.model.js";
import { CreditPayment } from "../models/creditPayment.model.js";
import { PaymentTermsAcceptance } from "../models/paymentTerms.model.js";
import {
  closeCreditBillingCycle,
  CreditBillingCycleError,
  getCreditBillingStatement,
  listCreditBillingStatements,
  serializeCreditBillingStatement
} from "../services/creditBillingCycle.service.js";
import { createCreditBillingStatementPdf } from "../services/creditBillingStatementPdf.service.js";
import {
  applyVerifiedCreditPayment,
  createCreditPayment,
  CreditPaymentError,
  findIdempotentCreditPayment,
  listCreditPayments,
  markCreditPaymentProcessing,
  serializeCreditPayment
} from "../services/creditPayment.service.js";
import { createRazorpayOrder, fetchRazorpayPayment, captureRazorpayPayment, getRazorpayPublicConfig } from "../services/razorpay/client.js";
import { verifyRazorpayCheckoutSignature } from "../services/razorpay/signatures.js";
import { notifyActiveAdmins } from "../services/portalNotification.service.js";
import {
  canAccessCreditFinancials,
  canCloseClientBillingCycle,
  getCurrentPaymentTerms
} from "../services/creditAccount.service.js";

const offlinePaymentSchema = z.object({
  amountMinor: z.number().int().positive("Payment amount must be greater than zero."),
  method: z.enum(["BANK_TRANSFER", "UPI", "CASH", "CHEQUE"]),
  externalReference: z.string().trim().min(3, "Enter the offline payment reference.").max(160),
  notes: z.string().trim().max(500).optional().default(""),
  requestedStatementId: z.string().trim().optional().default("")
});

const onlinePaymentSchema = z.object({
  amountMinor: z.number().int().positive("Payment amount must be greater than zero."),
  requestedStatementId: z.string().trim().min(1)
});

const checkoutVerificationSchema = z.object({
  razorpay_order_id: z.string().trim().min(1),
  razorpay_payment_id: z.string().trim().min(1),
  razorpay_signature: z.string().trim().min(1)
});

function userId(request: Request) {
  const id = (request as Request & { user?: { _id?: unknown } }).user?._id;
  return id && mongoose.Types.ObjectId.isValid(String(id)) ? new mongoose.Types.ObjectId(String(id)) : null;
}

function objectId(value: unknown) {
  return typeof value === "string" && mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
}

function adminBusinessAccountId(request: Request) {
  return objectId(request.params.businessAccountId);
}

function clientBusinessAccountId(request: Request) {
  return objectId(request.query.businessAccountId ?? request.body?.businessAccountId);
}

async function financialMembership(request: Request, businessAccountId: mongoose.Types.ObjectId) {
  const currentUserId = userId(request);
  if (!currentUserId) return null;
  const membership = await BusinessAccountMember.findOne({
    user: currentUserId,
    businessAccount: businessAccountId,
    status: "active"
  }).exec();
  return membership && canAccessCreditFinancials(membership.role) ? membership : null;
}

async function hasAcceptedCurrentTerms(
  businessAccountId: mongoose.Types.ObjectId,
  currentUserId: mongoose.Types.ObjectId
) {
  const terms = await getCurrentPaymentTerms();
  return PaymentTermsAcceptance.exists({
    businessAccountId,
    userId: currentUserId,
    termsVersion: terms.version
  });
}

async function businessCustomer(businessAccountId: mongoose.Types.ObjectId) {
  const business = await BusinessAccount.findById(businessAccountId)
    .select("accountId company.companyName")
    .lean()
    .exec();
  if (!business) throw new CreditBillingCycleError(404, "Business account was not found.");
  return { accountId: business.accountId, companyName: business.company.companyName || business.accountId };
}

function streamStatementPdf(
  response: Response,
  statement: ReturnType<typeof serializeCreditBillingStatement>,
  customer: { accountId: string; companyName: string },
  download: boolean
) {
  const filename = `${statement.statementNumber.replaceAll("/", "-")}.pdf`;
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);
  const document = createCreditBillingStatementPdf({ statement, customer });
  document.pipe(response);
  document.end();
}

async function writeStatementDownloadAudit(
  statementId: mongoose.Types.ObjectId,
  performedBy: mongoose.Types.ObjectId,
  businessAccountId: mongoose.Types.ObjectId
) {
  await AuditLog.create({
    action: "CREDIT_BILLING_STATEMENT_DOWNLOADED",
    entityType: "CREDIT_BILLING_STATEMENT",
    entityId: statementId,
    performedBy,
    performedAt: new Date(),
    metadata: { businessAccountId }
  });
}

export async function listAdminStatements(request: Request, response: Response): Promise<Response> {
  const businessAccountId = adminBusinessAccountId(request);
  if (!businessAccountId) return response.status(400).json({ success: false, message: "Business account is invalid." });
  return response.status(200).json({ success: true, statements: await listCreditBillingStatements(businessAccountId) });
}

export async function getAdminStatement(request: Request, response: Response): Promise<Response> {
  const businessAccountId = adminBusinessAccountId(request);
  const statementId = objectId(request.params.statementId);
  if (!businessAccountId || !statementId) return response.status(400).json({ success: false, message: "Statement is invalid." });
  const statement = await getCreditBillingStatement(businessAccountId, statementId);
  return response.status(200).json({ success: true, statement: serializeCreditBillingStatement(statement) });
}

export async function downloadAdminStatement(request: Request, response: Response): Promise<void | Response> {
  const currentUserId = userId(request);
  const businessAccountId = adminBusinessAccountId(request);
  const statementId = objectId(request.params.statementId);
  if (!currentUserId) return response.status(401).json({ success: false, message: "Please sign in again." });
  if (!businessAccountId || !statementId) return response.status(400).json({ success: false, message: "Statement is invalid." });
  const statement = await getCreditBillingStatement(businessAccountId, statementId);
  await writeStatementDownloadAudit(statementId, currentUserId, businessAccountId);
  streamStatementPdf(response, serializeCreditBillingStatement(statement), await businessCustomer(businessAccountId), request.query.download === "1");
}

export async function closeAdminBillingCycle(request: Request, response: Response): Promise<Response> {
  const currentUserId = userId(request);
  const businessAccountId = adminBusinessAccountId(request);
  if (!currentUserId) return response.status(401).json({ success: false, message: "Please sign in again." });
  if (!businessAccountId) return response.status(400).json({ success: false, message: "Business account is invalid." });
  const result = await closeCreditBillingCycle({ businessAccountId, createdBy: currentUserId });
  const message = result.empty
    ? "No finalized unbilled shipment invoices were found for the completed billing period."
    : result.created ? "Credit billing statement generated." : "This billing period has already been closed.";
  return response.status(result.created ? 201 : 200).json({ success: true, message, ...result });
}

export async function listClientStatements(request: Request, response: Response): Promise<Response> {
  const businessAccountId = clientBusinessAccountId(request);
  if (!businessAccountId || !await financialMembership(request, businessAccountId)) {
    return response.status(403).json({ success: false, message: "Financial statement access is not available for this account." });
  }
  return response.status(200).json({ success: true, statements: await listCreditBillingStatements(businessAccountId) });
}

export async function getClientStatement(request: Request, response: Response): Promise<Response> {
  const businessAccountId = clientBusinessAccountId(request);
  const statementId = objectId(request.params.statementId);
  if (!businessAccountId || !statementId || !await financialMembership(request, businessAccountId)) {
    return response.status(403).json({ success: false, message: "Financial statement access is not available for this account." });
  }
  const statement = await getCreditBillingStatement(businessAccountId, statementId);
  return response.status(200).json({ success: true, statement: serializeCreditBillingStatement(statement) });
}

export async function downloadClientStatement(request: Request, response: Response): Promise<void | Response> {
  const currentUserId = userId(request);
  const businessAccountId = clientBusinessAccountId(request);
  const statementId = objectId(request.params.statementId);
  if (!currentUserId || !businessAccountId || !statementId || !await financialMembership(request, businessAccountId)) {
    return response.status(403).json({ success: false, message: "Financial statement access is not available for this account." });
  }
  const statement = await getCreditBillingStatement(businessAccountId, statementId);
  await writeStatementDownloadAudit(statementId, currentUserId, businessAccountId);
  streamStatementPdf(response, serializeCreditBillingStatement(statement), await businessCustomer(businessAccountId), request.query.download === "1");
}

export async function closeClientBillingCycle(request: Request, response: Response): Promise<Response> {
  const currentUserId = userId(request);
  const businessAccountId = clientBusinessAccountId(request);
  if (!currentUserId || !businessAccountId) return response.status(400).json({ success: false, message: "Business account is invalid." });
  const membership = await financialMembership(request, businessAccountId);
  if (!membership || !canCloseClientBillingCycle(membership.role)) {
    return response.status(403).json({ success: false, message: "Only the Finance member can close this billing cycle." });
  }
  const result = await closeCreditBillingCycle({ businessAccountId, createdBy: currentUserId });
  const message = result.empty
    ? "No finalized unbilled shipment invoices were found for the completed billing period."
    : result.created ? "Credit billing statement generated." : "This billing period has already been closed.";
  return response.status(result.created ? 201 : 200).json({ success: true, message, ...result });
}

export async function createClientOnlinePayment(request: Request, response: Response): Promise<Response> {
  const currentUserId = userId(request);
  const businessAccountId = clientBusinessAccountId(request);
  const parsed = onlinePaymentSchema.safeParse(request.body);
  if (!currentUserId || !businessAccountId) return response.status(400).json({ success: false, message: "Business account is invalid." });
  if (!parsed.success) return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message || "Check the payment details." });
  if (!await financialMembership(request, businessAccountId)) {
    return response.status(403).json({ success: false, message: "Payment access is not available for this account." });
  }
  if (!await hasAcceptedCurrentTerms(businessAccountId, currentUserId)) {
    return response.status(409).json({ success: false, message: "Read and accept the current payment terms before paying this statement." });
  }
  const statementId = objectId(parsed.data.requestedStatementId);
  if (!statementId) return response.status(400).json({ success: false, message: "Statement is invalid." });
  const idempotencyKey = request.header("Idempotency-Key")?.trim() || "";
  if (!idempotencyKey) return response.status(400).json({ success: false, message: "Payment request identifier is required." });

  const existing = await findIdempotentCreditPayment({
    businessAccountId,
    requestedStatementId: statementId,
    amountMinor: parsed.data.amountMinor,
    method: "RAZORPAY",
    idempotencyKey
  });
  if (existing) {
    return response.status(200).json({
      success: true,
      duplicate: true,
      razorpay: getRazorpayPublicConfig(),
      payment: serializeCreditPayment(existing)
    });
  }

  const internalReference = `CREDIT-PAY-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const order = await createRazorpayOrder({
    amountMinor: parsed.data.amountMinor,
    currency: "INR",
    receipt: internalReference,
    notes: { businessAccountId: String(businessAccountId), statementId: String(statementId) }
  });
  const result = await createCreditPayment({
    businessAccountId,
    requestedStatementId: statementId,
    amountMinor: parsed.data.amountMinor,
    method: "RAZORPAY",
    internalReference,
    idempotencyKey,
    razorpayOrderId: order.id,
    submittedBy: currentUserId
  });
  return response.status(201).json({
    success: true,
    duplicate: !result.created,
    razorpay: getRazorpayPublicConfig(),
    payment: serializeCreditPayment(result.payment)
  });
}

export async function verifyClientOnlinePayment(request: Request, response: Response): Promise<Response> {
  const currentUserId = userId(request);
  const parsed = checkoutVerificationSchema.safeParse(request.body);
  if (!currentUserId) return response.status(401).json({ success: false, message: "Please sign in again." });
  if (!parsed.success) return response.status(400).json({ success: false, message: "Razorpay payment confirmation is incomplete." });
  if (!env.RAZORPAY_KEY_SECRET) return response.status(500).json({ success: false, message: "Razorpay credentials are not configured." });

  const payment = await CreditPayment.findOne({ razorpayOrderId: parsed.data.razorpay_order_id }).exec();
  if (!payment || !await financialMembership(request, payment.businessAccountId)) {
    return response.status(404).json({ success: false, message: "Credit payment was not found." });
  }
  if (!verifyRazorpayCheckoutSignature({
    orderId: parsed.data.razorpay_order_id,
    paymentId: parsed.data.razorpay_payment_id,
    signature: parsed.data.razorpay_signature,
    secret: env.RAZORPAY_KEY_SECRET
  })) {
    return response.status(400).json({ success: false, message: "Razorpay payment signature is invalid." });
  }

  await markCreditPaymentProcessing({
    orderId: parsed.data.razorpay_order_id,
    paymentId: parsed.data.razorpay_payment_id,
    signature: parsed.data.razorpay_signature
  });
  let providerPayment = await fetchRazorpayPayment(parsed.data.razorpay_payment_id);
  if (providerPayment.order_id !== payment.razorpayOrderId || providerPayment.amount !== payment.amountMinor || providerPayment.currency !== "INR") {
    return response.status(409).json({ success: false, message: "Razorpay payment details do not match this statement payment." });
  }
  if (providerPayment.status === "authorized") {
    providerPayment = await captureRazorpayPayment({
      paymentId: providerPayment.id,
      amountMinor: payment.amountMinor,
      currency: "INR"
    });
  }
  if (providerPayment.status !== "captured") {
    return response.status(202).json({ success: true, message: "Payment is still processing. Refresh the statement shortly.", payment: serializeCreditPayment(payment) });
  }

  const result = await applyVerifiedCreditPayment({
    paymentId: payment._id,
    verifiedBy: currentUserId,
    razorpayPaymentId: providerPayment.id,
    razorpaySignature: parsed.data.razorpay_signature
  });
  return response.status(200).json({
    success: true,
    message: result.applied ? "Payment confirmed and applied successfully." : "Payment was already applied.",
    payment: serializeCreditPayment(result.payment)
  });
}

export async function submitClientOfflinePayment(request: Request, response: Response): Promise<Response> {
  const currentUserId = userId(request);
  const businessAccountId = clientBusinessAccountId(request);
  const parsed = offlinePaymentSchema.safeParse(request.body);
  if (!currentUserId || !businessAccountId) return response.status(400).json({ success: false, message: "Business account is invalid." });
  if (!parsed.success) return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message || "Check the payment details." });
  if (!await financialMembership(request, businessAccountId)) {
    return response.status(403).json({ success: false, message: "Payment access is not available for this account." });
  }
  if (!await hasAcceptedCurrentTerms(businessAccountId, currentUserId)) {
    return response.status(409).json({ success: false, message: "Read and accept the current payment terms before submitting an offline payment." });
  }
  const statementId = objectId(parsed.data.requestedStatementId);
  const idempotencyKey = request.header("Idempotency-Key")?.trim() || "";
  if (!idempotencyKey) return response.status(400).json({ success: false, message: "Payment request identifier is required." });

  const result = await createCreditPayment({
    businessAccountId,
    requestedStatementId: statementId,
    amountMinor: parsed.data.amountMinor,
    method: parsed.data.method,
    internalReference: `OFFLINE-PAY-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    idempotencyKey,
    externalReference: parsed.data.externalReference,
    notes: parsed.data.notes,
    submittedBy: currentUserId
  });
  if (result.created) {
    await AuditLog.create({
      action: "CREDIT_PAYMENT_SUBMITTED",
      entityType: "CREDIT_PAYMENT",
      entityId: result.payment._id,
      performedBy: currentUserId,
      performedAt: new Date(),
      metadata: { businessAccountId, amountMinor: result.payment.amountMinor, method: result.payment.method }
    });
    await notifyActiveAdmins({
      type: "OFFLINE_PAYMENT_SUBMITTED",
      title: "Offline credit payment submitted",
      message: `${result.payment.internalReference} requires payment verification.`,
      href: `/dashboard/credit-accounts/${String(businessAccountId)}`,
      idempotencyKey: `OFFLINE_PAYMENT_SUBMITTED:${String(result.payment._id)}`,
      businessAccountId,
      metadata: { paymentId: result.payment._id }
    });
  }
  return response.status(result.created ? 201 : 200).json({
    success: true,
    message: result.created ? "Offline payment submitted for verification." : "This offline payment was already submitted.",
    payment: serializeCreditPayment(result.payment)
  });
}

export async function createAdminOfflinePayment(request: Request, response: Response): Promise<Response> {
  const currentUserId = userId(request);
  const businessAccountId = adminBusinessAccountId(request);
  const parsed = offlinePaymentSchema.safeParse(request.body);
  if (!currentUserId || !businessAccountId) return response.status(400).json({ success: false, message: "Business account is invalid." });
  if (!parsed.success) return response.status(400).json({ success: false, message: parsed.error.issues[0]?.message || "Check the payment details." });
  const statementId = objectId(parsed.data.requestedStatementId);
  const idempotencyKey = request.header("Idempotency-Key")?.trim() || `ADMIN-OFFLINE:${Date.now()}:${String(currentUserId)}`;
  const created = await createCreditPayment({
    businessAccountId,
    requestedStatementId: statementId,
    amountMinor: parsed.data.amountMinor,
    method: parsed.data.method,
    internalReference: `OFFLINE-PAY-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    idempotencyKey,
    externalReference: parsed.data.externalReference,
    notes: parsed.data.notes,
    submittedBy: currentUserId
  });
  const applied = await applyVerifiedCreditPayment({ paymentId: created.payment._id, verifiedBy: currentUserId });
  return response.status(created.created ? 201 : 200).json({
    success: true,
    message: applied.applied ? "Offline payment recorded and applied." : "Offline payment was already applied.",
    payment: serializeCreditPayment(applied.payment)
  });
}

export async function verifyAdminOfflinePayment(request: Request, response: Response): Promise<Response> {
  const currentUserId = userId(request);
  const businessAccountId = adminBusinessAccountId(request);
  const paymentId = objectId(request.params.paymentId);
  if (!currentUserId || !businessAccountId || !paymentId) return response.status(400).json({ success: false, message: "Payment is invalid." });
  const payment = await CreditPayment.findOne({ _id: paymentId, businessAccountId }).exec();
  if (!payment) return response.status(404).json({ success: false, message: "Payment was not found." });
  if (payment.method === "RAZORPAY") return response.status(409).json({ success: false, message: "Razorpay payments are verified automatically." });
  const result = await applyVerifiedCreditPayment({ paymentId, verifiedBy: currentUserId });
  return response.status(200).json({
    success: true,
    message: result.applied ? "Offline payment verified and applied." : "Offline payment was already applied.",
    payment: serializeCreditPayment(result.payment)
  });
}

export async function listAdminPayments(request: Request, response: Response): Promise<Response> {
  const businessAccountId = adminBusinessAccountId(request);
  if (!businessAccountId) return response.status(400).json({ success: false, message: "Business account is invalid." });
  return response.status(200).json({ success: true, payments: await listCreditPayments(businessAccountId) });
}

export async function listClientPayments(request: Request, response: Response): Promise<Response> {
  const businessAccountId = clientBusinessAccountId(request);
  if (!businessAccountId || !await financialMembership(request, businessAccountId)) {
    return response.status(403).json({ success: false, message: "Payment history access is not available for this account." });
  }
  return response.status(200).json({ success: true, payments: await listCreditPayments(businessAccountId) });
}

function serializeLedgerEntry(entry: InstanceType<typeof CreditLedgerEntry>) {
  return {
    id: String(entry._id),
    type: entry.type,
    reference: entry.reference,
    description: entry.description,
    amountMinor: entry.amountMinor,
    currency: entry.currency,
    availableCreditAfterMinor: entry.availableCreditAfterMinor,
    availableAdvanceAfterMinor: entry.availableAdvanceAfterMinor,
    createdAt: entry.createdAt
  };
}

async function ledgerEntries(businessAccountId: mongoose.Types.ObjectId) {
  return CreditLedgerEntry.find({ businessAccountId }).sort({ createdAt: -1 }).limit(500).exec();
}

export async function getAdminLedger(request: Request, response: Response): Promise<Response> {
  const businessAccountId = adminBusinessAccountId(request);
  if (!businessAccountId) return response.status(400).json({ success: false, message: "Business account is invalid." });
  return response.status(200).json({ success: true, entries: (await ledgerEntries(businessAccountId)).map(serializeLedgerEntry) });
}

export async function getClientLedger(request: Request, response: Response): Promise<Response> {
  const businessAccountId = clientBusinessAccountId(request);
  if (!businessAccountId || !await financialMembership(request, businessAccountId)) {
    return response.status(403).json({ success: false, message: "Account statement access is not available for this account." });
  }
  return response.status(200).json({ success: true, entries: (await ledgerEntries(businessAccountId)).map(serializeLedgerEntry) });
}

function csvCell(value: string | number) {
  const text = String(value).replaceAll('"', '""');
  return `"${text}"`;
}

async function exportLedger(response: Response, businessAccountId: mongoose.Types.ObjectId) {
  const entries = await ledgerEntries(businessAccountId);
  const rows = [
    ["Date", "Type", "Reference", "Description", "Amount INR", "Available Credit INR", "Customer Advance INR"],
    ...entries.map((entry) => [
      entry.createdAt.toISOString(),
      entry.type,
      entry.reference,
      entry.description,
      (entry.amountMinor / 100).toFixed(2),
      (entry.availableCreditAfterMinor / 100).toFixed(2),
      (entry.availableAdvanceAfterMinor / 100).toFixed(2)
    ])
  ];
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", 'attachment; filename="credit-account-statement.csv"');
  response.send(rows.map((row) => row.map(csvCell).join(",")).join("\r\n"));
}

export async function exportAdminLedger(request: Request, response: Response): Promise<void | Response> {
  const businessAccountId = adminBusinessAccountId(request);
  if (!businessAccountId) return response.status(400).json({ success: false, message: "Business account is invalid." });
  await exportLedger(response, businessAccountId);
}

export async function exportClientLedger(request: Request, response: Response): Promise<void | Response> {
  const businessAccountId = clientBusinessAccountId(request);
  if (!businessAccountId || !await financialMembership(request, businessAccountId)) {
    return response.status(403).json({ success: false, message: "Account statement access is not available for this account." });
  }
  await exportLedger(response, businessAccountId);
}

export function handleCreditBillingError(error: unknown, response: Response) {
  if (error instanceof CreditBillingCycleError || error instanceof CreditPaymentError) {
    return response.status(error.statusCode).json({ success: false, message: error.message });
  }
  throw error;
}
