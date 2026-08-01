import mongoose from "mongoose";
import { AuditLog } from "../models/auditLog.model.js";
import { BusinessCreditAccount } from "../models/businessCreditAccount.model.js";
import { CancellationDocumentCounter } from "../models/cancellationDocumentCounter.model.js";
import { CancellationFeeInvoice } from "../models/cancellationFeeInvoice.model.js";
import { CreditBillingAdjustment } from "../models/creditBillingAdjustment.model.js";
import { CreditBillingStatement } from "../models/creditBillingStatement.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { ShipmentAmendment } from "../models/shipmentAmendment.model.js";
import { ShipmentCancellation, type IShipmentCancellation } from "../models/shipmentCancellation.model.js";
import { ShipmentCharge } from "../models/shipmentCharge.model.js";
import { ShipmentCreditNote } from "../models/shipmentCreditNote.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import { ShipmentEvent, type ShipmentEventStatus } from "../models/shipmentEvent.model.js";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import { appendCreditLedgerEntry } from "./creditAccount.service.js";
import { notifyActiveAdmins, notifyBusinessFinancialMembers } from "./portalNotification.service.js";

export const DEFAULT_CANCELLATION_FEE_BASE_MINOR = 70000;
export const CANCELLATION_GST_RATE_PERCENT = 18;

const afterBookingStatuses: ShipmentEventStatus[] = [
  "PARCEL_COLLECTED", "WAREHOUSE_SCAN_IN", "EXPORT_CUSTOMS_CLEARED", "FLIGHT_ASSIGNED",
  "FLIGHT_DEPARTED", "DESTINATION_ARRIVED", "IMPORT_CUSTOMS_CLEARANCE", "IN_TRANSIT",
  "OUT_FOR_DELIVERY", "DELIVERED", "RETURNED", "LOST", "DAMAGED"
];
const warehouseAndLaterStatuses: ShipmentEventStatus[] = afterBookingStatuses.slice(1);

export class ShipmentCancellationError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

export function calculateCancellationAmounts(
  originalAmountMinor: number,
  requestedFeeBaseMinor = DEFAULT_CANCELLATION_FEE_BASE_MINOR
) {
  if (!Number.isInteger(originalAmountMinor) || originalAmountMinor < 0) {
    throw new ShipmentCancellationError(400, "The shipment invoice amount is invalid.");
  }
  if (!Number.isInteger(requestedFeeBaseMinor) || requestedFeeBaseMinor < DEFAULT_CANCELLATION_FEE_BASE_MINOR) {
    throw new ShipmentCancellationError(400, "The cancellation fee must be at least INR 700 before GST.");
  }

  const requestedGstMinor = Math.round(requestedFeeBaseMinor * CANCELLATION_GST_RATE_PERCENT / 100);
  const requestedTotalMinor = requestedFeeBaseMinor + requestedGstMinor;
  if (requestedTotalMinor <= originalAmountMinor) {
    return {
      feeBaseMinor: requestedFeeBaseMinor,
      feeGstMinor: requestedGstMinor,
      feeTotalMinor: requestedTotalMinor,
      refundableAmountMinor: originalAmountMinor - requestedTotalMinor,
      feeWasCapped: false
    };
  }

  // Cancellation must never create a new payable balance for a low-value shipment.
  const feeBaseMinor = Math.round(originalAmountMinor * 100 / (100 + CANCELLATION_GST_RATE_PERCENT));
  const feeGstMinor = originalAmountMinor - feeBaseMinor;
  return {
    feeBaseMinor,
    feeGstMinor,
    feeTotalMinor: originalAmountMinor,
    refundableAmountMinor: 0,
    feeWasCapped: true
  };
}

