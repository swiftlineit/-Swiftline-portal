import mongoose from "mongoose";
import { Branch } from "../models/branch.model.js";
import { BusinessAccount } from "../models/businessAccount.model.js";
import { LabelDocument } from "../models/labelDocument.model.js";
import { User } from "../models/user.model.js";
import type { IEmailAttachmentRef } from "../models/emailOutbox.model.js";
import type { IDpdShipment } from "../models/dpdShipment.model.js";
import type { IShipmentDraft } from "../models/shipmentDraft.model.js";
import type { IShipmentInvoice } from "../models/shipmentInvoice.model.js";
import { notifyBusinessShipmentMembers, notifyOperationsStaff } from "./portalNotification.service.js";

type ShipmentBookedInput = {
  draft: IShipmentDraft;
  dpdShipment: IDpdShipment;
  shipmentInvoice: IShipmentInvoice;
  bookedBy: mongoose.Types.ObjectId;
};

function resolveConsigneeAddress(draft: IShipmentDraft) {
  return draft.consigneeValidatedAddress ?? draft.consigneeSelectedAddress ?? draft.consigneeEnteredAddress;
}

function buildPayload(input: ShipmentBookedInput, context: {
  businessAccountName: string;
  branchName: string;
  bookedByName: string;
}) {
  const { draft, dpdShipment, shipmentInvoice } = input;
  const consignee = resolveConsigneeAddress(draft);
  const totalWeightKg = draft.parcelList.reduce((total, parcel) => total + (parcel.weightKg || 0), 0);
  const destination = [consignee?.townOrCity, consignee?.countryName || consignee?.countryCode]
    .filter(Boolean)
    .join(", ");
  // The draft carries references per parcel; the shipment-level one is the
  // snapshot the invoice was raised against, which is what the client quotes.
  const shipmentReference = shipmentInvoice.shipment?.shipmentReference;

  return {
    trackingNumber: dpdShipment.swiftlineTrackingNumber || "",
    shipmentReference: typeof shipmentReference === "string" ? shipmentReference : "",
    serviceType: draft.serviceType === "CARGO" ? "Cargo" : "Courier",
    bookingProvider: dpdShipment.bookingProvider === "SWIFTLINE" ? "Swiftline" : "DPD",
    destination,
    consigneeName: consignee?.companyName || consignee?.contactName || "",
    parcelCount: draft.parcelList.length,
    totalWeightKg,
    bookedAt: dpdShipment.createdAt,
    invoiceNumber: shipmentInvoice.invoiceNumber,
    currency: shipmentInvoice.currency,
    taxableValueMinor: shipmentInvoice.taxableValueMinor,
    totalTaxAmountMinor: shipmentInvoice.totalTaxAmountMinor,
    invoiceTotalMinor: shipmentInvoice.totalAmountMinor,
    businessAccountName: context.businessAccountName,
    branchName: context.branchName,
    bookedByName: context.bookedByName,
    href: `/client/shipments/${String(draft._id)}`,
    staffHref: `/dashboard/dpd-labels/${String(draft._id)}`
  };
}

/**
 * Notifies the client and the operations desk that a shipment is booked, with
 * the tax invoice and labels attached.
 *
 * Delivery is best effort. The shipment, its labels and its invoice are already
 * persisted by the time this runs, so a notification failure must never
 * propagate — re-booking is precisely what must not happen here.
 */
