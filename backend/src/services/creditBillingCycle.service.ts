import mongoose from "mongoose";
import { AuditLog } from "../models/auditLog.model.js";
import { BusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { CreditBillingStatement } from "../models/creditBillingStatement.model.js";
import { CancellationFeeInvoice } from "../models/cancellationFeeInvoice.model.js";
import { ShipmentCancellation } from "../models/shipmentCancellation.model.js";
import { CreditBillingAdjustment } from "../models/creditBillingAdjustment.model.js";
import { CreditBillingStatementCounter } from "../models/creditBillingStatementCounter.model.js";
import { ShipmentChargeVerification } from "../models/shipmentChargeVerification.model.js";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import { appendCreditLedgerEntry } from "./creditAccount.service.js";
import { notifyBusinessFinancialMembers } from "./portalNotification.service.js";
import { getCreditRestrictionState } from "./creditOverdue.service.js";
import { formatIndiaDate } from "../utils/dateFormat.js";

export type ClosedBillingPeriod = {
  start: Date;
  end: Date;
};

export type CloseCreditBillingCycleResult = {
  created: boolean;
  empty: boolean;
  statement: ReturnType<typeof serializeCreditBillingStatement> | null;
  period: ClosedBillingPeriod;
};

const INDIA_OFFSET_MINUTES = 330;
const INDIA_OFFSET_MS = INDIA_OFFSET_MINUTES * 60 * 1000;

function indiaLocalDate(value: Date) {
  return new Date(value.getTime() + INDIA_OFFSET_MS);
}

function indiaMidnightUtc(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day) - INDIA_OFFSET_MS);
}

export function getPreviousClosedBillingPeriod(
  billingCycle: "WEEKLY" | "MONTHLY",
  closingDate = new Date()
): ClosedBillingPeriod {
  const localClosingDate = indiaLocalDate(closingDate);
  if (billingCycle === "MONTHLY") {
    const year = localClosingDate.getUTCFullYear();
    const month = localClosingDate.getUTCMonth();
    const end = indiaMidnightUtc(year, month, 1);
    const start = indiaMidnightUtc(year, month - 1, 1);
    return { start, end };
  }

  const daysSinceMonday = (localClosingDate.getUTCDay() + 6) % 7;
  const end = indiaMidnightUtc(
    localClosingDate.getUTCFullYear(),
    localClosingDate.getUTCMonth(),
    localClosingDate.getUTCDate() - daysSinceMonday
  );
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  return { start, end };
}

export function calculateCreditStatementDueAt(issuedAt: Date, paymentTermsDays: number) {
  if (!Number.isInteger(paymentTermsDays) || ![0, 7, 15, 30, 45].includes(paymentTermsDays)) {
    throw new Error("Unsupported credit payment terms.");
  }
  const dueAt = new Date(issuedAt);
  dueAt.setUTCDate(dueAt.getUTCDate() + paymentTermsDays);
  return dueAt;
}

export class CreditBillingCycleError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