export function calculateCancellationSettlement(input: {
  originalAmountMinor: number;
  feeTotalMinor: number;
  refundableAmountMinor: number;
  currentCreditOutstandingMinor: number;
}) {
  const values = Object.values(input);
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new ShipmentCancellationError(400, "The cancellation settlement values are invalid.");
  }
  if (input.feeTotalMinor + input.refundableAmountMinor !== input.originalAmountMinor) {
    throw new ShipmentCancellationError(409, "The cancellation fee and refund do not match the shipment total.");
  }
  if (input.currentCreditOutstandingMinor > input.originalAmountMinor) {
    throw new ShipmentCancellationError(409, "The shipment credit allocation exceeds the invoice total.");
  }

  const settledOriginalAmountMinor = input.originalAmountMinor - input.currentCreditOutstandingMinor;
  const cancellationFeeCreditMinor = Math.max(0, input.feeTotalMinor - settledOriginalAmountMinor);
  const netCreditReleasedMinor = input.currentCreditOutstandingMinor - cancellationFeeCreditMinor;
  const customerAdvanceCreditedMinor = input.refundableAmountMinor - netCreditReleasedMinor;

  return {
    originalCreditReversedMinor: input.currentCreditOutstandingMinor,
    cancellationFeeCreditMinor,
    cancellationFeeSettledMinor: input.feeTotalMinor - cancellationFeeCreditMinor,
    netCreditReleasedMinor,
    customerAdvanceCreditedMinor
  };
}

export function getCancellationEligibility(input: {
  requesterType: "CLIENT" | "ADMIN";
  hasBooked: boolean;
  hasParcelCollectedOrLater: boolean;
  hasWarehouseScanOrLater: boolean;
  alreadyCancelled: boolean;
}) {
  if (input.alreadyCancelled) return { allowed: false, message: "This shipment has already been cancelled." };
  if (!input.hasBooked) return { allowed: false, message: "Only booked shipments can be cancelled." };
  if (input.requesterType === "CLIENT" && input.hasParcelCollectedOrLater) {
    return { allowed: false, message: "Cancellation is no longer available because the parcel has been collected. Contact your assigned branch." };
  }
  if (input.requesterType === "ADMIN" && input.hasWarehouseScanOrLater) {
    return { allowed: false, message: "Cancellation is blocked after Warehouse Scan In." };
  }
  return { allowed: true, message: "" };
}

async function cancellationGate(
  shipmentDraftId: mongoose.Types.ObjectId,
  requesterType: "CLIENT" | "ADMIN",
  session?: mongoose.ClientSession
) {
  const events = await ShipmentEvent.find({ shipmentDraftId })
    .select("status")
    .session(session ?? null)
    .lean()
    .exec();
  const statuses = new Set(events.map((event) => event.status));
  return getCancellationEligibility({
    requesterType,
    hasBooked: statuses.has("SHIPMENT_BOOKED"),
    hasParcelCollectedOrLater: afterBookingStatuses.some((status) => statuses.has(status)),
    hasWarehouseScanOrLater: warehouseAndLaterStatuses.some((status) => statuses.has(status)),
    alreadyCancelled: statuses.has("SHIPMENT_CANCELLED")
  });
}

function getFinancialYear(date: Date) {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? year : year - 1;
  return `${String(startYear).slice(-2)}-${String(startYear + 1).slice(-2)}`;
}

async function nextDocumentNumber(
  documentType: "CREDIT_NOTE" | "FEE_INVOICE",
  date: Date,
  session: mongoose.ClientSession
) {
  const financialYear = getFinancialYear(date);
  const counter = await CancellationDocumentCounter.findOneAndUpdate(
    { financialYear, documentType },
    { $inc: { sequence: 1 }, $setOnInsert: { financialYear, documentType } },
    { returnDocument: "after", upsert: true, runValidators: true, session }
  ).exec();
  const prefix = documentType === "CREDIT_NOTE" ? "CN" : "CFI";
  return { financialYear, number: `${prefix}/${financialYear}/${String(counter.sequence).padStart(5, "0")}` };
}

function feeTaxSplit(feeGstMinor: number, taxType: "CGST_SGST" | "IGST") {
  if (taxType === "IGST") {
    return { cgstAmountMinor: 0, sgstAmountMinor: 0, igstAmountMinor: feeGstMinor };
  }
  const cgstAmountMinor = Math.floor(feeGstMinor / 2);
  return { cgstAmountMinor, sgstAmountMinor: feeGstMinor - cgstAmountMinor, igstAmountMinor: 0 };
}

