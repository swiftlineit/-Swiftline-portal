import crypto from "crypto";
import mongoose from "mongoose";
import { AuditLog } from "../models/auditLog.model.js";
import { Branch } from "../models/branch.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import {
  DpdShipment,
  IDpdShipment,
  type ShipmentBookingProvider
} from "../models/dpdShipment.model.js";
import { InvoiceUpload } from "../models/invoiceUpload.model.js";
import { LabelDocument, type LabelType } from "../models/labelDocument.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import type { PaymentSource, ShippingEnvironment } from "../models/financialTypes.js";
import { validateShipmentDraftFields } from "./shipmentValidation.service.js";
import {
  DpdApiError,
  DpdTimeoutError,
  createDpdShipment,
  type DpdCreateShipmentResponse
} from "./dpdApiClient.service.js";
import { mapShipmentDraftToDpdPayload, sanitizeDpdRequestSnapshot } from "./dpdPayloadMapper.service.js";
import { validateDpdPayload } from "./dpdPayloadValidation.service.js";
import {
  DpdProviderConfigurationError,
  getDpdProviderConfiguration,
  type DpdProviderConfiguration,
  type DpdProviderMode
} from "./dpdProviderConfiguration.service.js";
import { saveLabelBuffer } from "./labelStorage.service.js";
import { buildPricingInputFromDraft, calculateShipmentPricingEstimate } from "./shipmentPricing.service.js";
import { assertPriceLockUnchanged } from "./shipmentCostEstimate.service.js";
import {
  renderSimulatedDpdLabelPdf,
  renderSwiftlineLabelPdf
} from "./shipmentLabelPdf.service.js";
import { ensureShipmentInvoiceForDraft } from "./shipmentInvoice.service.js";
import { notifyShipmentBooked } from "./shipmentBookedNotification.service.js";
import {
  allocateSwiftlineTrackingNumber,
  resolveStationCode
} from "./swiftlineTracking.service.js";
import {
  bookingSnapshotToLabelData,
  buildShipmentBookingSnapshot,
  readShipmentBookingSnapshot
} from "./shipmentBookingSnapshot.service.js";
import {
  completeShipmentBookingCharge,
  recordCounterShipmentCharge,
  markShipmentBookingChargeConsuming,
  markShipmentBookingChargeReviewRequired,
  releaseShipmentBookingCharge,
  reserveShipmentBookingCharge
} from "./shipmentBookingBilling.service.js";
import {
  beginShipmentDraftBooking,
  transitionShipmentDraftBooking
} from "./shipmentDraftPolicy.service.js";

export class DpdShipmentServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

function createIdempotencyKey(shipmentDraftId: mongoose.Types.ObjectId, bookingAttemptId: string) {
  return `SHIPMENT_BOOKING:${shipmentDraftId.toString()}:${bookingAttemptId}`;
}

/**
 * The price the booker was shown and accepted, from the cost estimate endpoint.
 *
 * Carried on both arms of the union so a client and an admin booking are held to
 * the same check. Optional because counter sales and seed scripts book drafts
 * that were never quoted, and there is no accepted price for those to differ from.
 */
type AcceptedPricing = { acceptedPricingHash?: string };

type LabelPaymentContext =
  | ({
      // ADMIN_DIRECT is a walk-in booked at the counter: the customer has already
      // paid into a company account, so there is no credit to reserve. Staying in
      // the admin arm of this union keeps clients unable to book one.
      actor: "admin";
      paymentSource?: Extract<PaymentSource, "BUSINESS_ACCOUNT" | "ADMIN_DIRECT" | "TEST">;
      bookingProvider?: ShipmentBookingProvider;
    } & AcceptedPricing)
  | ({
      actor: "client";
      paymentSource: Extract<PaymentSource, "BUSINESS_ACCOUNT">;
      bookingProvider?: ShipmentBookingProvider;
    } & AcceptedPricing);

function getShippingEnvironment(mode: DpdProviderMode): ShippingEnvironment {
  return mode === "LIVE" ? "PRODUCTION" : "MOCK";
}

function normalizePaymentContext(context?: LabelPaymentContext): LabelPaymentContext {
  return context ?? { actor: "admin", paymentSource: "BUSINESS_ACCOUNT" };
}

const swiftlineProviderConfiguration: DpdProviderConfiguration = {
  mode: "SIMULATED",
  active: true,
  apiBaseUrl: "",
  businessUnitCode: "SWIFTLINE",
  customerId: "SWIFTLINE",
  senderAddressId: "SWIFTLINE",
  depotCode: "",
  defaultServiceCode: "SWIFTLINE",
  defaultLabelSize: "A6",
  defaultPrintFormat: "PDF",
  credentials: {}
};

