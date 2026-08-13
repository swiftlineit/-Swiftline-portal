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
import { LabelDocument, type LabelFormat, type LabelType } from "../models/labelDocument.model.js";
import { ShipmentDraft } from "../models/shipmentDraft.model.js";
import type { PaymentSource, ShippingEnvironment } from "../models/financialTypes.js";
import { validateShipmentDraftFields } from "./shipmentValidation.service.js";
import {
  DpdApiError,
  DpdTimeoutError,
  createDpdShipment,
  readCarrierErrors,
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
    public readonly details: Record<string, unknown> = {},
    /**
     * The carrier's own rejection text.
     *
     * Kept off `details` because both the staff and the client controller spread
     * `details` straight into their response, and a customer must not be shown
     * ALS's internal wording. Only the staff controller reads this.
     */
    public readonly carrierErrors: string[] = []
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
  als: {
    serviceCode: "DPD UK NEXTDAY"
  },
  credentials: {}
};

/**
 * Whether a carrier label set is complete for this booking.
 *
 * A live ALS booking has been observed returning one combined HTML document
 * holding a printable page per parcel, and its documentation leaves open that a
 * multi-parcel booking may come back as one label per parcel instead. Both are
 * accepted: asserting a single shape would push an otherwise good live booking
 * into the reconciliation path, where the customer's money stays reserved and
 * the shipment cannot be completed. Simulated mode always renders one PDF per
 * parcel locally, so there the count is exact.
 */
export function isCompleteDpdLabelSet(input: {
  bookingProvider: ShipmentBookingProvider;
  providerMode: DpdProviderMode;
  parcelCount: number;
  labelCount: number;
}) {
  if (input.bookingProvider === "SWIFTLINE") return input.labelCount === 0;
  if (input.providerMode === "LIVE") {
    return input.labelCount === 1 || input.labelCount === input.parcelCount;
  }
  return input.labelCount === input.parcelCount;
}

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

/**
 * A booking attempt is recorded against the draft until the carrier answers,
 * because a rejected attempt never creates a booking record to hang it off.
 * Once a record exists the trail continues against that instead.
 */