export function serializeShipmentCancellation(cancellation: IShipmentCancellation) {
  return {
    id: String(cancellation._id),
    shipmentDraftId: String(cancellation.shipmentDraftId),
    dpdShipmentId: String(cancellation.dpdShipmentId),
    businessAccountId: String(cancellation.businessAccountId),
    branchId: String(cancellation.branchId),
    requesterType: cancellation.requesterType,
    requesterRole: cancellation.requesterRole,
    reason: cancellation.reason,
    shipmentStatusAtRequest: cancellation.shipmentStatusAtRequest,
    status: cancellation.status,
    originalAmountMinor: cancellation.originalAmountMinor,
    requestedFeeBaseMinor: cancellation.requestedFeeBaseMinor,
    approvedFeeBaseMinor: cancellation.approvedFeeBaseMinor ?? null,
    feeGstMinor: cancellation.feeGstMinor ?? null,
    feeTotalMinor: cancellation.feeTotalMinor ?? null,
    refundableAmountMinor: cancellation.refundableAmountMinor ?? null,
    feeReason: cancellation.feeReason,
    carrierConfirmed: cancellation.carrierConfirmed,
    settlementConfirmed: cancellation.settlementConfirmed,
    carrierReference: cancellation.carrierReference,
    reviewNote: cancellation.reviewNote,
    settlement: cancellation.settlement ?? null,
    creditNoteId: cancellation.creditNoteId ? String(cancellation.creditNoteId) : null,
    cancellationFeeInvoiceId: cancellation.cancellationFeeInvoiceId ? String(cancellation.cancellationFeeInvoiceId) : null,
    requestedAt: cancellation.requestedAt,
    reviewedAt: cancellation.reviewedAt ?? null,
    completedAt: cancellation.completedAt ?? null
  };
}

export async function getShipmentCancellation(shipmentDraftId: mongoose.Types.ObjectId) {
  const cancellation = await ShipmentCancellation.findOne({ shipmentDraftId }).sort({ requestedAt: -1 }).exec();
  return cancellation ? serializeShipmentCancellation(cancellation) : null;
}

export async function requestShipmentCancellation(input: {
  shipmentDraftId: mongoose.Types.ObjectId;
  requestedBy: mongoose.Types.ObjectId;
  requesterType: "CLIENT" | "ADMIN";
  requesterRole: string;
  reason: string;
}) {
  const draft = await ShipmentDraft.findById(input.shipmentDraftId).exec();
  if (!draft) throw new ShipmentCancellationError(404, "Shipment not found.");
  const dpdShipment = await DpdShipment.findOne({ shipmentDraftId: draft._id }).exec();
  if (!dpdShipment) throw new ShipmentCancellationError(409, "Only booked shipments can be cancelled.");
  const invoice = await ShipmentInvoice.findOne({ shipmentDraftId: draft._id }).exec();
  if (!invoice) throw new ShipmentCancellationError(409, "Shipment billing information is incomplete.");

  const gate = await cancellationGate(draft._id as mongoose.Types.ObjectId, input.requesterType);
  if (!gate.allowed) throw new ShipmentCancellationError(409, gate.message);
  if (await ShipmentAmendment.exists({ shipmentDraftId: draft._id, status: "REQUESTED" })) {
    throw new ShipmentCancellationError(409, "Approve or reject the pending amendment before requesting cancellation.");
  }
  const existing = await ShipmentCancellation.findOne({ shipmentDraftId: draft._id, status: "REQUESTED" }).exec();
  if (existing) return existing;

  const latestEvent = await ShipmentEvent.findOne({ shipmentDraftId: draft._id })
    .sort({ eventAt: -1, createdAt: -1 })
    .lean()
    .exec();
  const cancellation = await ShipmentCancellation.create({
    shipmentDraftId: draft._id,
    dpdShipmentId: dpdShipment._id,
    shipmentInvoiceId: invoice._id,
    businessAccountId: draft.businessAccountId,
    branchId: draft.branchId,
    requestedBy: input.requestedBy,
    requesterType: input.requesterType,
    requesterRole: input.requesterRole,
    reason: input.reason,
    shipmentStatusAtRequest: latestEvent?.status ?? "SHIPMENT_BOOKED",
    status: "REQUESTED",
    originalAmountMinor: invoice.totalAmountMinor,
    requestedFeeBaseMinor: DEFAULT_CANCELLATION_FEE_BASE_MINOR,
    requestedAt: new Date()
  });

  await AuditLog.create({
    action: "SHIPMENT_CANCELLATION_REQUESTED",
    entityType: "SHIPMENT_CANCELLATION",
    entityId: cancellation._id,
    performedBy: input.requestedBy,
    performedAt: cancellation.requestedAt,
    metadata: { shipmentDraftId: draft._id, dpdShipmentId: dpdShipment._id, requesterType: input.requesterType }
  });
  await notifyActiveAdmins({
    type: "SHIPMENT_CANCELLATION_REQUESTED",
    title: "Shipment cancellation requested",
    message: `A cancellation request for shipment ${dpdShipment.dpdShipmentId || String(dpdShipment._id)} requires review.`,
    href: `/dashboard/cancellations#cancellation-${String(cancellation._id)}`,
    idempotencyKey: `SHIPMENT_CANCELLATION_REQUESTED:${String(cancellation._id)}`,
    businessAccountId: draft.businessAccountId
  });
  return cancellation;
}

