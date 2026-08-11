// Loads a shipment and renders its customs ("shipment") invoice.
//
// The document is derived on demand rather than stored, so an amendment is
// reflected the next time it is opened — no revision rows and no version header,
// unlike the GST tax invoice. Only the invoice NUMBER is persisted, so it stays
// stable for a given shipment across regenerations.

import mongoose from "mongoose";
import { DpdShipment } from "../../models/dpdShipment.model.js";
import { InvoiceUpload } from "../../models/invoiceUpload.model.js";
import { ShipmentDraft } from "../../models/shipmentDraft.model.js";
import { publicShipmentSourceIdentity } from "../shipmentSourceIdentity.service.js";
import { buildCustomsInvoiceModel, type CustomsInvoiceModel } from "./customsInvoiceModel.service.js";
import { renderCustomsInvoicePdfBuffer } from "./customsInvoicePdf.service.js";
import { buildCustomsInvoiceWorkbook } from "./customsInvoiceWorkbook.service.js";

export class CustomsInvoiceError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "CustomsInvoiceError";
  }
}

/**
 * The invoice number shown on the document.
 *
 * Uses the shipment's own invoice reference where the customer supplied one on
 * the uploaded invoice, so the paperwork matches what they already hold. Falls
 * back to the Swiftline tracking number, then the draft id, so a document can
 * always be produced.
 */
export function resolveCustomsInvoiceNumber(input: {
  invoiceNumber?: string | null;
  shipmentReference?: string | null;
  swiftlineTrackingNumber?: string | null;
  draftId: string;
}): string {
  return input.invoiceNumber?.trim()
    || input.shipmentReference?.trim()
    || input.swiftlineTrackingNumber?.trim()
    || `SLS-${input.draftId.slice(-8).toUpperCase()}`;
}

/** Builds the invoice model for a shipment draft, or throws if it cannot be found. */
export async function buildCustomsInvoiceForDraft(input: {
  shipmentDraftId: string;
  businessAccountId?: mongoose.Types.ObjectId | null;
}): Promise<CustomsInvoiceModel> {
  if (!mongoose.Types.ObjectId.isValid(input.shipmentDraftId)) {
    throw new CustomsInvoiceError("Shipment not found.", 404);
  }

  const draft = await ShipmentDraft.findById(input.shipmentDraftId).exec();
  if (!draft) throw new CustomsInvoiceError("Shipment not found.", 404);

  // Client callers may only read their own account's shipments.
  if (input.businessAccountId && String(draft.businessAccountId) !== String(input.businessAccountId)) {
    throw new CustomsInvoiceError("Shipment not found.", 404);
  }

  const [upload, booking] = await Promise.all([
    InvoiceUpload.findById(draft.invoiceUploadId).exec(),
    DpdShipment.findOne({ shipmentDraftId: draft._id }).select("swiftlineTrackingNumber").lean().exec()
  ]);
  const sourceIdentity = publicShipmentSourceIdentity(upload);
  const invoiceNumber = resolveCustomsInvoiceNumber({
    invoiceNumber: sourceIdentity.invoiceNumber,
    shipmentReference: sourceIdentity.shipmentReference,
    swiftlineTrackingNumber: booking?.swiftlineTrackingNumber,
    draftId: String(draft._id)
  });

  return buildCustomsInvoiceModel({
    draft: draft as never,
    invoiceNumber,
    // Dated from the booking where one exists, so the document does not appear to
    // change date each time it is opened.
    invoiceDate: draft.createdAt ?? new Date()
  });
}

export async function renderCustomsInvoicePdf(input: {
  shipmentDraftId: string;
  businessAccountId?: mongoose.Types.ObjectId | null;
}) {
  const invoice = await buildCustomsInvoiceForDraft(input);
  return { invoice, buffer: await renderCustomsInvoicePdfBuffer(invoice) };
}

export async function renderCustomsInvoiceWorkbook(input: {
  shipmentDraftId: string;
  businessAccountId?: mongoose.Types.ObjectId | null;
}) {
  const invoice = await buildCustomsInvoiceForDraft(input);
  return { invoice, buffer: await buildCustomsInvoiceWorkbook(invoice) };
}

/**
 * A blank shipment invoice workbook for customers to fill in and upload.
 *
 * Same file the portal generates for a real shipment, so whatever they complete
 * imports straight back — one format for both directions, with worked example
 * rows showing the shape each column expects.
 */
export async function buildCustomsInvoiceTemplateWorkbook(): Promise<Buffer> {
  const example = buildCustomsInvoiceModel({
    draft: {
      csbType: "CSB_IV",
      serviceType: "COURIER",
      declarationNote: "",
      consignorAddress: {
        contactName: "Sender Name", companyName: "Sender Company",
        addressLine1: "Street address", townOrCity: "City", county: "State",
        countryName: "INDIA", postcode: "110001", email: "sender@example.com",
        mobileCountryCode: "+91", mobileNumber: "9876543210", aadhaarNumber: ""
      },
      consigneeEnteredAddress: {
        contactName: "Recipient Name", companyName: "Recipient Company",
        addressLine1: "Street address", townOrCity: "City", county: "County",
        countryName: "UNITED KINGDOM", countryCode: "GB", postcode: "OL8 1QJ",
        // Example numbers must pass libphonenumber validation, otherwise a
        // customer who fills in the template hits an error on a field they never
        // touched. Ofcom's 07700 900xxx drama range is reserved and fails.
        email: "recipient@example.com", mobileCountryCode: "+44", mobileNumber: "7123456789"
      },
      parcelList: [{
        sequence: 1, weightKg: 10, lengthCm: 30, widthCm: 20, heightCm: 15,
        shipmentReference1: "",
        items: [
          { description: "Example item one", hsnCode: "62034200", unitType: "Pkt", quantity: 2, unitRate: 150 },
          { description: "Example item two", hsnCode: "6117102030", unitType: "Pcs", quantity: 5, unitRate: 80 }
        ]
      }]
    } as never,
    invoiceNumber: "INV-00001"
  });

  return buildCustomsInvoiceWorkbook(example);
}

/** File name used for both downloads, e.g. "DAT301472-shipment-invoice.pdf". */
export function customsInvoiceFileName(invoice: CustomsInvoiceModel, extension: "pdf" | "xlsx") {
  const safe = invoice.invoiceNumber.replace(/[^A-Za-z0-9._-]+/g, "-");
  return `${safe}-shipment-invoice.${extension}`;
}
