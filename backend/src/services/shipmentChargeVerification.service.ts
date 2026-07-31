import mongoose from "mongoose";
import { AuditLog } from "../models/auditLog.model.js";
import { DpdShipment } from "../models/dpdShipment.model.js";
import { ShipmentAmendment } from "../models/shipmentAmendment.model.js";
import { ShipmentChargeVerification } from "../models/shipmentChargeVerification.model.js";
import { ShipmentDraft, type ShipmentParcel } from "../models/shipmentDraft.model.js";
import { ShipmentEvent, type ShipmentEventStatus } from "../models/shipmentEvent.model.js";
import { ShipmentInvoice } from "../models/shipmentInvoice.model.js";
import { ShipmentCancellation } from "../models/shipmentCancellation.model.js";
import {
  AmendmentBillingError,
  applyFinalChargeVerificationBilling,
  previewAmendmentFunding
} from "./amendmentBilling.service.js";
import {
  ensureShipmentInvoiceForDraft,
  ShipmentInvoiceServiceError
} from "./shipmentInvoice.service.js";
import { calculateShipmentPricingEstimate, type ShipmentPricingEstimate } from "./shipmentPricing.service.js";

const afterCollectionStatuses: ShipmentEventStatus[] = [
  "WAREHOUSE_SCAN_IN",
  "EXPORT_CUSTOMS_CLEARED",
  "FLIGHT_ASSIGNED",
  "FLIGHT_DEPARTED",
  "DESTINATION_ARRIVED",
  "IMPORT_CUSTOMS_CLEARANCE",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "RETURNED",
  "LOST",
  "DAMAGED"
];

export type VerifiedParcelInput = {
  sequence: number;
  actualWeightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
};

export class ShipmentChargeVerificationError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

function toMinor(amount: number) {
  return Math.round(amount * 100);
}

function parcelSnapshot(parcels: ShipmentParcel[]) {
  return parcels.map((parcel) => ({
    sequence: parcel.sequence,
    weightKg: parcel.weightKg,
    lengthCm: parcel.lengthCm ?? null,
    widthCm: parcel.widthCm ?? null,
    heightCm: parcel.heightCm ?? null,
    shipmentContentType: parcel.shipmentContentType,
    contentsDescription: parcel.contentsDescription,
    shipmentReference1: parcel.shipmentReference1 ?? "",
    shipmentReference2: parcel.shipmentReference2 ?? ""
  }));
}

function serializeVerification(verification: InstanceType<typeof ShipmentChargeVerification>) {
  return {
    id: String(verification._id),
    shipmentDraftId: String(verification.shipmentDraftId),
    dpdShipmentId: String(verification.dpdShipmentId),
    previousParcelList: verification.previousParcelList,
    verifiedParcelList: verification.verifiedParcelList,
    previousPricingSnapshot: verification.previousPricingSnapshot,
    verifiedPricingSnapshot: verification.verifiedPricingSnapshot,
    previousAmountMinor: verification.previousAmountMinor,
    verifiedAmountMinor: verification.verifiedAmountMinor,
    deltaAmountMinor: verification.verifiedAmountMinor - verification.previousAmountMinor,
    billingMode: verification.billingMode,
    billingAdjustment: verification.billingAdjustment,
    invoiceNumber: verification.invoiceNumber,
    invoiceRevision: verification.invoiceRevision,
    note: verification.note,
    verifiedBy: String(verification.verifiedBy),
    verifiedAt: verification.verifiedAt
  };
}

async function assertVerificationWindow(
  shipmentDraftId: mongoose.Types.ObjectId,
  session?: mongoose.ClientSession
) {
  const collectedQuery = ShipmentEvent.exists({ shipmentDraftId, status: "PARCEL_COLLECTED" });
  const progressedQuery = ShipmentEvent.exists({ shipmentDraftId, status: { $in: afterCollectionStatuses } });
  const amendmentQuery = ShipmentAmendment.exists({ shipmentDraftId, status: "REQUESTED" });
  const cancellationQuery = ShipmentCancellation.findOne({
    shipmentDraftId,
    status: { $in: ["REQUESTED", "COMPLETED"] }
  }).select("status").lean();
  if (session) {
    collectedQuery.session(session);
    progressedQuery.session(session);
    amendmentQuery.session(session);
    cancellationQuery.session(session);
  }

  const collected = await collectedQuery.exec();
  const progressed = await progressedQuery.exec();
  const pendingAmendment = await amendmentQuery.exec();
  const cancellation = await cancellationQuery.exec();
  if (!collected) {
    throw new ShipmentChargeVerificationError(409, "Final charge verification is available after Parcel Collected.");
  }
  if (progressed) {
    throw new ShipmentChargeVerificationError(409, "Final charge verification must be completed before Warehouse Scan In.");
  }
  if (pendingAmendment) {
    throw new ShipmentChargeVerificationError(409, "Approve or reject the pending shipment amendment before final verification.");
  }
  if (cancellation) {
    throw new ShipmentChargeVerificationError(
      409,
      cancellation.status === "COMPLETED"
        ? "This shipment has been cancelled and cannot be verified."
        : "Resolve the pending shipment cancellation before final verification."
    );
  }
}