export async function rejectShipmentCancellation(input: {
  cancellationId: mongoose.Types.ObjectId;
  reviewedBy: mongoose.Types.ObjectId;
  reviewNote: string;
}) {
  const cancellation = await ShipmentCancellation.findOneAndUpdate(
    { _id: input.cancellationId, status: "REQUESTED" },
    {
      $set: {
        status: "REJECTED",
        reviewedBy: input.reviewedBy,
        reviewNote: input.reviewNote,
        reviewedAt: new Date()
      }
    },
    { returnDocument: "after", runValidators: true }
  ).exec();
  if (!cancellation) throw new ShipmentCancellationError(409, "Only pending cancellation requests can be rejected.");

  await AuditLog.create({
    action: "SHIPMENT_CANCELLATION_REJECTED",
    entityType: "SHIPMENT_CANCELLATION",
    entityId: cancellation._id,
    performedBy: input.reviewedBy,
    performedAt: cancellation.reviewedAt ?? new Date(),
    metadata: { shipmentDraftId: cancellation.shipmentDraftId, reviewNote: input.reviewNote }
  });
  await notifyBusinessFinancialMembers(cancellation.businessAccountId, {
    type: "SHIPMENT_CANCELLATION_REJECTED",
    title: "Cancellation request rejected",
    message: "Swiftline reviewed the shipment cancellation request and did not approve it.",
    href: `/client/shipments/${String(cancellation.shipmentDraftId)}#shipment-cancellation`,
    idempotencyKey: `SHIPMENT_CANCELLATION_REJECTED:${String(cancellation._id)}`
  });
  return cancellation;
}

export async function assertNoPendingShipmentCancellation(
  shipmentDraftId: mongoose.Types.ObjectId,
  action: string,
  session?: mongoose.ClientSession
) {
  const pending = await ShipmentCancellation.exists({ shipmentDraftId, status: "REQUESTED" })
    .session(session ?? null);
  if (pending) {
    throw new ShipmentCancellationError(
      409,
      `This shipment has a pending cancellation request. Resolve it before ${action}.`
    );
  }
}