function toPaymentError(error: unknown) {
  if (!(error instanceof Error)) return null;

  if (error.message === "BOOKING_RATE_NOT_FOUND") {
    return new DpdShipmentServiceError(
      "Rates are not available for the selected destination, service, or box weight. Please contact your assigned branch.",
      409
    );
  }

  if (error.message === "INSUFFICIENT_BOOKING_CAPACITY") {
    return new DpdShipmentServiceError(
      "Available Customer Advance and credit are not sufficient to book this shipment. Contact your assigned branch.",
      402
    );
  }

  if (error.message === "OVERDUE_BOOKING_BLOCKED") {
    return new DpdShipmentServiceError(
      "Bookings are blocked because the maximum overdue period has been exceeded. Contact your assigned branch.",
      409
    );
  }

  if (error.message === "OVERDUE_CREDIT_USAGE_BLOCKED") {
    return new DpdShipmentServiceError(
      "Credit usage is blocked because a billing statement is overdue. Pay the overdue statement or add enough Customer Advance to book this shipment.",
      409
    );
  }

  if (error.message === "BOOKING_AMOUNT_INVALID") {
    return new DpdShipmentServiceError("The shipment charge could not be calculated. Check the shipment rate and parcel details.", 409);
  }

  return null;
}

async function writeDpdAuditLog(
  action: "DPD_REQUEST_INITIATED" | "DPD_REQUEST_SUCCEEDED" | "DPD_REQUEST_FAILED",
  dpdShipmentId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId,
  metadata: Record<string, unknown>
) {
  await AuditLog.create({
    action,
    entityType: "DPD_SHIPMENT",
    entityId: dpdShipmentId,
    performedBy: userId,
    performedAt: new Date(),
    metadata
  });
}

async function getReusableShipment(existingShipment: IDpdShipment | null, expectedParcelCount: number) {
  if (!existingShipment) return null;

  if (existingShipment.status === "LABEL_RECEIVED") {
    const labels = await LabelDocument.find({ dpdShipmentId: existingShipment._id }).lean().exec();
    const dpdLabelCount = labels.filter((label) => label.labelType === "DPD").length;
    const swiftlineLabelCount = labels.filter((label) => label.labelType === "SWIFTLINE").length;
    const expectedDpdLabelCount = existingShipment.bookingProvider === "SWIFTLINE" ? 0 : expectedParcelCount;
    if (dpdLabelCount !== expectedDpdLabelCount || swiftlineLabelCount !== expectedParcelCount) {
      throw new DpdShipmentServiceError(
        "This booking exists, but its label set is incomplete. Contact Swiftline Operations; do not book it again.",
        409
      );
    }
    return {
      dpdShipment: existingShipment,
      labels,
      reused: true
    };
  }

  if (existingShipment.status === "DPD_CREATING") {
    throw new DpdShipmentServiceError("A DPD label request is already processing for this shipment.", 409);
  }

  if (existingShipment.status === "DPD_STATUS_UNKNOWN") {
    throw new DpdShipmentServiceError("The result of this request is uncertain. Do not submit it again.", 409);
  }

  if (existingShipment.status === "DPD_CREATED") {
    throw new DpdShipmentServiceError(
      "The carrier accepted this booking, but final documents require reconciliation. Contact Swiftline Operations; do not book it again.",
      409
    );
  }

  return null;
}

// Exported so the demo seeder can produce labels through the same storage path
// as a real booking — same checksum, storage layout and version numbering.
export async function storeGeneratedLabel(input: {
  dpdShipmentId: mongoose.Types.ObjectId;
  parcelNumber: string;
  labelType: LabelType;
  providerMode: DpdProviderMode;
  buffer: Buffer;
}) {
  const existing = await LabelDocument.findOne({
    dpdShipmentId: input.dpdShipmentId,
    labelType: input.labelType,
    parcelNumber: input.parcelNumber
  }).select("labelVersion").lean().exec();

  // Labels are stored under the draft, not the booking, so everything belonging
  // to one shipment shares a prefix. Every caller has the booking rather than
  // the draft, so the id is resolved here instead of being threaded through all
  // twelve call sites.
  const booking = await DpdShipment.findById(input.dpdShipmentId)
    .select("shipmentDraftId")
    .lean()
    .exec();
  if (!booking) {
    throw new DpdShipmentServiceError("The booking this label belongs to no longer exists.", 404);
  }

  const stored = await saveLabelBuffer({
    shipmentDraftId: booking.shipmentDraftId.toString(),
    parcelNumber: input.parcelNumber,
    buffer: input.buffer,
    format: "PDF",
    labelSize: "A6",
    labelType: input.labelType
  });

  return LabelDocument.findOneAndUpdate(
    {
      dpdShipmentId: input.dpdShipmentId,
      labelType: input.labelType,
      parcelNumber: input.parcelNumber
    },
    {
      dpdShipmentId: input.dpdShipmentId,
      parcelNumber: input.parcelNumber,
      labelType: input.labelType,
      providerMode: input.providerMode,
      format: "PDF",
      labelSize: "A6",
      storageKey: stored.storageKey,
      fileChecksum: stored.fileChecksum,
      generatedAt: new Date(),
      labelVersion: (existing?.labelVersion ?? 0) + 1
    },
    { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }
  ).exec();
}

function simulatedParcelNumber(trackingNumber: string, parcelIndex: number) {
  return `DPDTEST${trackingNumber.slice(2)}${String(parcelIndex + 1).padStart(2, "0")}`;
}