function mergeVerifiedParcels(current: ShipmentParcel[], verified: VerifiedParcelInput[]) {
  if (verified.length !== current.length) {
    throw new ShipmentChargeVerificationError(400, "Verify the weight and dimensions for every parcel.");
  }
  const bySequence = new Map(verified.map((parcel) => [parcel.sequence, parcel]));
  if (bySequence.size !== verified.length) {
    throw new ShipmentChargeVerificationError(400, "Parcel sequence numbers must be unique.");
  }

  return current.map((parcel) => {
    const measured = bySequence.get(parcel.sequence);
    if (!measured) {
      throw new ShipmentChargeVerificationError(400, `Parcel ${parcel.sequence} verification is missing.`);
    }
    return {
      sequence: parcel.sequence,
      weightKg: measured.actualWeightKg,
      lengthCm: measured.lengthCm,
      widthCm: measured.widthCm,
      heightCm: measured.heightCm,
      shipmentContentType: parcel.shipmentContentType,
      contentsDescription: parcel.contentsDescription,
      shipmentReference1: parcel.shipmentReference1,
      shipmentReference2: parcel.shipmentReference2
    };
  });
}

async function calculateVerificationPricing(
  draft: InstanceType<typeof ShipmentDraft>,
  parcels: ShipmentParcel[],
  session?: mongoose.ClientSession
) {
  const pricing = await calculateShipmentPricingEstimate({
    countryCode: draft.consigneeEnteredAddress.countryCode,
    serviceType: draft.serviceType,
    parcels,
    csbType: draft.csbType,
    session
  });
  if (pricing.missingRate) {
    throw new ShipmentChargeVerificationError(409, "An applicable rate slab is required before finalizing the shipment charge.");
  }
  return pricing;
}

export async function getShipmentChargeVerificationState(dpdShipmentId: mongoose.Types.ObjectId) {
  const shipment = await DpdShipment.findById(dpdShipmentId).lean().exec();
  if (!shipment) throw new ShipmentChargeVerificationError(404, "Shipment not found.");
  const verification = await ShipmentChargeVerification.findOne({ dpdShipmentId }).exec();
  if (verification) {
    return { status: "FINALIZED" as const, eligible: false, message: "", verification: serializeVerification(verification) };
  }

  try {
    await assertVerificationWindow(shipment.shipmentDraftId);
    return { status: "PENDING" as const, eligible: true, message: "", verification: null };
  } catch (error) {
    if (!(error instanceof ShipmentChargeVerificationError) || error.statusCode !== 409) throw error;
    return { status: "PENDING" as const, eligible: false, message: error.message, verification: null };
  }
}

export async function previewShipmentChargeVerification(input: {
  dpdShipmentId: mongoose.Types.ObjectId;
  parcels: VerifiedParcelInput[];
}) {
  const shipment = await DpdShipment.findById(input.dpdShipmentId).exec();
  if (!shipment) throw new ShipmentChargeVerificationError(404, "Shipment not found.");
  if (await ShipmentChargeVerification.exists({ dpdShipmentId: shipment._id })) {
    throw new ShipmentChargeVerificationError(409, "The final shipment charge has already been verified.");
  }
  await assertVerificationWindow(shipment.shipmentDraftId);

  const draft = await ShipmentDraft.findById(shipment.shipmentDraftId).exec();
  const invoice = await ShipmentInvoice.findOne({ shipmentDraftId: shipment.shipmentDraftId }).exec();
  if (!draft || !invoice) throw new ShipmentChargeVerificationError(409, "Shipment billing information is incomplete.");

  const verifiedParcels = mergeVerifiedParcels(draft.parcelList, input.parcels);
  const verifiedPricing = await calculateVerificationPricing(draft, verifiedParcels);
  const fundingPreview = await previewAmendmentFunding({
    shipmentDraftId: draft._id as mongoose.Types.ObjectId,
    businessAccountId: draft.businessAccountId,
    pricing: verifiedPricing,
    purpose: "FINAL_VERIFICATION"
  });

  return {
    currentPricing: invoice.pricingSnapshot as unknown as ShipmentPricingEstimate,
    verifiedPricing,
    fundingPreview,
    expectedTotalAmountMinor: toMinor(verifiedPricing.totalAmount),
    exceedsMaxBoxKg: verifiedPricing.exceedsMaxBoxKg
  };
}