function getFinancialYear(date: Date) {
  const indiaDate = indiaLocalDate(date);
  const year = indiaDate.getUTCFullYear();
  const startYear = indiaDate.getUTCMonth() >= 3 ? year : year - 1;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

async function getNextStatementNumber(issuedAt: Date, session: mongoose.ClientSession) {
  const financialYear = getFinancialYear(issuedAt);
  const counter = await CreditBillingStatementCounter.findOneAndUpdate(
    { financialYear },
    { $inc: { sequence: 1 }, $setOnInsert: { financialYear } },
    { upsert: true, returnDocument: "after", runValidators: true, session }
  ).exec();
  if (!counter) throw new CreditBillingCycleError(500, "Billing statement number could not be generated.");
  return `CBS/${financialYear}/${String(counter.sequence).padStart(5, "0")}`;
}

export function serializeCreditBillingStatement(statement: InstanceType<typeof CreditBillingStatement>) {
  return {
    id: String(statement._id),
    statementNumber: statement.statementNumber,
    businessAccountId: String(statement.businessAccountId),
    creditAccountId: String(statement.creditAccountId),
    billingCycle: statement.billingCycle,
    periodStart: statement.periodStart,
    periodEnd: statement.periodEnd,
    issuedAt: statement.issuedAt,
    dueAt: statement.dueAt,
    currency: statement.currency,
    lines: statement.lines.map((line) => ({
      sourceType: line.sourceType,
      shipmentInvoiceId: line.shipmentInvoiceId ? String(line.shipmentInvoiceId) : null,
      cancellationFeeInvoiceId: line.cancellationFeeInvoiceId ? String(line.cancellationFeeInvoiceId) : null,
      shipmentDraftId: String(line.shipmentDraftId),
      invoiceNumber: line.invoiceNumber,
      invoiceRevision: line.invoiceRevision,
      invoiceIssuedAt: line.invoiceIssuedAt,
      outstandingAmountMinor: line.outstandingAmountMinor
    })),
    adjustments: statement.adjustments.map((adjustment) => ({
      adjustmentId: String(adjustment.adjustmentId),
      shipmentInvoiceId: String(adjustment.shipmentInvoiceId),
      originalStatementId: String(adjustment.originalStatementId),
      description: adjustment.description,
      amountMinor: adjustment.amountMinor,
      affectsAmountDue: adjustment.affectsAmountDue
    })),
    totalAmountMinor: statement.totalAmountMinor,
    paidAmountMinor: statement.paidAmountMinor,
    creditAdjustmentMinor: statement.creditAdjustmentMinor,
    outstandingAmountMinor: statement.outstandingAmountMinor,
    status: statement.status
  };
}

export async function closeCreditBillingCycle(input: {
  businessAccountId: mongoose.Types.ObjectId;
  closingDate?: Date;
  createdBy: mongoose.Types.ObjectId;
}): Promise<CloseCreditBillingCycleResult> {
  const issuedAt = input.closingDate ? new Date(input.closingDate) : new Date();
  if (Number.isNaN(issuedAt.getTime())) throw new CreditBillingCycleError(400, "Billing cycle closing date is invalid.");

  const session = await mongoose.startSession();

  try {
    const result = await session.withTransaction<CloseCreditBillingCycleResult>(async () => {
      const account = await BusinessCreditAccount.findOne({ businessAccountId: input.businessAccountId })
        .session(session)
        .exec();
      if (!account) throw new CreditBillingCycleError(404, "Business credit account was not found.");

      const period = getPreviousClosedBillingPeriod(account.billingCycle, issuedAt);
      const existing = await CreditBillingStatement.findOne({
        businessAccountId: input.businessAccountId,
        billingCycle: account.billingCycle,
        periodStart: period.start,
        periodEnd: period.end
      }).session(session).exec();
      if (existing) {
        return { created: false, empty: false, statement: serializeCreditBillingStatement(existing), period };
      }

      const verifications = await ShipmentChargeVerification.find({
        businessAccountId: input.businessAccountId,
        verifiedAt: { $gte: period.start, $lt: period.end }
      }).select("shipmentDraftId").session(session).lean().exec();
      const verifiedDraftIds = verifications.map((verification) => verification.shipmentDraftId);
      const pendingCancellations = verifiedDraftIds.length
        ? await ShipmentCancellation.find({
            shipmentDraftId: { $in: verifiedDraftIds },
            status: "REQUESTED"
          }).select("shipmentDraftId").session(session).lean().exec()
        : [];
      const blockedDraftIds = new Set(pendingCancellations.map((item) => String(item.shipmentDraftId)));
      const shipmentDraftIds = verifiedDraftIds.filter((id) => !blockedDraftIds.has(String(id)));
      const invoices = shipmentDraftIds.length
        ? await ShipmentInvoice.find({
            businessAccountId: input.businessAccountId,
            shipmentDraftId: { $in: shipmentDraftIds },
            status: "ISSUED",
            paymentStatus: { $ne: "VOID" },
            creditOutstandingMinor: { $gt: 0 },
            billingStatementId: null
          }).sort({ issuedAt: 1, _id: 1 }).session(session).exec()
        : [];
      const adjustments = await CreditBillingAdjustment.find({
        businessAccountId: input.businessAccountId,
        status: "PENDING",
        createdAt: { $lt: period.end }
      }).sort({ createdAt: 1, _id: 1 }).session(session).exec();
      const cancellationFeeInvoices = await CancellationFeeInvoice.find({
        businessAccountId: input.businessAccountId,
        issuedAt: { $gte: period.start, $lt: period.end },
        creditOutstandingMinor: { $gt: 0 },
        billingStatementId: null
      }).sort({ issuedAt: 1, _id: 1 }).session(session).exec();

      if (!invoices.length && !adjustments.length && !cancellationFeeInvoices.length) {
        return { created: false, empty: true, statement: null, period };
      }

      const invoiceTotalMinor = invoices.reduce((total, invoice) => total + invoice.creditOutstandingMinor, 0);
      const cancellationFeeTotalMinor = cancellationFeeInvoices.reduce(
        (total, invoice) => total + invoice.creditOutstandingMinor,
        0
      );
      const financialAdjustmentMinor = adjustments.reduce(
        (total, adjustment) => total + (adjustment.affectsAmountDue ? adjustment.amountMinor : 0),
        0
      );
      const totalAmountMinor = invoiceTotalMinor + cancellationFeeTotalMinor + financialAdjustmentMinor;
      if (totalAmountMinor < 0) {
        throw new CreditBillingCycleError(409, "Pending billing adjustments exceed the charges for this cycle. Contact Finance.");
      }
      const statement = new CreditBillingStatement({
        statementNumber: await getNextStatementNumber(issuedAt, session),
        businessAccountId: input.businessAccountId,
        creditAccountId: account._id,
        billingCycle: account.billingCycle,
        periodStart: period.start,
        periodEnd: period.end,
        issuedAt,
        dueAt: calculateCreditStatementDueAt(issuedAt, account.paymentTermsDays),
        currency: account.currency,
        lines: [
          ...invoices.map((invoice) => ({
            sourceType: "SHIPMENT_INVOICE" as const,
            shipmentInvoiceId: invoice._id,
            cancellationFeeInvoiceId: null,
            shipmentDraftId: invoice.shipmentDraftId,
            invoiceNumber: invoice.invoiceNumber,
            invoiceRevision: invoice.revision,
            invoiceIssuedAt: invoice.revisedAt ?? invoice.issuedAt,
            outstandingAmountMinor: invoice.creditOutstandingMinor
          })),
          ...cancellationFeeInvoices.map((invoice) => ({
            sourceType: "CANCELLATION_FEE_INVOICE" as const,
            shipmentInvoiceId: null,
            cancellationFeeInvoiceId: invoice._id,
            shipmentDraftId: invoice.shipmentDraftId,
            invoiceNumber: invoice.invoiceNumber,
            invoiceRevision: 1,
            invoiceIssuedAt: invoice.issuedAt,
            outstandingAmountMinor: invoice.creditOutstandingMinor
          }))
        ],
        adjustments: adjustments.map((adjustment) => ({
          adjustmentId: adjustment._id,
          shipmentInvoiceId: adjustment.shipmentInvoiceId,
          originalStatementId: adjustment.originalStatementId,
          description: adjustment.description,
          amountMinor: adjustment.amountMinor,
          affectsAmountDue: adjustment.affectsAmountDue
        })),
        totalAmountMinor,
        paidAmountMinor: 0,
        creditAdjustmentMinor: 0,
        outstandingAmountMinor: totalAmountMinor,
        status: totalAmountMinor === 0 ? "PAID" : "ISSUED",
        createdBy: input.createdBy
      });

      const updatedAccount = await BusinessCreditAccount.findOneAndUpdate(
        {
          _id: account._id,
          version: account.version,
          unbilledCreditMinor: { $gte: totalAmountMinor }
        },
        {
          $inc: {
            unbilledCreditMinor: -totalAmountMinor,
            invoicedOutstandingMinor: totalAmountMinor,
            version: 1
          }
        },
        { returnDocument: "after", runValidators: true, session }
      ).exec();
      if (!updatedAccount) {
        throw new CreditBillingCycleError(409, "Credit balances changed while closing the billing cycle. Try again.");
      }

      if (invoices.length) {
        const invoiceUpdate = await ShipmentInvoice.updateMany(
          { _id: { $in: invoices.map((invoice) => invoice._id) }, billingStatementId: null },
          { $set: { billingStatementId: statement._id, billedAt: issuedAt } },
          { runValidators: true, session }
        ).exec();
        if (invoiceUpdate.modifiedCount !== invoices.length) {
          throw new CreditBillingCycleError(409, "One or more shipment invoices were billed concurrently. Try again.");
        }
      }
      if (cancellationFeeInvoices.length) {
        const feeUpdate = await CancellationFeeInvoice.updateMany(
          { _id: { $in: cancellationFeeInvoices.map((invoice) => invoice._id) }, billingStatementId: null },
          { $set: { billingStatementId: statement._id, billedAt: issuedAt } },
          { runValidators: true, session }
        ).exec();
        if (feeUpdate.modifiedCount !== cancellationFeeInvoices.length) {
          throw new CreditBillingCycleError(409, "One or more cancellation fee invoices were billed concurrently. Try again.");
        }
      }
      if (adjustments.length) {
        const adjustmentUpdate = await CreditBillingAdjustment.updateMany(
          { _id: { $in: adjustments.map((adjustment) => adjustment._id) }, status: "PENDING" },
          { $set: { status: "BILLED", billingStatementId: statement._id, billedAt: issuedAt } },
          { runValidators: true, session }
        ).exec();
        if (adjustmentUpdate.modifiedCount !== adjustments.length) {
          throw new CreditBillingCycleError(409, "One or more billing adjustments were processed concurrently. Try again.");
        }
      }

      await statement.save({ session });
      await appendCreditLedgerEntry({
        account: updatedAccount,
        type: "BILLING_STATEMENT_ISSUED",
        reference: statement.statementNumber,
        description: "Credit billing statement issued.",
        amountMinor: totalAmountMinor,
        idempotencyKey: `BILLING_STATEMENT:${String(statement._id)}`,
        createdBy: input.createdBy,
        metadata: {
          statementId: statement._id,
          periodStart: period.start,
          periodEnd: period.end,
          shipmentInvoiceCount: invoices.length,
          cancellationFeeInvoiceCount: cancellationFeeInvoices.length,
          billingAdjustmentCount: adjustments.length
        },
        session
      });
      await AuditLog.create([{
        action: "CREDIT_BILLING_STATEMENT_ISSUED",
        entityType: "CREDIT_BILLING_STATEMENT",
        entityId: statement._id,
        performedBy: input.createdBy,
        performedAt: issuedAt,
        metadata: {
          businessAccountId: input.businessAccountId,
          statementNumber: statement.statementNumber,
          totalAmountMinor,
          shipmentInvoiceCount: invoices.length,
          billingAdjustmentCount: adjustments.length,
          periodStart: period.start,
          periodEnd: period.end
        }
      }], { session });
      await notifyBusinessFinancialMembers(input.businessAccountId, {
        type: "STATEMENT_ISSUED",
        title: "Credit statement generated",
        message: `${statement.statementNumber} is ready. Payment is due by ${formatIndiaDate(statement.dueAt)}.`,
        href: `/client/credit/statements/${String(statement._id)}?businessAccountId=${String(input.businessAccountId)}`,
        idempotencyKey: `STATEMENT_ISSUED:${String(statement._id)}`,
        metadata: { statementId: statement._id, totalAmountMinor }
      }, session);

      return { created: true, empty: false, statement: serializeCreditBillingStatement(statement), period };
    });

    if (!result) throw new CreditBillingCycleError(500, "Billing cycle close did not complete.");
    return result;
  } catch (error) {
    if (error instanceof CreditBillingCycleError) throw error;
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
      throw new CreditBillingCycleError(409, "This billing cycle has already been closed.");
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Close every completed-but-unclosed billing period for one account, oldest
// first. Each individual close is idempotent (it no-ops a period that already has
// a statement), so a missed run is recovered on the next one and re-running is
// safe. This is what the scheduled job calls per account.
export async function closeDueCreditBillingCycles(input: {
  businessAccountId: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  now?: Date;
  lookbackPeriods?: number;
}) {
  const now = input.now ?? new Date();
  const account = await BusinessCreditAccount.findOne({ businessAccountId: input.businessAccountId }).lean().exec();
  if (!account) return { closed: 0, statements: [] as ReturnType<typeof serializeCreditBillingStatement>[] };

  // Step back far enough to recover realistic gaps; each step lands in an earlier
  // period. 31 days guarantees crossing a month boundary for monthly cycles.
  const stepDays = account.billingCycle === "WEEKLY" ? 7 : 31;
  const lookbackPeriods = input.lookbackPeriods ?? (account.billingCycle === "WEEKLY" ? 8 : 3);

  const statements: ReturnType<typeof serializeCreditBillingStatement>[] = [];
  let closed = 0;

  for (let index = lookbackPeriods - 1; index >= 0; index -= 1) {
    const closingDate = new Date(now.getTime() - index * stepDays * DAY_MS);
    const result = await closeCreditBillingCycle({
      businessAccountId: input.businessAccountId,
      createdBy: input.createdBy,
      closingDate
    });
    if (result.created && result.statement) {
      statements.push(result.statement);
      closed += 1;
    }
  }

  return { closed, statements };
}

export async function listCreditBillingStatements(businessAccountId: mongoose.Types.ObjectId) {
  const account = await BusinessCreditAccount.findOne({ businessAccountId }).exec();
  if (account) {
    await getCreditRestrictionState({
      businessAccountId,
      gracePeriodDays: account.gracePeriodDays,
      maxOverdueDays: account.maxOverdueDays
    });
  }
  const statements = await CreditBillingStatement.find({ businessAccountId })
    .sort({ issuedAt: -1 })
    .limit(100)
    .exec();
  return statements.map(serializeCreditBillingStatement);
}

export async function getCreditBillingStatement(
  businessAccountId: mongoose.Types.ObjectId,
  statementId: mongoose.Types.ObjectId
) {
  const statement = await CreditBillingStatement.findOne({
    _id: statementId,
    businessAccountId
  }).exec();
  if (!statement) throw new CreditBillingCycleError(404, "Credit billing statement was not found.");
  return statement;
}

// Write off (adjust down) an outstanding statement balance. This is the manual
// remedy for a statement that cannot otherwise be cleared and for genuine bad
// debt. The statement, its underlying invoices, and the account's invoiced
// outstanding all move down together by exactly the written-off amount, so no new
// drift is introduced.
export async function writeOffCreditStatement(input: {
  businessAccountId: mongoose.Types.ObjectId;
  statementId: mongoose.Types.ObjectId;
  amountMinor: number;
  reason: string;
  createdBy: mongoose.Types.ObjectId;
}) {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new CreditBillingCycleError(400, "Write-off amount must be a positive whole-rupee value.");
  }

  const session = await mongoose.startSession();
  try {
    let serialized: ReturnType<typeof serializeCreditBillingStatement> | undefined;
    await session.withTransaction(async () => {
      const statement = await CreditBillingStatement.findOne({ _id: input.statementId, businessAccountId: input.businessAccountId }).session(session).exec();
      if (!statement) throw new CreditBillingCycleError(404, "Credit billing statement was not found.");
      if (statement.outstandingAmountMinor <= 0) throw new CreditBillingCycleError(409, "This statement has no outstanding balance to write off.");

      const account = await BusinessCreditAccount.findOne({ businessAccountId: input.businessAccountId }).session(session).exec();
      if (!account) throw new CreditBillingCycleError(404, "Business credit account was not found.");

      const writeOffMinor = Math.min(input.amountMinor, statement.outstandingAmountMinor, account.invoicedOutstandingMinor);
      if (writeOffMinor <= 0) throw new CreditBillingCycleError(409, "The requested write-off exceeds the account's invoiced balance.");

      // Settle the statement's own invoices oldest-first, as far as the write-off allows.
      let remainingMinor = writeOffMinor;
      const invoiceIds = statement.lines.flatMap((line) => line.shipmentInvoiceId ? [line.shipmentInvoiceId] : []);
      const feeInvoiceIds = statement.lines.flatMap((line) => line.cancellationFeeInvoiceId ? [line.cancellationFeeInvoiceId] : []);

      const invoices = await ShipmentInvoice.find({ _id: { $in: invoiceIds }, creditOutstandingMinor: { $gt: 0 } })
        .sort({ issuedAt: 1, _id: 1 }).session(session).exec();
      for (const invoice of invoices) {
        if (remainingMinor <= 0) break;
        const applied = Math.min(remainingMinor, invoice.creditOutstandingMinor);
        const next = invoice.creditOutstandingMinor - applied;
        await ShipmentInvoice.updateOne(
          { _id: invoice._id, creditOutstandingMinor: invoice.creditOutstandingMinor },
          { $set: { creditOutstandingMinor: next, paymentStatus: next === 0 ? "PAID" : "PARTIALLY_PAID" } },
          { runValidators: true, session }
        ).exec();
        remainingMinor -= applied;
      }

      const feeInvoices = await CancellationFeeInvoice.find({ _id: { $in: feeInvoiceIds }, creditOutstandingMinor: { $gt: 0 } })
        .sort({ issuedAt: 1, _id: 1 }).session(session).exec();
      for (const feeInvoice of feeInvoices) {
        if (remainingMinor <= 0) break;
        const applied = Math.min(remainingMinor, feeInvoice.creditOutstandingMinor);
        const next = feeInvoice.creditOutstandingMinor - applied;
        await CancellationFeeInvoice.updateOne(
          { _id: feeInvoice._id, creditOutstandingMinor: feeInvoice.creditOutstandingMinor },
          { $set: { creditOutstandingMinor: next, paymentStatus: next === 0 ? "PAID" : "PARTIALLY_PAID" } },
          { runValidators: true, session }
        ).exec();
        remainingMinor -= applied;
      }

      const updatedAccount = await BusinessCreditAccount.findOneAndUpdate(
        { _id: account._id, version: account.version, invoicedOutstandingMinor: { $gte: writeOffMinor } },
        { $inc: { invoicedOutstandingMinor: -writeOffMinor, version: 1 } },
        { returnDocument: "after", runValidators: true, session }
      ).exec();
      if (!updatedAccount) throw new CreditBillingCycleError(409, "Credit balances changed while writing off the statement. Try again.");

      statement.creditAdjustmentMinor += writeOffMinor;
      statement.outstandingAmountMinor -= writeOffMinor;
      statement.status = statement.outstandingAmountMinor === 0
        ? "PAID"
        : statement.status === "OVERDUE" ? "OVERDUE" : "PARTIALLY_PAID";
      await statement.save({ session });

      await appendCreditLedgerEntry({
        account: updatedAccount,
        type: "STATEMENT_WRITTEN_OFF",
        reference: statement.statementNumber,
        description: "Credit statement balance written off.",
        amountMinor: writeOffMinor,
        idempotencyKey: `STATEMENT_WRITE_OFF:${String(statement._id)}:${updatedAccount.version}`,
        createdBy: input.createdBy,
        metadata: { statementId: statement._id, reason: input.reason, writeOffMinor },
        session
      });
      await AuditLog.create([{
        action: "CREDIT_STATEMENT_WRITTEN_OFF",
        entityType: "CREDIT_BILLING_STATEMENT",
        entityId: statement._id,
        performedBy: input.createdBy,
        performedAt: new Date(),
        metadata: { businessAccountId: input.businessAccountId, statementNumber: statement.statementNumber, writeOffMinor, reason: input.reason }
      }], { session });

      serialized = serializeCreditBillingStatement(statement);
    });

    if (!serialized) throw new CreditBillingCycleError(500, "Statement write-off did not complete.");
    return serialized;
  } finally {
    await session.endSession();
  }
}