export async function approveShipmentCancellation(input: {
  cancellationId: mongoose.Types.ObjectId;
  reviewedBy: mongoose.Types.ObjectId;
  feeBaseMinor: number;
  feeReason: string;
  carrierConfirmed: boolean;
  settlementConfirmed: boolean;
  carrierReference: string;
  reviewNote: string;
}) {
  if (!input.carrierConfirmed) {
    throw new ShipmentCancellationError(400, "Confirm carrier cancellation before completing the refund.");
  }
  if (!input.settlementConfirmed) {
    throw new ShipmentCancellationError(400, "Confirm the cancellation settlement before completing the refund.");
  }
  if (input.feeBaseMinor > DEFAULT_CANCELLATION_FEE_BASE_MINOR && input.feeReason.trim().length < 5) {
    throw new ShipmentCancellationError(400, "Explain the additional carrier or handling fee.");
  }

  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      const cancellation = await ShipmentCancellation.findById(input.cancellationId).session(session).exec();
      if (!cancellation) throw new ShipmentCancellationError(404, "Cancellation request not found.");
      if (cancellation.status === "COMPLETED") return cancellation;
      if (cancellation.status !== "REQUESTED") {
        throw new ShipmentCancellationError(409, "Only pending cancellation requests can be approved.");
      }

      const gate = await cancellationGate(cancellation.shipmentDraftId, "ADMIN", session);
      if (!gate.allowed) throw new ShipmentCancellationError(409, gate.message);
      const pendingAmendment = await ShipmentAmendment.exists({
        shipmentDraftId: cancellation.shipmentDraftId,
        status: "REQUESTED"
      }).session(session);
      if (pendingAmendment) {
        throw new ShipmentCancellationError(409, "Approve or reject the pending amendment before completing cancellation.");
      }

      const invoice = await ShipmentInvoice.findOne({
        _id: cancellation.shipmentInvoiceId,
        shipmentDraftId: cancellation.shipmentDraftId,
        paymentStatus: { $ne: "VOID" }
      }).session(session).exec();
      if (!invoice) throw new ShipmentCancellationError(409, "The active shipment invoice could not be found.");
      if (invoice.totalAmountMinor !== cancellation.originalAmountMinor) {
        throw new ShipmentCancellationError(
          409,
          "The shipment invoice changed after cancellation was requested. Reject this request and create a new one."
        );
      }

      const amounts = calculateCancellationAmounts(invoice.totalAmountMinor, input.feeBaseMinor);
      const businessCharge = await ShipmentCharge.exists({
        shipmentDraftId: cancellation.shipmentDraftId,
        paymentSource: "BUSINESS_ACCOUNT"
      }).session(session);

      const settlement = businessCharge
        ? calculateCancellationSettlement({
            originalAmountMinor: invoice.totalAmountMinor,
            feeTotalMinor: amounts.feeTotalMinor,
            refundableAmountMinor: amounts.refundableAmountMinor,
            currentCreditOutstandingMinor: invoice.creditOutstandingMinor
          })
        : {
            originalCreditReversedMinor: 0,
            cancellationFeeCreditMinor: 0,
            cancellationFeeSettledMinor: amounts.feeTotalMinor,
            netCreditReleasedMinor: 0,
            customerAdvanceCreditedMinor: 0
          };
      let statementCreditAppliedMinor = 0;
      if (businessCharge) {
        const account = await BusinessCreditAccount.findOne({ businessAccountId: cancellation.businessAccountId })
          .session(session)
          .exec();
        if (!account) throw new ShipmentCancellationError(409, "Business credit account was not found.");

        const isBilled = Boolean(invoice.billingStatementId);
        statementCreditAppliedMinor = isBilled ? settlement.originalCreditReversedMinor : 0;
        const unbilledCreditChangeMinor = isBilled
          ? settlement.cancellationFeeCreditMinor
          : settlement.cancellationFeeCreditMinor - settlement.originalCreditReversedMinor;
        const updatedAccount = await BusinessCreditAccount.findOneAndUpdate(
          {
            _id: account._id,
            version: account.version,
            ...(isBilled
              ? { invoicedOutstandingMinor: { $gte: statementCreditAppliedMinor } }
              : { unbilledCreditMinor: { $gte: settlement.originalCreditReversedMinor } })
          },
          {
            $inc: {
              invoicedOutstandingMinor: -statementCreditAppliedMinor,
              unbilledCreditMinor: unbilledCreditChangeMinor,
              customerAdvanceBalanceMinor: settlement.customerAdvanceCreditedMinor,
              version: 1
            }
          },
          { returnDocument: "after", runValidators: true, session }
        ).exec();
        if (!updatedAccount) {
          throw new ShipmentCancellationError(409, "Credit balances changed during cancellation. Try again.");
        }

        if (invoice.billingStatementId && statementCreditAppliedMinor > 0) {
          const statement = await CreditBillingStatement.findOne({
            _id: invoice.billingStatementId,
            outstandingAmountMinor: { $gte: statementCreditAppliedMinor }
          }).session(session).exec();
          if (!statement) {
            throw new ShipmentCancellationError(409, "The original billing statement cannot accept this cancellation credit.");
          }
          statement.creditAdjustmentMinor += statementCreditAppliedMinor;
          statement.outstandingAmountMinor -= statementCreditAppliedMinor;
          statement.status = statement.outstandingAmountMinor === 0 ? "PAID" : "PARTIALLY_PAID";
          await statement.save({ session });
          await CreditBillingAdjustment.create([{
            businessAccountId: cancellation.businessAccountId,
            creditAccountId: updatedAccount._id,
            shipmentInvoiceId: invoice._id,
            originalStatementId: statement._id,
            sourceType: "CANCELLATION",
            sourceId: cancellation._id,
            amountMinor: -statementCreditAppliedMinor,
            affectsAmountDue: false,
            description: "Shipment cancellation credit already applied to the original statement.",
            status: "PENDING",
            createdBy: input.reviewedBy
          }], { session });
        }

        await appendCreditLedgerEntry({
          account: updatedAccount,
          type: "SHIPMENT_CANCELLATION_APPLIED",
          reference: `CANCELLATION-${String(cancellation._id)}`,
          description: "Shipment cancellation refund and credit release applied.",
          amountMinor: amounts.refundableAmountMinor,
          idempotencyKey: `SHIPMENT_CANCELLATION:${String(cancellation._id)}`,
          createdBy: input.reviewedBy,
          metadata: {
            shipmentDraftId: cancellation.shipmentDraftId,
            feeTotalMinor: amounts.feeTotalMinor,
            originalCreditReversedMinor: settlement.originalCreditReversedMinor,
            cancellationFeeCreditMinor: settlement.cancellationFeeCreditMinor,
            netCreditReleasedMinor: settlement.netCreditReleasedMinor,
            statementCreditAppliedMinor,
            customerAdvanceCreditedMinor: settlement.customerAdvanceCreditedMinor
          },
          session
        });
      }

      const issuedAt = new Date();
      const creditNoteNumber = await nextDocumentNumber("CREDIT_NOTE", issuedAt, session);
      const feeInvoiceNumber = await nextDocumentNumber("FEE_INVOICE", issuedAt, session);
      const feeTaxes = feeTaxSplit(amounts.feeGstMinor, invoice.taxType);
      const [creditNote] = await ShipmentCreditNote.create([{
        creditNoteNumber: creditNoteNumber.number,
        financialYear: creditNoteNumber.financialYear,
        cancellationId: cancellation._id,
        shipmentInvoiceId: invoice._id,
        shipmentDraftId: cancellation.shipmentDraftId,
        businessAccountId: cancellation.businessAccountId,
        branchId: cancellation.branchId,
        originalInvoiceNumber: invoice.invoiceNumber,
        originalInvoiceRevision: invoice.revision,
        supplier: invoice.supplier,
        customer: invoice.customer,
        shipment: invoice.shipment,
        taxableValueMinor: invoice.taxableValueMinor,
        gstRatePercent: invoice.gstRatePercent,
        taxType: invoice.taxType,
        cgstAmountMinor: invoice.cgstAmountMinor,
        sgstAmountMinor: invoice.sgstAmountMinor,
        igstAmountMinor: invoice.igstAmountMinor,
        totalTaxAmountMinor: invoice.totalTaxAmountMinor,
        totalAmountMinor: invoice.totalAmountMinor,
        reason: cancellation.reason,
        issuedAt,
        createdBy: input.reviewedBy
      }], { session });
      const [feeInvoice] = await CancellationFeeInvoice.create([{
        invoiceNumber: feeInvoiceNumber.number,
        financialYear: feeInvoiceNumber.financialYear,
        cancellationId: cancellation._id,
        shipmentDraftId: cancellation.shipmentDraftId,
        businessAccountId: cancellation.businessAccountId,
        branchId: cancellation.branchId,
        supplier: invoice.supplier,
        customer: invoice.customer,
        taxableValueMinor: amounts.feeBaseMinor,
        gstRatePercent: CANCELLATION_GST_RATE_PERCENT,
        taxType: invoice.taxType,
        ...feeTaxes,
        totalTaxAmountMinor: amounts.feeGstMinor,
        totalAmountMinor: amounts.feeTotalMinor,
        advanceAppliedMinor: settlement.cancellationFeeSettledMinor,
        creditOutstandingMinor: settlement.cancellationFeeCreditMinor,
        paymentStatus: settlement.cancellationFeeCreditMinor === 0
          ? "PAID"
          : settlement.cancellationFeeSettledMinor > 0 ? "PARTIALLY_PAID" : "UNPAID",
        billingStatementId: null,
        billedAt: null,
        feeReason: input.feeReason.trim() || "Standard shipment cancellation fee.",
        issuedAt,
        createdBy: input.reviewedBy
      }], { session });
      if (!creditNote || !feeInvoice) {
        throw new ShipmentCancellationError(500, "Cancellation financial documents could not be generated.");
      }

      invoice.paymentStatus = "VOID";
      invoice.creditOutstandingMinor = 0;
      invoice.updatedBy = input.reviewedBy;
      await invoice.save({ session });
      await ShipmentCharge.updateOne(
        { shipmentDraftId: cancellation.shipmentDraftId },
        { $set: { customerChargeStatus: "REVERSED" } },
        { runValidators: true, session }
      ).exec();
      await ShipmentEvent.create([{
        shipmentDraftId: cancellation.shipmentDraftId,
        dpdShipmentId: cancellation.dpdShipmentId,
        status: "SHIPMENT_CANCELLED",
        note: "Shipment cancelled after Swiftline review and carrier confirmation.",
        customerVisible: true,
        createdBy: input.reviewedBy,
        eventAt: issuedAt
      }], { session });

      cancellation.status = "COMPLETED";
      cancellation.approvedFeeBaseMinor = amounts.feeBaseMinor;
      cancellation.feeGstMinor = amounts.feeGstMinor;
      cancellation.feeTotalMinor = amounts.feeTotalMinor;
      cancellation.refundableAmountMinor = amounts.refundableAmountMinor;
      cancellation.feeReason = input.feeReason.trim() || "Standard shipment cancellation fee.";
      cancellation.carrierConfirmed = true;
      cancellation.settlementConfirmed = true;
      cancellation.carrierReference = input.carrierReference;
      cancellation.reviewNote = input.reviewNote;
      cancellation.reviewedBy = input.reviewedBy;
      cancellation.reviewedAt = issuedAt;
      cancellation.completedAt = issuedAt;
      cancellation.settlement = {
        originalCreditReversedMinor: settlement.originalCreditReversedMinor,
        cancellationFeeCreditMinor: settlement.cancellationFeeCreditMinor,
        netCreditReleasedMinor: settlement.netCreditReleasedMinor,
        statementCreditAppliedMinor,
        customerAdvanceCreditedMinor: settlement.customerAdvanceCreditedMinor
      };
      cancellation.creditNoteId = creditNote._id;
      cancellation.cancellationFeeInvoiceId = feeInvoice._id;
      await cancellation.save({ session });

      await AuditLog.create([{
        action: "SHIPMENT_CANCELLATION_COMPLETED",
        entityType: "SHIPMENT_CANCELLATION",
        entityId: cancellation._id,
        performedBy: input.reviewedBy,
        performedAt: issuedAt,
        metadata: {
          shipmentDraftId: cancellation.shipmentDraftId,
          creditNoteNumber: creditNote.creditNoteNumber,
          cancellationFeeInvoiceNumber: feeInvoice.invoiceNumber,
          feeTotalMinor: amounts.feeTotalMinor,
          refundableAmountMinor: amounts.refundableAmountMinor
        }
      }], { session });
      await notifyBusinessFinancialMembers(cancellation.businessAccountId, {
        type: "SHIPMENT_CANCELLATION_COMPLETED",
        title: "Shipment cancellation completed",
        message: `Cancellation completed. ${creditNote.creditNoteNumber} and ${feeInvoice.invoiceNumber} are available.`,
        href: `/client/shipments/${String(cancellation.shipmentDraftId)}#shipment-cancellation`,
        idempotencyKey: `SHIPMENT_CANCELLATION_COMPLETED:${String(cancellation._id)}`
      }, session);
      return cancellation;
    });
  } finally {
    await session.endSession();
  }
}