async function writeDpdAuditLog(
  action: "DPD_REQUEST_INITIATED" | "DPD_REQUEST_SUCCEEDED" | "DPD_REQUEST_FAILED",
  entityId: mongoose.Types.ObjectId,
  entityType: "DPD_SHIPMENT" | "SHIPMENT_DRAFT",
  userId: mongoose.Types.ObjectId,
  metadata: Record<string, unknown>
) {
  await AuditLog.create({
    action,
    entityType,
    entityId,
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
    const completeDpdLabelSet = isCompleteDpdLabelSet({
      bookingProvider: existingShipment.bookingProvider,
      providerMode: existingShipment.providerMode,
      parcelCount: expectedParcelCount,
      labelCount: dpdLabelCount
    });
    if (!completeDpdLabelSet || swiftlineLabelCount !== expectedParcelCount) {
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
  format?: LabelFormat;
  labelSize?: "A4" | "A6";
}) {
  const format = input.format ?? "PDF";
  const labelSize = input.labelSize ?? "A6";
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
    format,
    labelSize,
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
      format,
      labelSize,
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
  const payload = mapShipmentDraftToDpdPayload(lockedDraft, configuration);
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
  // Nothing durable is written for this booking until the carrier has answered.
  // A rejection therefore leaves no booking record, no labels, no invoice and no
  // burnt AWB behind — only the audit trail below and an editable draft.
  let dpdShipment: IDpdShipment | null = null;
  let providerAccepted = false;

  const recordCarrierOutcome = async (input: {
    status: IDpdShipment["status"];
    trackingNumber: string;
    response?: DpdCreateShipmentResponse;
    responseSnapshot?: Record<string, unknown>;
  }) => {
    const booking = await DpdShipment.findOneAndUpdate(
      { shipmentDraftId: lockedDraft._id },
      {
        shipmentDraftId: lockedDraft._id,
        idempotencyKey,
        serviceCode: payload.serviceCode,
        requestSnapshot: input.response?.requestSnapshot ?? requestSnapshot,
        // Persisted the moment the carrier answers, before any of the checks
        // below can fail. Losing the carrier's own reply is what previously left
        // an accepted booking with no AWB and no way to reconcile it.
        responseSnapshot: input.responseSnapshot ?? input.response?.rawResponse ?? {},
        dpdShipmentId: input.response?.dpdShipmentId ?? "",
        dpdTransactionId: input.response?.dpdTransactionId ?? "",
        forwardingNumber: input.response?.forwardingNumber ?? "",
        entryNumber: input.response?.entryNumber ?? "",
        parcelNumbers: input.response?.parcelNumbers ?? [],
        swiftlineTrackingNumber: input.trackingNumber,
        bookingProvider,
        providerMode: configuration.mode,
        paymentSource: paymentContext.paymentSource ?? "BUSINESS_ACCOUNT",
        shippingEnvironment: getShippingEnvironment(configuration.mode),
        status: input.status
      },
      { returnDocument: "after", upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).exec();
    if (!booking) throw new Error("SHIPMENT_BOOKING_RECORD_NOT_CREATED");
    return booking;
  };

  // Reused across retries of the same draft so a rejected attempt does not
  // consume a fresh number from the station's daily sequence.
  const generatedAt = new Date();
  let trackingNumber = lockedDraft.allocatedTrackingNumber;
  if (!trackingNumber) {
    try {
      trackingNumber = await allocateSwiftlineTrackingNumber({ stationCode, date: generatedAt });
      lockedDraft.allocatedTrackingNumber = trackingNumber;
      await lockedDraft.save();
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
  }

  try {
    await writeDpdAuditLog(
      "DPD_REQUEST_INITIATED",
      lockedDraft._id as mongoose.Types.ObjectId,
      "SHIPMENT_DRAFT",
      userId,
      { idempotencyKey, shipmentDraftId: lockedDraft._id, swiftlineTrackingNumber: trackingNumber }
    );

    if (usesBusinessAccountBilling) {
      await markShipmentBookingChargeConsuming(lockedDraft._id as mongoose.Types.ObjectId);
    }

    let response: DpdCreateShipmentResponse;
    const dpdLabelBuffers: Array<{ parcelNumber: string; buffer: Buffer; format: LabelFormat }> = [];

    if (bookingProvider === "SWIFTLINE") {
      response = {
        dpdShipmentId: "",
        dpdTransactionId: "",
        forwardingNumber: "",
        entryNumber: "",
        parcelNumbers: [],
        labels: [],
        requestSnapshot,
        rawResponse: { mode: "SWIFTLINE", notice: "Internal Swiftline shipment" }
      };
    } else if (configuration.mode === "SIMULATED") {
      const parcelNumbers = payload.parcels.map((_, index) => simulatedParcelNumber(trackingNumber, index));
      response = {
        dpdShipmentId: `TEST-${trackingNumber}`,
        dpdTransactionId: `SIM-${trackingNumber}`,
        forwardingNumber: "",
        entryNumber: `TEST-${trackingNumber}`,
        parcelNumbers,
        labels: [],
        requestSnapshot,
        rawResponse: {
          mode: "SIMULATED",
          notice: "TEST - NOT FOR CARRIAGE",
          parcelNumbers
        }
      };
    } else {
      response = await createDpdShipment(
        configuration,
        lockedDraft,
        trackingNumber,
        generatedAt
      );
      // A successful carrier response may represent a real booking even if the
      // local adapter cannot finish parsing it. Such responses require review.
      providerAccepted = true;
      if (!response.dpdShipmentId) {
        throw new DpdApiError("DPD accepted the request but did not return a shipment number.", 502, response.rawResponse);
      }
      for (const label of response.labels) {
        dpdLabelBuffers.push({
          parcelNumber: label.parcelNumber,
          buffer: label.content,
          format: label.format
        });
      }
    }

    providerAccepted = true;

    // The carrier has answered, so the booking becomes durable here — carrying
    // its shipment number, parcel numbers and raw reply — before any of the
    // checks below can fail. Recording it only after those checks is what
    // previously discarded an accepted booking's AWB and left it unreconcilable.
    const booking = await recordCarrierOutcome({
      status: "DPD_CREATED",
      trackingNumber,
      response
    });
    dpdShipment = booking;

    if (bookingProvider === "DPD" && (
      response.parcelNumbers.length !== payload.parcels.length
      || new Set(response.parcelNumbers).size !== payload.parcels.length
    )) {
      throw new Error("CARRIER_PARCEL_SET_INCOMPLETE");
    }

    const bookingSnapshot = buildShipmentBookingSnapshot({
      draft: lockedDraft,
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
          buffer: await renderSimulatedDpdLabelPdf(labelData),
          format: "PDF"
        });
      }
    }

    const dpdLabelsByParcelNumber = new Map(dpdLabelBuffers.map((label) => [label.parcelNumber, label]));
    const orderedDpdLabelBuffers = bookingProvider !== "DPD"
      ? []
      : configuration.mode === "LIVE"
        ? dpdLabelBuffers
        : response.parcelNumbers.map((parcelNumber) => dpdLabelsByParcelNumber.get(parcelNumber));
    if (bookingProvider === "DPD" && (
      !dpdLabelBuffers.length
      || !isCompleteDpdLabelSet({
        bookingProvider,
        providerMode: configuration.mode,
        parcelCount: payload.parcels.length,
        labelCount: dpdLabelBuffers.length
      })
      // A repeated parcel number would silently overwrite one parcel's label
      // with another's when they are stored.
      || dpdLabelsByParcelNumber.size !== dpdLabelBuffers.length
      || orderedDpdLabelBuffers.some((label) => !label)
    )) {
      throw new Error("CARRIER_LABEL_SET_INCOMPLETE");
    }

    booking.bookingSnapshot = bookingSnapshot;
    booking.currentShipmentSnapshot = bookingSnapshot;
    booking.snapshotRevision = 1;
    await booking.save();

    const labels = [];
    for (const item of orderedDpdLabelBuffers) {
      if (!item) continue;
      const label = await storeGeneratedLabel({
        dpdShipmentId: booking._id as mongoose.Types.ObjectId,
        parcelNumber: item.parcelNumber,
        labelType: "DPD",
        providerMode: configuration.mode,
        buffer: item.buffer,
        format: item.format
      });
      if (label) labels.push(label);
    }

    for (let index = 0; index < payload.parcels.length; index += 1) {
      const labelData = bookingSnapshotToLabelData(bookingSnapshot, index, "SWIFTLINE");
      const label = await storeGeneratedLabel({
        dpdShipmentId: booking._id as mongoose.Types.ObjectId,
        parcelNumber: labelData.parcelNumber,
        labelType: "SWIFTLINE",
        providerMode: configuration.mode,
        buffer: await renderSwiftlineLabelPdf(labelData)
      });
      if (label) labels.push(label);
    }

    const dpdLabelCount = labels.filter((label) => label.labelType === "DPD").length;
    const swiftlineLabelCount = labels.filter((label) => label.labelType === "SWIFTLINE").length;
    if (dpdLabelCount !== dpdLabelBuffers.length || swiftlineLabelCount !== payload.parcels.length) {
      throw new Error("SHIPMENT_LABEL_SET_INCOMPLETE");
    }

    booking.status = "LABEL_RECEIVED";
    await booking.save();

    await writeDpdAuditLog(
      "DPD_REQUEST_SUCCEEDED",
      booking._id as mongoose.Types.ObjectId,
      "DPD_SHIPMENT",
      userId,
      {
        dpdShipmentId: response.dpdShipmentId,
        parcelNumbers: response.parcelNumbers,
        providerMode: configuration.mode,
        bookingProvider,
        swiftlineTrackingNumber: trackingNumber,
        dpdLabelCount,
        swiftlineLabelCount
      }
    );

    if (usesBusinessAccountBilling) {
      await completeShipmentBookingCharge({
        shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
        dpdShipmentId: booking._id as mongoose.Types.ObjectId,
        createdBy: userId
      });
    }

    const shipmentInvoice = await ensureShipmentInvoiceForDraft({
      shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
      dpdShipmentId: booking._id as mongoose.Types.ObjectId,
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
      dpdShipment: booking,
      shipmentInvoice,
      bookedBy: userId
    });

    return {
      dpdShipment: booking,
      labels,
      shipmentInvoice,
      reused: false
    };
  } catch (error) {
    // The request left for the carrier and its fate is unknown, so a booking
    // record has to exist even though none was created above: the shipment may
    // be live at the carrier and the money must stay held until someone checks.
    if (error instanceof DpdTimeoutError) {
      const booking = dpdShipment ?? await recordCarrierOutcome({
        status: "DPD_STATUS_UNKNOWN",
        trackingNumber,
        responseSnapshot: { message: error.message }
      });
      booking.status = "DPD_STATUS_UNKNOWN";
      booking.responseSnapshot = { ...booking.responseSnapshot, message: error.message };
      await booking.save();

      await writeDpdAuditLog(
        "DPD_REQUEST_FAILED",
        booking._id as mongoose.Types.ObjectId,
        "DPD_SHIPMENT",
        userId,
        { status: "DPD_STATUS_UNKNOWN", message: error.message }
      );

      if (usesBusinessAccountBilling) {
        await markShipmentBookingChargeReviewRequired({
          shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
          dpdShipmentId: booking._id as mongoose.Types.ObjectId,
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

    // The carrier accepted but something local failed afterwards. The booking is
    // real, so it is kept for reconciliation and the funds stay reserved.
    if (providerAccepted && dpdShipment) {
      const booking = dpdShipment;
      const message = bookingProvider === "DPD"
        ? "The carrier booking succeeded, but its invoice or labels could not be finalized. Do not submit the shipment again; contact Swiftline Operations."
        : "The shipment was created, but its invoice or Swiftline labels could not be finalized. Do not submit it again; contact Swiftline Operations.";
      booking.status = "DPD_CREATED";
      booking.responseSnapshot = {
        ...booking.responseSnapshot,
        localLabelError: error instanceof Error ? error.message : "Unknown label error"
      };
      await booking.save();

      await writeDpdAuditLog(
        "DPD_REQUEST_FAILED",
        booking._id as mongoose.Types.ObjectId,
        "DPD_SHIPMENT",
        userId,
        { status: "DPD_CREATED", providerAccepted: true, message }
      );

      if (usesBusinessAccountBilling) {
        await markShipmentBookingChargeReviewRequired({
          shipmentDraftId: lockedDraft._id as mongoose.Types.ObjectId,
          dpdShipmentId: booking._id as mongoose.Types.ObjectId,
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

    // The carrier refused the shipment. Nothing was ever created for it, so the
    // rejection leaves no booking record, no invoice and no labels — only this
    // audit row against the draft, which returns to being editable.
    const message = error instanceof DpdApiError
      ? error.message
      : bookingProvider === "DPD"
        ? "DPD is temporarily unavailable."
        : "The Swiftline shipment could not be created.";
    const carrierErrors = error instanceof DpdApiError
      ? readCarrierErrors(error.providerResponse)
      : [];

    await writeDpdAuditLog(
      "DPD_REQUEST_FAILED",
      lockedDraft._id as mongoose.Types.ObjectId,
      "SHIPMENT_DRAFT",
      userId,
      {
        status: "DPD_REJECTED",
        message,
        carrierErrors,
        providerResponse: error instanceof DpdApiError ? error.providerResponse : { message },
        swiftlineTrackingNumber: trackingNumber
      }
    );

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

    throw new DpdShipmentServiceError(
      message,
      error instanceof DpdApiError ? error.statusCode : 502,
      {},
      carrierErrors
    );
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
  const hasLiveCombinedDpdLabel = existingLabels.some((label) => (
    label.labelType === "DPD"
    && label.labelVersion === expectedLabelVersion
  ));

  if (requiresDpdLabels && dpdShipment.providerMode === "LIVE" && !hasLiveCombinedDpdLabel) {
    throw new DpdShipmentServiceError(
      "The live ALS booking is missing its combined carrier label. Retrieve it from ALS before completing reconciliation.",
      409
    );
  }

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

    if (requiresDpdLabels && dpdShipment.providerMode === "SIMULATED" && !hasDpdLabel) {
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
  const completeDpdLabelSet = isCompleteDpdLabelSet({
    bookingProvider: dpdShipment.bookingProvider,
    providerMode: dpdShipment.providerMode,
    parcelCount: snapshot.parcels.length,
    labelCount: dpdLabelCount
  });
  if (!completeDpdLabelSet || swiftlineLabelCount !== snapshot.parcels.length) {
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
  await writeDpdAuditLog(
    "DPD_REQUEST_SUCCEEDED",
    dpdShipment._id as mongoose.Types.ObjectId,
    "DPD_SHIPMENT",
    userId,
    { reconciled: true, dpdLabelCount, swiftlineLabelCount }
  );

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
  await writeDpdAuditLog("DPD_REQUEST_SUCCEEDED", dpdShipmentId, "DPD_SHIPMENT", userId, {
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

  await writeDpdAuditLog(
    "DPD_REQUEST_FAILED",
    dpdShipment._id as mongoose.Types.ObjectId,
    "DPD_SHIPMENT",
    userId,
    { developmentReset: true, shipmentDraftId: dpdShipment.shipmentDraftId }
  );

  return dpdShipment;
}
