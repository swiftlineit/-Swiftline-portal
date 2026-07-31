import mongoose from "mongoose";
import { AuditLog } from "../models/auditLog.model.js";
import { BusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { CreditBillingStatement } from "../models/creditBillingStatement.model.js";
import {
  CreditPayment,
  type CreditPaymentMethod,
  type ICreditPayment
} from "../models/creditPayment.model.js";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import { CancellationFeeInvoice } from "../models/cancellationFeeInvoice.model.js";
import { appendCreditLedgerEntry } from "./creditAccount.service.js";
import { notifyBusinessFinancialMembers } from "./portalNotification.service.js";
import { dayBounds } from "../utils/dateRangeFilter.js";

export class CreditPaymentError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}

export function serializeCreditPayment(payment: ICreditPayment) {
  return {
    id: String(payment._id),
    businessAccountId: String(payment.businessAccountId),
    creditAccountId: String(payment.creditAccountId),
    requestedStatementId: payment.requestedStatementId ? String(payment.requestedStatementId) : null,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    internalReference: payment.internalReference,
    externalReference: payment.externalReference,
    notes: payment.notes,
    razorpayOrderId: payment.razorpayOrderId,
    allocations: payment.allocations.map((allocation) => ({
      statementId: String(allocation.statementId),
      amountMinor: allocation.amountMinor,
      invoiceAllocations: allocation.invoiceAllocations.map((invoice) => ({
        shipmentInvoiceId: String(invoice.shipmentInvoiceId),
        amountMinor: invoice.amountMinor
      }))
    })),
    advanceAmountMinor: payment.advanceAmountMinor,
    verifiedAt: payment.verifiedAt ?? null,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt
  };
}

type CreditPaymentRequestIdentity = {
  businessAccountId: mongoose.Types.ObjectId;
  requestedStatementId?: mongoose.Types.ObjectId | null;
  amountMinor: number;
  method: CreditPaymentMethod;
  idempotencyKey: string;
};

export function creditPaymentMatchesRequest(
  payment: Pick<ICreditPayment, "businessAccountId" | "requestedStatementId" | "amountMinor" | "method">,
  input: CreditPaymentRequestIdentity
) {
  return String(payment.businessAccountId) === String(input.businessAccountId)
    && String(payment.requestedStatementId ?? "") === String(input.requestedStatementId ?? "")
    && payment.amountMinor === input.amountMinor
    && payment.method === input.method;
}

export async function findIdempotentCreditPayment(input: CreditPaymentRequestIdentity) {
  const existing = await CreditPayment.findOne({ idempotencyKey: input.idempotencyKey }).exec();
  if (!existing) return null;

  if (!creditPaymentMatchesRequest(existing, input)) {
    throw new CreditPaymentError(409, "This payment request identifier was already used for different payment details.");
  }
  return existing;
}

