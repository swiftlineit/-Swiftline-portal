import type { EmailContent } from "../layout.js";
import type { EmailTemplateContext } from "./index.js";
import {
  asNumber,
  asText,
  formatDateTime,
  formatMoneyMinor,
  firstNameOf,
  toAbsoluteUrl
} from "../format.js";

function shipmentFacts(payload: Record<string, unknown>) {
  const rows: Array<{ label: string; value: string }> = [
    { label: "Tracking number", value: asText(payload.trackingNumber) },
    { label: "Shipment reference", value: asText(payload.shipmentReference) },
    { label: "Service", value: asText(payload.serviceType) },
    { label: "Destination", value: asText(payload.destination) },
    { label: "Parcels", value: String(asNumber(payload.parcelCount)) },
    { label: "Chargeable weight", value: `${asNumber(payload.totalWeightKg).toFixed(2)} kg` },
    { label: "Booked at", value: formatDateTime(payload.bookedAt as string) }
  ];

  return rows.filter((row) => row.value && row.value !== "Not provided");
}

function invoiceFacts(payload: Record<string, unknown>) {
  const currency = asText(payload.currency, "INR");
  return {
    kind: "facts" as const,
    rows: [
      { label: "Invoice number", value: asText(payload.invoiceNumber) },
      { label: "Taxable value", value: formatMoneyMinor(asNumber(payload.taxableValueMinor), currency) },
      { label: "GST", value: formatMoneyMinor(asNumber(payload.totalTaxAmountMinor), currency) },
      { label: "Invoice total", value: formatMoneyMinor(asNumber(payload.invoiceTotalMinor), currency) }
    ]
  };
}

export function shipmentBookedClientTemplate(context: EmailTemplateContext): EmailContent {
  const { payload, appUrl, recipientName } = context;
  const trackingNumber = asText(payload.trackingNumber, "");
  const parcelCount = asNumber(payload.parcelCount);
  const labelsAttached = Boolean(payload.labelsAttached);

  return {
    subject: trackingNumber
      ? `Shipment ${trackingNumber} booked successfully`
      : "Your shipment has been booked",
    preheader: `${parcelCount} parcel${parcelCount === 1 ? "" : "s"} booked. Invoice and labels are attached.`,
    heading: "Your shipment is booked",
    blocks: [
      { kind: "paragraph", text: `Hello ${firstNameOf(recipientName)},` },
      {
        kind: "paragraph",
        text: `Your shipment has been booked successfully with ${asText(payload.bookingProvider, "the carrier")}. The details are below and your tax invoice is attached to this email.`
      },
      { kind: "facts", rows: shipmentFacts(payload) },
      { kind: "callout", tone: "success", text: `Tax invoice ${asText(payload.invoiceNumber)} for ${formatMoneyMinor(asNumber(payload.invoiceTotalMinor), asText(payload.currency, "INR"))} is attached as a PDF.` },
      ...(labelsAttached
        ? [{
          kind: "paragraph" as const,
          text: "Shipping labels are attached. Print one label per parcel and affix it before handover."
        }]
        : [{
          kind: "paragraph" as const,
          text: "Your shipping labels are ready to download from the portal. Print one label per parcel and affix it before handover."
        }]),
      { kind: "button", label: "View shipment", url: toAbsoluteUrl(appUrl, asText(payload.href, "/client/shipments")) },
      { kind: "note", text: "Keep the tracking number handy when contacting support about this shipment." }
    ]
  };
}

export function shipmentBookedStaffTemplate(context: EmailTemplateContext): EmailContent {
  const { payload, appUrl } = context;
  const trackingNumber = asText(payload.trackingNumber, "");

  return {
    subject: `New booking ${trackingNumber} — ${asText(payload.businessAccountName, "client")}`,
    preheader: `Booked by ${asText(payload.bookedByName)} at ${asText(payload.branchName)}.`,
    heading: "New shipment booked",
    blocks: [
      {
        kind: "paragraph",
        text: `${asText(payload.businessAccountName, "A client")} booked a shipment through ${asText(payload.branchName, "the portal")}. Invoice and labels are attached for the operations record.`
      },
      {
        kind: "facts",
        rows: [
          { label: "Business account", value: asText(payload.businessAccountName) },
          { label: "Booked by", value: asText(payload.bookedByName) },
          { label: "Branch", value: asText(payload.branchName) },
          ...shipmentFacts(payload)
        ]
      },
      invoiceFacts(payload),
      { kind: "button", label: "Open shipment", url: toAbsoluteUrl(appUrl, asText(payload.staffHref, "/dashboard/shipments")) }
    ]
  };
}