export async function createLabelForShipmentDraft(
  shipmentDraftId: string,
  userId: mongoose.Types.ObjectId,
  paymentContextInput?: LabelPaymentContext
) {
  const paymentContext = normalizePaymentContext(paymentContextInput);
  const bookingProvider = paymentContext.bookingProvider ?? "DPD";
  // Only account-backed bookings reserve capacity. TEST never did; ADMIN_DIRECT is
  // a counter sale that was paid before the booking was made, so there is nothing
  // to reserve, convert or release for it.
  const usesBusinessAccountBilling = paymentContext.paymentSource !== "TEST"
    && paymentContext.paymentSource !== "ADMIN_DIRECT";
  const draft = await ShipmentDraft.findById(shipmentDraftId).exec();
  if (!draft) throw new DpdShipmentServiceError("Shipment draft not found", 404);

  const invoiceUpload = await InvoiceUpload.findById(draft.invoiceUploadId).exec();
  if (!invoiceUpload) throw new DpdShipmentServiceError("Invoice upload not found", 404);

  const existingByDraft = await DpdShipment.findOne({ shipmentDraftId: draft._id }).exec();
  const reusable = await getReusableShipment(existingByDraft, draft.parcelList.length);

  if (reusable) {
    draft.bookingState = "BOOKED";
    draft.lockedAt = draft.lockedAt ?? reusable.dpdShipment.createdAt;
    await draft.save();

    try {
      const shipmentInvoice = await ensureShipmentInvoiceForDraft({
        shipmentDraftId: draft._id as mongoose.Types.ObjectId,
        dpdShipmentId: reusable.dpdShipment._id as mongoose.Types.ObjectId,
        userId
      });
      return { ...reusable, shipmentInvoice };
    } catch (error) {
      draft.bookingState = "REVIEW_REQUIRED";
      await draft.save();
      console.error("Unable to reconcile the shipment invoice for an existing booking.", error);
      throw new DpdShipmentServiceError(
        "This shipment is booked, but its invoice requires reconciliation. Contact Swiftline Operations; do not book it again.",
        409
      );
    }
  }

  const validationIssues = validateShipmentDraftFields(draft, { requireValidatedAddress: true });
  if (validationIssues.length) {
    draft.validationIssues = validationIssues;
    draft.status = "VALIDATION_FAILED";
    await draft.save();

    throw new DpdShipmentServiceError("Some shipment information must be corrected before creating the shipment.", 400, {
      validationIssues
    });
  }

  const [branch, businessAccount] = await Promise.all([
    Branch.findById(draft.branchId).exec(),
    BusinessAccount.findById(draft.businessAccountId).exec()
  ]);
  if (!branch) throw new DpdShipmentServiceError("The shipment branch could not be found.", 409);
  if (!businessAccount) throw new DpdShipmentServiceError("The business account could not be found.", 409);

  let configuration = swiftlineProviderConfiguration;
  if (bookingProvider === "DPD") {
    try {
      configuration = getDpdProviderConfiguration();
    } catch (error) {
      if (error instanceof DpdProviderConfigurationError) {
        throw new DpdShipmentServiceError(error.message, 503);
      }
      throw error;
    }
  }

  let stationCode: string;
  try {
    stationCode = resolveStationCode(branch.labelCode, branch.code);
  } catch {
    throw new DpdShipmentServiceError(
      "The assigned branch needs a valid three-letter station code before shipments can be booked.",
      409
    );
  }

  const bookingAttemptId = crypto.randomUUID();
  const lockedDraft = await beginShipmentDraftBooking({ draft, bookingAttemptId });
  const idempotencyKey = createIdempotencyKey(
    lockedDraft._id as mongoose.Types.ObjectId,
    bookingAttemptId
  );
  const payload = mapShipmentDraftToDpdPayload(lockedDraft, invoiceUpload, configuration);
  if (bookingProvider === "SWIFTLINE") payload.serviceCode = "SWIFTLINE";
  const dpdPayloadIssues = validateDpdPayload(payload, configuration);
  if (dpdPayloadIssues.length) {
    lockedDraft.validationIssues = dpdPayloadIssues;
    lockedDraft.status = "VALIDATION_FAILED";
    await lockedDraft.save();
    await transitionShipmentDraftBooking({
      shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
      bookingAttemptId,
      bookingState: "EDITABLE"
    });

    throw new DpdShipmentServiceError("Some carrier-required information must be corrected before booking this shipment.", 400, {
      validationIssues: dpdPayloadIssues
    });
  }

  const pricing = await calculateShipmentPricingEstimate(buildPricingInputFromDraft(lockedDraft));
  if (pricing.missingRate) {
    await transitionShipmentDraftBooking({
      shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
      bookingAttemptId,
      bookingState: "EDITABLE"
    });
    throw new DpdShipmentServiceError(
      `Rates are not available for ${lockedDraft.consigneeEnteredAddress.countryName || lockedDraft.consigneeEnteredAddress.countryCode} with ${lockedDraft.serviceType === "CARGO" ? "Cargo" : "Courier"} service. Please contact ${branch.name} to arrange this shipment.`,
      409
    );
  }

  // Checked before anything is reserved or sent to the carrier, so a shipment
  // whose price moved is stopped while it is still cleanly abandonable. The draft
  // is returned to EDITABLE and the booker is shown what changed.
  try {
    assertPriceLockUnchanged({
      acceptedPricingHash: paymentContext.acceptedPricingHash,
      currentPricing: pricing,
      requireAcceptedPricing: usesBusinessAccountBilling
    });
  } catch (error) {
    await transitionShipmentDraftBooking({
      shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
      bookingAttemptId,
      bookingState: "EDITABLE"
    });
    throw error;
  }

  let advanceAmountMinor = 0;
  let creditAmountMinor = Math.round(pricing.totalAmount * 100);
  try {
    if (usesBusinessAccountBilling) {
      const reservationResult = await reserveShipmentBookingCharge({
        draft: lockedDraft,
        createdBy: userId,
        bookingAttemptId,
        pricing
      });
      advanceAmountMinor = reservationResult.reservation?.advanceAmountMinor ?? 0;
      creditAmountMinor = reservationResult.reservation?.creditAmountMinor ?? creditAmountMinor;
    } else if (paymentContext.paymentSource === "ADMIN_DIRECT") {
      // Already paid at the counter. Record the charge so the amendment and
      // cancellation flows have one to read, and treat the whole amount as
      // settled so the invoice is issued PAID rather than as credit owed.
      await recordCounterShipmentCharge({ draft: lockedDraft, pricing });
      advanceAmountMinor = Math.round(pricing.totalAmount * 100);
      creditAmountMinor = 0;
    }
  } catch (error) {
    await transitionShipmentDraftBooking({
      shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
      bookingAttemptId,
      bookingState: "EDITABLE"
    });
    const paymentError = toPaymentError(error);
    if (paymentError) throw paymentError;
    throw error;
  }

  const requestSnapshot = sanitizeDpdRequestSnapshot(payload);
  let dpdShipment: IDpdShipment | null = null;
  try {
    dpdShipment = await DpdShipment.findOneAndUpdate(
      { shipmentDraftId: lockedDraft._id },
      {
        shipmentDraftId: lockedDraft._id,
        idempotencyKey,
        serviceCode: payload.serviceCode,
        requestSnapshot,
        responseSnapshot: {},
        parcelNumbers: [],
        bookingProvider,
        providerMode: configuration.mode,
        paymentSource: paymentContext.paymentSource ?? "BUSINESS_ACCOUNT",
        shippingEnvironment: getShippingEnvironment(configuration.mode),
        status: "DPD_CREATING"
      },
      { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).exec();
  } catch (error) {
    if (usesBusinessAccountBilling) {
      await releaseShipmentBookingCharge({
        shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
        createdBy: userId
      });
    }
    await transitionShipmentDraftBooking({
      shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
      bookingAttemptId,
      bookingState: "EDITABLE"
    });
    throw error;
  }

  if (!dpdShipment) {
    if (usesBusinessAccountBilling) {
      await releaseShipmentBookingCharge({
        shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
        createdBy: userId
      });
    }
    await transitionShipmentDraftBooking({
      shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
      bookingAttemptId,
      bookingState: "EDITABLE"
    });
    throw new DpdShipmentServiceError("Unable to start shipment creation.", 500);
  }

  let providerAccepted = false;

  try {
    await writeDpdAuditLog("DPD_REQUEST_INITIATED", dpdShipment._id as mongoose.Types.ObjectId, userId, {
      idempotencyKey,
      shipmentDraftId: lockedDraft._id
    });

    if (usesBusinessAccountBilling) {
      await markShipmentBookingChargeConsuming(lockedDraft._id as mongoose.Types.ObjectId);
    }

    const generatedAt = new Date();
    const trackingNumber = dpdShipment.swiftlineTrackingNumber || await allocateSwiftlineTrackingNumber({
      stationCode,
      date: generatedAt
    });
    dpdShipment.swiftlineTrackingNumber = trackingNumber;

    let response: DpdCreateShipmentResponse;
    const dpdLabelBuffers: Array<{ parcelNumber: string; buffer: Buffer }> = [];

    if (bookingProvider === "SWIFTLINE") {
      response = {
        dpdShipmentId: "",
        dpdTransactionId: "",
        parcelNumbers: [],
        labels: [],
        labelBase64: "",
        rawResponse: { mode: "SWIFTLINE", notice: "Internal Swiftline shipment" }
      };
    } else if (configuration.mode === "SIMULATED") {
      const parcelNumbers = payload.parcels.map((_, index) => simulatedParcelNumber(trackingNumber, index));
      response = {
        dpdShipmentId: `TEST-${trackingNumber}`,
        dpdTransactionId: `SIM-${trackingNumber}`,
        parcelNumbers,
        labels: [],
        labelBase64: "",
        rawResponse: {
          mode: "SIMULATED",
          notice: "TEST - NOT FOR CARRIAGE",
          parcelNumbers
        }
      };
    } else {
      response = await createDpdShipment(configuration, payload, idempotencyKey);
      // A successful carrier response may represent a real booking even if the
      // local adapter cannot finish parsing it. Such responses require review.
      providerAccepted = true;
      if (!response.dpdShipmentId) {
        throw new DpdApiError("DPD accepted the request but did not return a shipment number.", 502, response.rawResponse);
      }
      for (const label of response.labels) {
        dpdLabelBuffers.push({
          parcelNumber: label.parcelNumber,
          buffer: Buffer.from(label.labelBase64, "base64")
        });
      }
    }

    providerAccepted = true;

    if (bookingProvider === "DPD" && (
      response.parcelNumbers.length !== payload.parcels.length
      || new Set(response.parcelNumbers).size !== payload.parcels.length
    )) {
      throw new Error("CARRIER_PARCEL_SET_INCOMPLETE");
    }

    const bookingSnapshot = buildShipmentBookingSnapshot({
      draft: lockedDraft,
      invoiceUpload,
      account: businessAccount,
      branch,
      pricing,
      serviceCode: payload.serviceCode,
      bookedAt: generatedAt,
      swiftlineTrackingNumber: trackingNumber,
      carrierShipmentId: response.dpdShipmentId,
      carrierTransactionId: response.dpdTransactionId,
      carrierParcelNumbers: response.parcelNumbers,
      providerMode: configuration.mode,
      advanceAmountMinor,
      creditAmountMinor
    });

    if (bookingProvider === "DPD" && configuration.mode === "SIMULATED") {
      for (let index = 0; index < bookingSnapshot.parcels.length; index += 1) {
        const labelData = bookingSnapshotToLabelData(bookingSnapshot, index, "DPD");
        dpdLabelBuffers.push({
          parcelNumber: labelData.parcelNumber,
          buffer: await renderSimulatedDpdLabelPdf(labelData)
        });
      }
    }

    const dpdLabelsByParcelNumber = new Map(dpdLabelBuffers.map((label) => [label.parcelNumber, label]));
    const orderedDpdLabelBuffers = bookingProvider === "DPD"
      ? response.parcelNumbers.map((parcelNumber) => dpdLabelsByParcelNumber.get(parcelNumber))
      : [];
    if (bookingProvider === "DPD" && (
      dpdLabelBuffers.length !== payload.parcels.length
      || dpdLabelsByParcelNumber.size !== payload.parcels.length
      || orderedDpdLabelBuffers.some((label) => !label)
    )) {
      throw new Error("CARRIER_LABEL_SET_INCOMPLETE");
    }

    dpdShipment.dpdShipmentId = response.dpdShipmentId;
    dpdShipment.dpdTransactionId = response.dpdTransactionId;
    dpdShipment.parcelNumbers = response.parcelNumbers;
    dpdShipment.responseSnapshot = response.rawResponse;
    dpdShipment.bookingSnapshot = bookingSnapshot;
    dpdShipment.currentShipmentSnapshot = bookingSnapshot;
    dpdShipment.snapshotRevision = 1;
    dpdShipment.status = "DPD_CREATED";
    await dpdShipment.save();

    if (bookingProvider === "DPD" && !dpdLabelBuffers.length) {
      throw new Error("DPD_LABEL_NOT_RETURNED");
    }

    const labels = [];
    for (const item of orderedDpdLabelBuffers) {
      if (!item) continue;
      const label = await storeGeneratedLabel({
        dpdShipmentId: dpdShipment._id as mongoose.Types.ObjectId,
        parcelNumber: item.parcelNumber,
        labelType: "DPD",
        providerMode: configuration.mode,
        buffer: item.buffer
      });
      if (label) labels.push(label);
    }

    for (let index = 0; index < payload.parcels.length; index += 1) {
      const labelData = bookingSnapshotToLabelData(bookingSnapshot, index, "SWIFTLINE");
      const label = await storeGeneratedLabel({
        dpdShipmentId: dpdShipment._id as mongoose.Types.ObjectId,
        parcelNumber: labelData.parcelNumber,
        labelType: "SWIFTLINE",
        providerMode: configuration.mode,
        buffer: await renderSwiftlineLabelPdf(labelData)
      });
      if (label) labels.push(label);
    }

    const dpdLabelCount = labels.filter((label) => label.labelType === "DPD").length;
    const swiftlineLabelCount = labels.filter((label) => label.labelType === "SWIFTLINE").length;
    const expectedDpdLabelCount = bookingProvider === "DPD" ? payload.parcels.length : 0;
    if (dpdLabelCount !== expectedDpdLabelCount || swiftlineLabelCount !== payload.parcels.length) {
      throw new Error("SHIPMENT_LABEL_SET_INCOMPLETE");
    }

    dpdShipment.status = "LABEL_RECEIVED";
    await dpdShipment.save();

    await writeDpdAuditLog("DPD_REQUEST_SUCCEEDED", dpdShipment._id as mongoose.Types.ObjectId, userId, {
      dpdShipmentId: response.dpdShipmentId,
      parcelNumbers: response.parcelNumbers,
      providerMode: configuration.mode,
      bookingProvider,
      swiftlineTrackingNumber: trackingNumber,
      dpdLabelCount,
      swiftlineLabelCount
    });

    if (usesBusinessAccountBilling) {
      await completeShipmentBookingCharge({
        shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
        dpdShipmentId: dpdShipment._id as mongoose.Types.ObjectId,
        createdBy: userId
      });
    }

    const shipmentInvoice = await ensureShipmentInvoiceForDraft({
      shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
      dpdShipmentId: dpdShipment._id as mongoose.Types.ObjectId,
      userId
    });
    if (!shipmentInvoice) throw new Error("SHIPMENT_INVOICE_NOT_CREATED");

    await transitionShipmentDraftBooking({
      shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
      bookingAttemptId,
      bookingState: "BOOKED"
    });

    // Queues the client and operations emails with the invoice and labels
    // attached. Swallows its own errors: the booking is complete and must not be
    // undone or retried because a notification could not be raised.
    await notifyShipmentBooked({
      draft: lockedDraft,
      dpdShipment,
      shipmentInvoice,
      bookedBy: userId
    });

    return {
      dpdShipment,
      labels,
      shipmentInvoice,
      reused: false
    };
  } catch (error) {
    if (error instanceof DpdTimeoutError) {
      dpdShipment.status = "DPD_STATUS_UNKNOWN";
      dpdShipment.responseSnapshot = { message: error.message };
      await dpdShipment.save();

      await writeDpdAuditLog("DPD_REQUEST_FAILED", dpdShipment._id as mongoose.Types.ObjectId, userId, {
        status: "DPD_STATUS_UNKNOWN",
        message: error.message
      });

      if (usesBusinessAccountBilling) {
        await markShipmentBookingChargeReviewRequired({
          shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
          dpdShipmentId: dpdShipment._id as mongoose.Types.ObjectId,
          createdBy: userId
        });
      }

      await transitionShipmentDraftBooking({
        shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
        bookingAttemptId,
        bookingState: "REVIEW_REQUIRED"
      });

      throw new DpdShipmentServiceError(error.message, 409);
    }

    if (providerAccepted) {
      const message = bookingProvider === "DPD"
        ? "The carrier booking succeeded, but its invoice or labels could not be finalized. Do not submit the shipment again; contact Swiftline Operations."
        : "The shipment was created, but its invoice or Swiftline labels could not be finalized. Do not submit it again; contact Swiftline Operations.";
      dpdShipment.status = "DPD_CREATED";
      dpdShipment.responseSnapshot = {
        ...dpdShipment.responseSnapshot,
        localLabelError: error instanceof Error ? error.message : "Unknown label error"
      };
      await dpdShipment.save();

      await writeDpdAuditLog("DPD_REQUEST_FAILED", dpdShipment._id as mongoose.Types.ObjectId, userId, {
        status: "DPD_CREATED",
        providerAccepted: true,
        message
      });

      if (usesBusinessAccountBilling) {
        await markShipmentBookingChargeReviewRequired({
          shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
          dpdShipmentId: dpdShipment._id as mongoose.Types.ObjectId,
          createdBy: userId
        });
      }

      await transitionShipmentDraftBooking({
        shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
        bookingAttemptId,
        bookingState: "REVIEW_REQUIRED"
      });

      throw new DpdShipmentServiceError(message, 409);
    }

    const message = error instanceof DpdApiError
      ? error.message
      : bookingProvider === "DPD"
        ? "DPD is temporarily unavailable."
        : "The Swiftline shipment could not be created.";

    dpdShipment.status = "DPD_REJECTED";
    dpdShipment.responseSnapshot = error instanceof DpdApiError
      ? error.providerResponse
      : { message };
    await dpdShipment.save();

    await writeDpdAuditLog("DPD_REQUEST_FAILED", dpdShipment._id as mongoose.Types.ObjectId, userId, {
      status: "DPD_REJECTED",
      message
    });

    if (usesBusinessAccountBilling) {
      await releaseShipmentBookingCharge({
        shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
        dpdShipmentId: dpdShipment._id as mongoose.Types.ObjectId,
        createdBy: userId
      });
    }

    await transitionShipmentDraftBooking({
      shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
      bookingAttemptId,
      bookingState: "EDITABLE"
    });

    throw new DpdShipmentServiceError(message, error instanceof DpdApiError ? error.statusCode : 502);
  }
}

export async function reconcileShipmentDocuments(
  dpdShipmentId: string,
  userId: mongoose.Types.ObjectId
) {
  if (!mongoose.Types.ObjectId.isValid(dpdShipmentId)) {
    throw new DpdShipmentServiceError("Shipment booking not found.", 404);
  }

  const dpdShipment = await DpdShipment.findById(dpdShipmentId).exec();
  if (!dpdShipment) throw new DpdShipmentServiceError("Shipment booking not found.", 404);
  if (dpdShipment.status === "LABEL_RECEIVED") {
    const labels = await LabelDocument.find({ dpdShipmentId: dpdShipment._id }).exec();
    const shipmentInvoice = await ensureShipmentInvoiceForDraft({
      shipmentDraftId: dpdShipment.shipmentDraftId,
      dpdShipmentId: dpdShipment._id as mongoose.Types.ObjectId,
      userId
    });
    return { dpdShipment, labels, shipmentInvoice, reused: true };
  }
  if (dpdShipment.status !== "DPD_CREATED") {
    throw new DpdShipmentServiceError(
      "This booking cannot be finalized until its carrier outcome is confirmed.",
      409
    );
  }

  const snapshot = readShipmentBookingSnapshot(dpdShipment.currentShipmentSnapshot)
    ?? readShipmentBookingSnapshot(dpdShipment.bookingSnapshot);
  if (!snapshot) {
    throw new DpdShipmentServiceError(
      "The accepted carrier booking is missing its locked shipment snapshot. Contact technical support before taking further action.",
      409
    );
  }

  const existingLabels = await LabelDocument.find({ dpdShipmentId: dpdShipment._id }).exec();
  const expectedLabelVersion = dpdShipment.snapshotRevision || 1;
  const requiresDpdLabels = dpdShipment.bookingProvider !== "SWIFTLINE";

  for (let index = 0; index < snapshot.parcels.length; index += 1) {
    const carrierParcelNumber = snapshot.parcels[index]?.carrierParcelNumber ?? "";
    const swiftlineParcelNumber = snapshot.parcels[index]?.swiftlineParcelNumber ?? "";
    const hasDpdLabel = existingLabels.some((label) => (
      label.labelType === "DPD"
      && label.parcelNumber === carrierParcelNumber
      && label.labelVersion === expectedLabelVersion
    ));
    const hasSwiftlineLabel = existingLabels.some((label) => (
      label.labelType === "SWIFTLINE"
      && label.parcelNumber === swiftlineParcelNumber
      && label.labelVersion === expectedLabelVersion
    ));

    if (requiresDpdLabels && !hasDpdLabel) {
      if (dpdShipment.providerMode !== "SIMULATED") {
        throw new DpdShipmentServiceError(
          "The live DPD booking is missing a carrier label. Retrieve it from DPD before completing reconciliation.",
          409
        );
      }
      const labelData = bookingSnapshotToLabelData(snapshot, index, "DPD");
      await storeGeneratedLabel({
        dpdShipmentId: dpdShipment._id as mongoose.Types.ObjectId,
        parcelNumber: labelData.parcelNumber,
        labelType: "DPD",
        providerMode: dpdShipment.providerMode,
        buffer: await renderSimulatedDpdLabelPdf(labelData)
      });
    }

    if (!hasSwiftlineLabel) {
      const labelData = bookingSnapshotToLabelData(snapshot, index, "SWIFTLINE");
      await storeGeneratedLabel({
        dpdShipmentId: dpdShipment._id as mongoose.Types.ObjectId,
        parcelNumber: labelData.parcelNumber,
        labelType: "SWIFTLINE",
        providerMode: dpdShipment.providerMode,
        buffer: await renderSwiftlineLabelPdf(labelData)
      });
    }
  }

  const labels = await LabelDocument.find({
    dpdShipmentId: dpdShipment._id,
    labelVersion: expectedLabelVersion
  }).exec();
  const dpdLabelCount = labels.filter((label) => label.labelType === "DPD").length;
  const swiftlineLabelCount = labels.filter((label) => label.labelType === "SWIFTLINE").length;
  const expectedDpdLabelCount = requiresDpdLabels ? snapshot.parcels.length : 0;
  if (dpdLabelCount !== expectedDpdLabelCount || swiftlineLabelCount !== snapshot.parcels.length) {
    throw new DpdShipmentServiceError("The complete parcel label set could not be finalized.", 409);
  }

  await completeShipmentBookingCharge({
    shipmentDraftId: dpdShipment.shipmentDraftId,
    dpdShipmentId: dpdShipment._id as mongoose.Types.ObjectId,
    createdBy: userId
  });
  const shipmentInvoice = await ensureShipmentInvoiceForDraft({
    shipmentDraftId: dpdShipment.shipmentDraftId,
    dpdShipmentId: dpdShipment._id as mongoose.Types.ObjectId,
    userId
  });

  dpdShipment.status = "LABEL_RECEIVED";
  await dpdShipment.save();
  await ShipmentDraft.updateOne(
    { _id: dpdShipment.shipmentDraftId, bookingState: "REVIEW_REQUIRED" },
    { $set: { bookingState: "BOOKED", lockedAt: new Date() } },
    { runValidators: true }
  ).exec();
  await writeDpdAuditLog("DPD_REQUEST_SUCCEEDED", dpdShipment._id as mongoose.Types.ObjectId, userId, {
    reconciled: true,
    dpdLabelCount,
    swiftlineLabelCount
  });

  return { dpdShipment, labels, shipmentInvoice, reused: false };
}

export async function regenerateSimulatedShipmentLabels(
  dpdShipmentId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId
) {
  const dpdShipment = await DpdShipment.findById(dpdShipmentId).exec();
  if (!dpdShipment) throw new DpdShipmentServiceError("Shipment booking not found.", 404);
  if (dpdShipment.providerMode !== "SIMULATED") {
    throw new DpdShipmentServiceError(
      "Live DPD shipment changes require carrier confirmation before labels can be replaced.",
      409
    );
  }

  const snapshot = readShipmentBookingSnapshot(dpdShipment.currentShipmentSnapshot)
    ?? readShipmentBookingSnapshot(dpdShipment.bookingSnapshot);
  if (!snapshot) throw new DpdShipmentServiceError("The current shipment snapshot is unavailable.", 409);

  for (let index = 0; index < snapshot.parcels.length; index += 1) {
    const swiftlineLabelData = bookingSnapshotToLabelData(snapshot, index, "SWIFTLINE");
    if (dpdShipment.bookingProvider !== "SWIFTLINE") {
      const dpdLabelData = bookingSnapshotToLabelData(snapshot, index, "DPD");
      await storeGeneratedLabel({
        dpdShipmentId,
        parcelNumber: dpdLabelData.parcelNumber,
        labelType: "DPD",
        providerMode: "SIMULATED",
        buffer: await renderSimulatedDpdLabelPdf(dpdLabelData)
      });
    }
    await storeGeneratedLabel({
      dpdShipmentId,
      parcelNumber: swiftlineLabelData.parcelNumber,
      labelType: "SWIFTLINE",
      providerMode: "SIMULATED",
      buffer: await renderSwiftlineLabelPdf(swiftlineLabelData)
    });
  }

  const labels = await LabelDocument.find({
    dpdShipmentId,
    labelVersion: dpdShipment.snapshotRevision || 1
  }).exec();
  const expectedDpdLabelCount = dpdShipment.bookingProvider === "SWIFTLINE" ? 0 : snapshot.parcels.length;
  if (
    labels.filter((label) => label.labelType === "DPD").length !== expectedDpdLabelCount
    || labels.filter((label) => label.labelType === "SWIFTLINE").length !== snapshot.parcels.length
  ) {
    throw new DpdShipmentServiceError("The amended parcel label set could not be finalized.", 409);
  }

  dpdShipment.status = "LABEL_RECEIVED";
  await dpdShipment.save();
  await ShipmentDraft.updateOne(
    { _id: dpdShipment.shipmentDraftId },
    { $set: { bookingState: "BOOKED", lockedAt: new Date() } },
    { runValidators: true }
  ).exec();
  await writeDpdAuditLog("DPD_REQUEST_SUCCEEDED", dpdShipmentId, userId, {
    labelsRegenerated: true,
    snapshotRevision: dpdShipment.snapshotRevision,
    parcelCount: snapshot.parcels.length
  });
  return labels;
}

export async function resetSimulatedBookingForDevelopment(
  shipmentDraftId: string,
  userId: mongoose.Types.ObjectId
) {
  if (process.env.NODE_ENV === "production") {
    throw new DpdShipmentServiceError("Development booking reset is unavailable in production.", 404);
  }
  if (!mongoose.Types.ObjectId.isValid(shipmentDraftId)) {
    throw new DpdShipmentServiceError("Shipment draft not found.", 404);
  }

  const draft = await ShipmentDraft.findById(shipmentDraftId).exec();
  if (!draft) throw new DpdShipmentServiceError("Shipment draft not found.", 404);
  const dpdShipment = await DpdShipment.findOne({ shipmentDraftId }).exec();
  if (!dpdShipment) {
    if (draft.bookingState !== "BOOKING") {
      throw new DpdShipmentServiceError("No incomplete simulated booking attempt was found.", 409);
    }
    await releaseShipmentBookingCharge({
      shipmentDraftId: draft._id as mongoose.Types.ObjectId,
      createdBy: userId
    });
    draft.bookingState = "EDITABLE";
    draft.bookingAttemptId = "";
    draft.lockedAt = null;
    await draft.save();
    return null;
  }
  const labelCount = await LabelDocument.countDocuments({ dpdShipmentId: dpdShipment._id }).exec();
  const carrierAccepted = Boolean(dpdShipment.dpdShipmentId || dpdShipment.parcelNumbers.length || labelCount);
  if (dpdShipment.providerMode !== "SIMULATED" || carrierAccepted || dpdShipment.status === "LABEL_RECEIVED") {
    throw new DpdShipmentServiceError(
      "This booking cannot be reset because carrier or label data already exists.",
      409
    );
  }

  await releaseShipmentBookingCharge({
    shipmentDraftId: dpdShipment.shipmentDraftId,
    dpdShipmentId: dpdShipment._id as mongoose.Types.ObjectId,
    createdBy: userId
  });
  dpdShipment.status = "DPD_REJECTED";
  dpdShipment.responseSnapshot = { developmentResetAt: new Date(), resetBy: userId };
  await dpdShipment.save();
  await ShipmentDraft.updateOne(
    { _id: dpdShipment.shipmentDraftId, bookingState: { $in: ["BOOKING", "REVIEW_REQUIRED"] } },
    { $set: { bookingState: "EDITABLE", bookingAttemptId: null, lockedAt: null } },
    { runValidators: true }
  ).exec();

  await writeDpdAuditLog("DPD_REQUEST_FAILED", dpdShipment._id as mongoose.Types.ObjectId, userId, {
    developmentReset: true,
    shipmentDraftId: dpdShipment.shipmentDraftId
  });

  return dpdShipment;
}