export async function createCreditPayment(input: {
  businessAccountId: mongoose.Types.ObjectId;
  requestedStatementId?: mongoose.Types.ObjectId | null;
  amountMinor: number;
  method: CreditPaymentMethod;
  internalReference: string;
  idempotencyKey: string;
  externalReference?: string;
  notes?: string;
  razorpayOrderId?: string;
  submittedBy: mongoose.Types.ObjectId;
}) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new CreditPaymentError(400, "Payment amount must be greater than zero.");
  }

  const existing = await findIdempotentCreditPayment(input);
  if (existing) return { created: false as const, payment: existing };

  const externalReference = input.externalReference?.trim() ?? "";
  if (input.method !== "RAZORPAY" && !externalReference) {
    throw new CreditPaymentError(400, "An offline payment reference is required.");
  }
  if (externalReference && await CreditPayment.exists({
    businessAccountId: input.businessAccountId,
    method: input.method,
    externalReference
  })) {
    throw new CreditPaymentError(409, "This offline payment reference has already been submitted.");
  }

  const account = await BusinessCreditAccount.findOne({ businessAccountId: input.businessAccountId }).exec();
  if (!account) throw new CreditPaymentError(404, "Business credit account was not found.");

  if (input.requestedStatementId) {
    const statement = await CreditBillingStatement.exists({
      _id: input.requestedStatementId,
      businessAccountId: input.businessAccountId,
      outstandingAmountMinor: { $gt: 0 }
    });
    if (!statement) throw new CreditPaymentError(404, "The selected unpaid statement was not found.");
  }

  let payment: ICreditPayment;
  try {
    payment = await CreditPayment.create({
      businessAccountId: input.businessAccountId,
      creditAccountId: account._id,
      requestedStatementId: input.requestedStatementId ?? null,
      amountMinor: input.amountMinor,
      currency: "INR",
      method: input.method,
      status: input.method === "RAZORPAY" ? "CREATED" : "PENDING_VERIFICATION",
      internalReference: input.internalReference,
      idempotencyKey: input.idempotencyKey,
      externalReference,
      notes: input.notes ?? "",
      razorpayOrderId: input.razorpayOrderId ?? "",
      submittedBy: input.submittedBy
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const concurrentRetry = await findIdempotentCreditPayment(input);
    if (concurrentRetry) return { created: false as const, payment: concurrentRetry };
    if (externalReference && await CreditPayment.exists({
      businessAccountId: input.businessAccountId,
      method: input.method,
      externalReference
    })) {
      throw new CreditPaymentError(409, "This offline payment reference has already been submitted.");
    }
    throw error;
  }

  return { created: true as const, payment };
}

export async function findCreditPaymentByRazorpayOrderId(orderId: string) {
  return CreditPayment.findOne({ razorpayOrderId: orderId }).exec();
}

export async function markCreditPaymentProcessing(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}) {
  return CreditPayment.findOneAndUpdate(
    {
      razorpayOrderId: input.orderId,
      method: "RAZORPAY",
      status: { $in: ["CREATED", "PROCESSING"] }
    },
    {
      $set: {
        status: "PROCESSING",
        razorpayPaymentId: input.paymentId,
        razorpaySignature: input.signature
      }
    },
    { returnDocument: "after", runValidators: true }
  ).exec();
}

export async function markCreditPaymentFailed(orderId: string, reason: string) {
  return CreditPayment.findOneAndUpdate(
    { razorpayOrderId: orderId, status: { $nin: ["VERIFIED"] } },
    { $set: { status: "FAILED", failureReason: reason } },
    { returnDocument: "after", runValidators: true }
  ).exec();
}