export async function finalizeShipmentChargeVerification(input: {
  dpdShipmentId: mongoose.Types.ObjectId;
  parcels: VerifiedParcelInput[];
  expectedTotalAmountMinor: number;
  note: string;
  verifiedBy: mongoose.Types.ObjectId;
}) {
  const session = await mongoose.startSession();
  let result: ReturnType<typeof serializeVerification> | null = null;

  try {
    await session.withTransaction(async () => {
      const shipment = await DpdShipment.findById(input.dpdShipmentId).session(session).exec();
      if (!shipment) throw new ShipmentChargeVerificationError(404, "Shipment not found.");
      if (await ShipmentChargeVerification.exists({ dpdShipmentId: shipment._id }).session(session)) {
        throw new ShipmentChargeVerificationError(409, "The final shipment charge has already been verified.");
      }
      await assertVerificationWindow(shipment.shipmentDraftId, session);

      const draft = await ShipmentDraft.findById(shipment.shipmentDraftId).session(session).exec();
      const invoice = await ShipmentInvoice.findOne({ shipmentDraftId: shipment.shipmentDraftId }).session(session).exec();
      if (!draft || !invoice) throw new ShipmentChargeVerificationError(409, "Shipment billing information is incomplete.");

      const previousParcels = parcelSnapshot(draft.parcelList);
      const verifiedParcels = mergeVerifiedParcels(draft.parcelList, input.parcels);
      const verifiedPricing = await calculateVerificationPricing(draft, verifiedParcels, session);
      if (toMinor(verifiedPricing.totalAmount) !== input.expectedTotalAmountMinor) {
        throw new ShipmentChargeVerificationError(409, "The final charge changed after preview. Check the charges again.");
      }

      const fundingPreview = await previewAmendmentFunding({
        shipmentDraftId: draft._id as mongoose.Types.ObjectId,
        businessAccountId: draft.businessAccountId,
        pricing: verifiedPricing,
        session,
        purpose: "FINAL_VERIFICATION"
      });
      if (!fundingPreview.canFund || !fundingPreview.adjustment) {
        throw new ShipmentChargeVerificationError(402, fundingPreview.message || "The account cannot fund the final verified charge.");
      }

      const verification = new ShipmentChargeVerification({
        shipmentDraftId: draft._id,
        dpdShipmentId: shipment._id,
        businessAccountId: draft.businessAccountId,
        branchId: draft.branchId,
        previousParcelList: previousParcels,
        verifiedParcelList: parcelSnapshot(verifiedParcels),
        previousPricingSnapshot: invoice.pricingSnapshot,
        verifiedPricingSnapshot: verifiedPricing,
        previousAmountMinor: invoice.totalAmountMinor,
        verifiedAmountMinor: toMinor(verifiedPricing.totalAmount),
        billingMode: fundingPreview.billingMode,
        billingAdjustment: fundingPreview.adjustment,
        invoiceNumber: invoice.invoiceNumber,
        invoiceRevision: invoice.revision,
        note: input.note,
        verifiedBy: input.verifiedBy,
        verifiedAt: new Date()
      });

      let billingAdjustment;
      try {
        billingAdjustment = await applyFinalChargeVerificationBilling({
          verificationId: verification._id as mongoose.Types.ObjectId,
          shipmentDraftId: draft._id as mongoose.Types.ObjectId,
          businessAccountId: draft.businessAccountId,
          pricing: verifiedPricing,
          createdBy: input.verifiedBy,
          session
        });
      } catch (error) {
        if (error instanceof AmendmentBillingError) {
          throw new ShipmentChargeVerificationError(error.statusCode, error.message);
        }
        throw error;
      }

      draft.parcelList = verifiedParcels;
      await draft.save({ session });
      let revisedInvoice;
      try {
        revisedInvoice = await ensureShipmentInvoiceForDraft({
          shipmentDraftId: draft._id as mongoose.Types.ObjectId,
          dpdShipmentId: shipment._id as mongoose.Types.ObjectId,
          userId: input.verifiedBy,
          revise: true,
          paymentAllocation: {
            advanceAppliedMinor: billingAdjustment.advanceAppliedMinor,
            creditOutstandingMinor: billingAdjustment.creditOutstandingMinor
          },
          pricingOverride: verifiedPricing,
          session
        });
      } catch (error) {
        if (error instanceof ShipmentInvoiceServiceError) {
          throw new ShipmentChargeVerificationError(error.statusCode, error.message);
        }
        throw error;
      }

      verification.billingAdjustment = billingAdjustment as unknown as Record<string, unknown>;
      verification.invoiceNumber = revisedInvoice.invoiceNumber;
      verification.invoiceRevision = revisedInvoice.revision;
      await verification.save({ session });
      await AuditLog.create([{
        action: "SHIPMENT_CHARGE_VERIFIED",
        entityType: "DPD_SHIPMENT",
        entityId: shipment._id,
        performedBy: input.verifiedBy,
        performedAt: verification.verifiedAt,
        metadata: {
          shipmentDraftId: draft._id,
          previousAmountMinor: verification.previousAmountMinor,
          verifiedAmountMinor: verification.verifiedAmountMinor,
          invoiceNumber: revisedInvoice.invoiceNumber,
          invoiceRevision: revisedInvoice.revision,
          billingAdjustment
        }
      }], { session });
      result = serializeVerification(verification);
    });
  } catch (error) {
    if (error instanceof ShipmentChargeVerificationError) throw error;
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
      throw new ShipmentChargeVerificationError(409, "The final shipment charge has already been verified.");
    }
    throw error;
  } finally {
    await session.endSession();
  }

  if (!result) throw new ShipmentChargeVerificationError(500, "Final charge verification did not complete.");
  return result;
}