export async function notifyShipmentBooked(input: ShipmentBookedInput) {
  const { draft, dpdShipment, shipmentInvoice } = input;

  try {
    const [businessAccount, branch, bookedByUser, labels] = await Promise.all([
      BusinessAccount.findById(draft.businessAccountId).select("company.companyName").lean().exec(),
      Branch.findById(draft.branchId).select("name").lean().exec(),
      User.findById(input.bookedBy).select("name firstName lastName").lean().exec(),
      LabelDocument.find({ dpdShipmentId: dpdShipment._id, voidedAt: null })
        .select("_id labelType parcelNumber providerMode format")
        // labelType ascending puts DPD before SWIFTLINE, which is the order the
        // attachments are wanted in — see the budget note below.
        .sort({ labelType: 1, parcelNumber: 1 })
        .lean()
        .exec()
    ]);

    const payload = buildPayload(input, {
      businessAccountName: businessAccount?.company?.companyName ?? "",
      branchName: branch?.name ?? "",
      bookedByName: bookedByUser?.name
        || `${bookedByUser?.firstName ?? ""} ${bookedByUser?.lastName ?? ""}`.trim()
    });

    const invoiceAttachment: IEmailAttachmentRef = {
      kind: "SHIPMENT_INVOICE_PDF",
      refId: shipmentInvoice._id as mongoose.Types.ObjectId,
      revision: shipmentInvoice.revision,
      filename: `${shipmentInvoice.invoiceNumber.replaceAll("/", "-")}-Invoice.pdf`
    };

    const labelAttachment = (label: {
      _id: mongoose.Types.ObjectId;
      labelType: string;
      parcelNumber: string;
      providerMode: string;
      format: string;
    }): IEmailAttachmentRef => {
      const name = label.labelType === "DPD" ? "DPD-Label" : "Swiftline-Internal-Label";
      // Named the same way the portal marks it, so a simulated carrier label is
      // never mistaken for one a depot will accept.
      const prefix = label.labelType === "DPD" && label.providerMode === "SIMULATED" ? "TEST-NOT-FOR-CARRIAGE-" : "";

      return {
        kind: "LABEL_DOCUMENT",
        refId: label._id,
        revision: null,
        filename: `${prefix}${name}-${label.parcelNumber}.${label.format.toLowerCase()}`
      };
    };

    // Client and staff receive the same documents: the carrier label is what the
    // parcel actually travels on, so withholding it from the client leaves them
    // unable to hand over. The invoice leads the list so that if the size budget
    // runs out it is labels that get dropped, never the document needed for
    // accounts, and the DPD labels precede the internal ones for the same reason.
    const attachments = [invoiceAttachment, ...labels.map(labelAttachment)];
    // A booking made without a carrier label has no DPD label to send.
    const dpdLabelIsTest = labels.some(
      (label) => label.labelType === "DPD" && label.providerMode === "SIMULATED"
    );

    const trackingNumber = payload.trackingNumber || String(draft._id);
    const idempotencyKey = `SHIPMENT_BOOKED:${String(dpdShipment._id)}`;
    const parcelLabel = `${payload.parcelCount} parcel${payload.parcelCount === 1 ? "" : "s"}`;

    await notifyBusinessShipmentMembers(draft.businessAccountId, {
      type: "SHIPMENT_BOOKED",
      title: "Shipment booked",
      message: `${trackingNumber} is booked with ${payload.bookingProvider} (${parcelLabel}). Invoice ${payload.invoiceNumber} is ready.`,
      href: payload.href,
      idempotencyKey,
      businessAccountId: draft.businessAccountId,
      metadata: {
        shipmentDraftId: draft._id,
        dpdShipmentId: dpdShipment._id,
        shipmentInvoiceId: shipmentInvoice._id,
        trackingNumber: payload.trackingNumber
      },
      email: {
        templateKey: "SHIPMENT_BOOKED_CLIENT",
        payload: { ...payload, dpdLabelIsTest },
        attachmentRefs: attachments
      }
    });

    await notifyOperationsStaff({
      type: "SHIPMENT_BOOKED",
      title: "New shipment booked",
      message: `${payload.businessAccountName || "A client"} booked ${trackingNumber} (${parcelLabel}) at ${payload.branchName || "the portal"}.`,
      href: payload.staffHref,
      // Distinct key: staff and client rows are separate notifications for the
      // same event and must not collide on the unique index.
      idempotencyKey: `${idempotencyKey}:STAFF`,
      businessAccountId: draft.businessAccountId,
      metadata: {
        shipmentDraftId: draft._id,
        dpdShipmentId: dpdShipment._id,
        trackingNumber: payload.trackingNumber
      },
      email: {
        templateKey: "SHIPMENT_BOOKED_STAFF",
        payload: { ...payload, dpdLabelIsTest },
        attachmentRefs: attachments
      }
    });
  } catch (error) {
    console.error("Shipment booked notification failed.", {
      shipmentDraftId: String(draft._id),
      dpdShipmentId: String(dpdShipment._id),
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
}