export async function applyVerifiedCreditPayment(input: {
  paymentId: mongoose.Types.ObjectId;
  verifiedBy: mongoose.Types.ObjectId;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
}) {
  const existing = await CreditPayment.findById(input.paymentId).exec();
  if (!existing) throw new CreditPaymentError(404, "Credit payment was not found.");
  if (existing.status === "VERIFIED") return { applied: false as const, payment: existing };
  if (existing.status === "FAILED") throw new CreditPaymentError(409, "A failed payment cannot be applied.");

  const session = await mongoose.startSession();
  try {
    const result = await session.withTransaction(async () => {
      const payment = await CreditPayment.findOne({
        _id: input.paymentId,
        status: { $in: ["CREATED", "PENDING_VERIFICATION", "PROCESSING"] }
      }).session(session).exec();
      if (!payment) {
        const completed = await CreditPayment.findById(input.paymentId).session(session).exec();
        if (completed?.status === "VERIFIED") return { applied: false as const, payment: completed };
        throw new CreditPaymentError(409, "Payment status changed before verification.");
      }

      const account = await BusinessCreditAccount.findOne({
        _id: payment.creditAccountId,
        businessAccountId: payment.businessAccountId
      }).session(session).exec();
      if (!account) throw new CreditPaymentError(404, "Business credit account was not found.");

      const statements = await CreditBillingStatement.find({
        businessAccountId: payment.businessAccountId,
        outstandingAmountMinor: { $gt: 0 },
        status: { $in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] }
      }).sort({ dueAt: 1, issuedAt: 1, _id: 1 }).session(session).exec();

      let remainingMinor = payment.amountMinor;
      let appliedMinor = 0;
      const allocations: ICreditPayment["allocations"] = [];

      for (const statement of statements) {
        if (remainingMinor <= 0) break;
        const invoiceIds: mongoose.Types.ObjectId[] = [
          ...statement.lines.flatMap((line) => line.shipmentInvoiceId ? [line.shipmentInvoiceId] : []),
          ...statement.adjustments
            .filter((adjustment) => adjustment.affectsAmountDue && adjustment.amountMinor > 0)
            .flatMap((adjustment) => adjustment.shipmentInvoiceId ? [adjustment.shipmentInvoiceId] : [])
        ];
        const invoices = await ShipmentInvoice.find({
          _id: { $in: invoiceIds },
          businessAccountId: payment.businessAccountId,
          creditOutstandingMinor: { $gt: 0 },
          paymentStatus: { $ne: "VOID" }
        }).sort({ issuedAt: 1, _id: 1 }).session(session).exec();
        const feeInvoices = await CancellationFeeInvoice.find({
          billingStatementId: statement._id,
          businessAccountId: payment.businessAccountId,
          creditOutstandingMinor: { $gt: 0 }
        }).sort({ issuedAt: 1, _id: 1 }).session(session).exec();

        const availableMinor = Math.min(
          statement.outstandingAmountMinor,
          invoices.reduce((total, invoice) => total + invoice.creditOutstandingMinor, 0)
            + feeInvoices.reduce((total, invoice) => total + invoice.creditOutstandingMinor, 0)
        );
        const statementPaymentMinor = Math.min(remainingMinor, availableMinor);
        if (statementPaymentMinor <= 0) continue;

        let statementRemainingMinor = statementPaymentMinor;
        const invoiceAllocations: ICreditPayment["allocations"][number]["invoiceAllocations"] = [];
        for (const invoice of invoices) {
          if (statementRemainingMinor <= 0) break;
          const invoicePaymentMinor = Math.min(statementRemainingMinor, invoice.creditOutstandingMinor);
          const creditOutstandingMinor = invoice.creditOutstandingMinor - invoicePaymentMinor;
          const updatedInvoice = await ShipmentInvoice.findOneAndUpdate(
            {
              _id: invoice._id,
              businessAccountId: payment.businessAccountId,
              creditOutstandingMinor: invoice.creditOutstandingMinor,
              paymentStatus: { $ne: "VOID" }
            },
            {
              $set: {
                creditOutstandingMinor,
                paymentStatus: creditOutstandingMinor === 0 ? "PAID" : "PARTIALLY_PAID"
              }
            },
            { returnDocument: "after", runValidators: true, session }
          ).exec();
          if (!updatedInvoice) {
            throw new CreditPaymentError(409, "Shipment invoice balances changed during payment allocation.");
          }
          invoiceAllocations.push({
            sourceType: "SHIPMENT_INVOICE",
            shipmentInvoiceId: invoice._id,
            cancellationFeeInvoiceId: null,
            amountMinor: invoicePaymentMinor
          });
          statementRemainingMinor -= invoicePaymentMinor;
        }
        for (const invoice of feeInvoices) {
          if (statementRemainingMinor <= 0) break;
          const invoicePaymentMinor = Math.min(statementRemainingMinor, invoice.creditOutstandingMinor);
          const creditOutstandingMinor = invoice.creditOutstandingMinor - invoicePaymentMinor;
          const updatedInvoice = await CancellationFeeInvoice.findOneAndUpdate(
            {
              _id: invoice._id,
              businessAccountId: payment.businessAccountId,
              creditOutstandingMinor: invoice.creditOutstandingMinor
            },
            {
              $set: {
                creditOutstandingMinor,
                paymentStatus: creditOutstandingMinor === 0 ? "PAID" : "PARTIALLY_PAID"
              }
            },
            { returnDocument: "after", runValidators: true, session }
          ).exec();
          if (!updatedInvoice) {
            throw new CreditPaymentError(409, "Cancellation fee invoice balances changed during payment allocation.");
          }
          invoiceAllocations.push({
            sourceType: "CANCELLATION_FEE_INVOICE",
            shipmentInvoiceId: null,
            cancellationFeeInvoiceId: invoice._id,
            amountMinor: invoicePaymentMinor
          });
          statementRemainingMinor -= invoicePaymentMinor;
        }
        if (statementRemainingMinor !== 0) {
          throw new CreditPaymentError(409, "Statement invoice balances changed during payment allocation.");
        }

        statement.paidAmountMinor += statementPaymentMinor;
        statement.outstandingAmountMinor -= statementPaymentMinor;
        statement.status = statement.outstandingAmountMinor === 0 ? "PAID" : "PARTIALLY_PAID";
        await statement.save({ session });

        allocations.push({
          statementId: statement._id,
          amountMinor: statementPaymentMinor,
          invoiceAllocations
        });
        remainingMinor -= statementPaymentMinor;
        appliedMinor += statementPaymentMinor;
      }

      const updatedAccount = await BusinessCreditAccount.findOneAndUpdate(
        {
          _id: account._id,
          version: account.version,
          invoicedOutstandingMinor: { $gte: appliedMinor }
        },
        {
          $inc: {
            invoicedOutstandingMinor: -appliedMinor,
            customerAdvanceBalanceMinor: remainingMinor,
            version: 1
          }
        },
        { returnDocument: "after", runValidators: true, session }
      ).exec();
      if (!updatedAccount) {
        throw new CreditPaymentError(409, "Credit balances changed during payment allocation. Try again.");
      }

      payment.status = "VERIFIED";
      payment.allocations = allocations;
      payment.advanceAmountMinor = remainingMinor;
      payment.verifiedBy = input.verifiedBy;
      payment.verifiedAt = new Date();
      payment.razorpayPaymentId = input.razorpayPaymentId ?? payment.razorpayPaymentId;
      payment.razorpaySignature = input.razorpaySignature ?? payment.razorpaySignature;
      payment.failureReason = "";
      await payment.save({ session });

      if (appliedMinor > 0) {
        await appendCreditLedgerEntry({
          account: updatedAccount,
          type: "STATEMENT_PAYMENT_APPLIED",
          reference: payment.internalReference,
          description: "Payment allocated to outstanding credit statements.",
          amountMinor: appliedMinor,
          idempotencyKey: `CREDIT_PAYMENT_APPLIED:${String(payment._id)}`,
          createdBy: input.verifiedBy,
          metadata: { paymentId: payment._id, allocations },
          session
        });
      }
      if (remainingMinor > 0) {
        await appendCreditLedgerEntry({
          account: updatedAccount,
          type: "EXCESS_PAYMENT_TO_ADVANCE",
          reference: payment.internalReference,
          description: "Excess statement payment credited to Customer Advance.",
          amountMinor: remainingMinor,
          idempotencyKey: `CREDIT_PAYMENT_ADVANCE:${String(payment._id)}`,
          createdBy: input.verifiedBy,
          metadata: { paymentId: payment._id },
          session
        });
      }

      await AuditLog.create([{
        action: "CREDIT_PAYMENT_VERIFIED",
        entityType: "CREDIT_PAYMENT",
        entityId: payment._id,
        performedBy: input.verifiedBy,
        performedAt: payment.verifiedAt,
        metadata: {
          businessAccountId: payment.businessAccountId,
          amountMinor: payment.amountMinor,
          appliedMinor,
          advanceAmountMinor: remainingMinor,
          method: payment.method
        }
      }], { session });

      await notifyBusinessFinancialMembers(payment.businessAccountId, {
        type: "PAYMENT_CONFIRMED",
        title: "Payment confirmed",
        message: `${payment.internalReference} has been verified and applied to your credit account.`,
        href: "/client/credit/statements",
        idempotencyKey: `PAYMENT_CONFIRMED:${String(payment._id)}`,
        metadata: { paymentId: payment._id, amountMinor: payment.amountMinor }
      }, session);

      return { applied: true as const, payment };
    });

    if (!result) throw new CreditPaymentError(500, "Payment verification did not complete.");
    return result;
  } finally {
    await session.endSession();
  }
}

export type CreditPaymentListFilter = {
  status?: string;
  date?: string;
  page?: number;
  limit?: number;
};

export async function listCreditPayments(
  businessAccountId: mongoose.Types.ObjectId,
  filter: CreditPaymentListFilter = {}
) {
  const query: Record<string, unknown> = { businessAccountId };
  if (filter.status) query.status = filter.status;
  const bounds = dayBounds(filter.date);
  if (bounds) query.createdAt = { $gte: bounds.start, $lte: bounds.end };

  const limit = Math.min(100, Math.max(1, filter.limit ?? 100));
  const total = await CreditPayment.countDocuments(query).exec();
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(Math.max(1, filter.page ?? 1), totalPages);
  const payments = await CreditPayment.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .exec();
  return { payments: payments.map(serializeCreditPayment), pagination: { page, limit, total, totalPages } };
}
