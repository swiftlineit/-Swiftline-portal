import type { EmailBlock, EmailContent } from "../layout.js";
import type { EmailTemplateContext } from "./index.js";
import { asNumber, asRecordArray, asText, firstNameOf, formatDate } from "../format.js";

/**
 * The rate card email. The tariff itself is attached as PDF and Excel, so the
 * body's job is to establish what the sheet is, how long it holds and what is
 * excluded- a highlights table rather than the full slab list, which would run
 * to hundreds of rows in a mail client.
 */
export function rateCardSharedTemplate(context: EmailTemplateContext): EmailContent {
  const { payload, recipientName } = context;

  const shareNumber = asText(payload.shareNumber, "");
  const isExternalProposal = asText(payload.documentType, "RATE_CARD") === "EXTERNAL_PROPOSAL";
  const documentLabel = isExternalProposal ? "external rate proposal" : "rate card";
  const title = asText(payload.title, "rate card");
  const currency = asText(payload.currency, "INR");
  const viewUrl = asText(payload.viewUrl, "");
  const validFrom = formatDate(payload.validFrom as string);
  const validUntil = formatDate(payload.validUntil as string);
  const countryCount = asNumber(payload.countryCount, 0);
  const slabCount = asNumber(payload.slabCount, 0);
  const senderName = asText(payload.senderName, "The Swiftline Team");

  // [service, lowest rate] pairs, precomputed at enqueue time so the template
  // never has to re-read the share.
  const highlights = asRecordArray(payload.highlights);
  const terms = asRecordArray(payload.termsRows);

  const blocks: EmailBlock[] = [
    { kind: "paragraph", text: `Dear ${firstNameOf(recipientName)},` },
    {
      kind: "paragraph",
      text: `Thank you for your interest in Swiftline. Please find enclosed our ${documentLabel}, ${title}, covering ${countryCount} ${countryCount === 1 ? "destination" : "destinations"} across ${slabCount} weight ${slabCount === 1 ? "slab" : "slabs"}. The complete tariff is attached as both a PDF and an Excel workbook for your records.`
    },
    {
      kind: "facts",
      rows: [
        ...(shareNumber ? [{ label: "Reference", value: shareNumber }] : []),
        { label: "Rates valid", value: `${validFrom} to ${validUntil}` },
        { label: "Currency", value: `${currency} per kilogram` },
        ...terms.map((row) => ({ label: asText(row.label, ""), value: asText(row.value, "") }))
      ]
    }
  ];

  if (highlights.length) {
    blocks.push({
      kind: "table",
      columns: ["Service", "Starting from"],
      rows: highlights.map((entry) => [asText(entry.service, ""), asText(entry.lowest, "")])
    });
  }

  if (viewUrl) {
    blocks.push({ kind: "button", label: `View the full ${documentLabel}`, url: viewUrl });
  }

  blocks.push(
    {
      kind: "callout",
      tone: "warning",
      text: `These rates hold until ${validUntil}. Please contact us to confirm pricing for any booking after that date.`
    },
    {
      kind: "note",
      text: "Rates exclude duties, destination-country taxes, customs clearance charges and any charges levied at destination, and are subject to revision on account of carrier tariff changes, currency movement or regulatory action. Shipments are accepted subject to Swiftline's standard terms and conditions of carriage."
    },
    { kind: "paragraph", text: `We look forward to handling your shipments.` },
    { kind: "paragraph", text: `Warm regards,\n${senderName}\nSwiftline` }
  );

  return {
    subject: `Swiftline ${documentLabel}${shareNumber ? ` - ${shareNumber}` : ""}`,
    preheader: `${countryCount} ${countryCount === 1 ? "destination" : "destinations"}, valid to ${validUntil}. PDF and Excel attached.`,
    heading: isExternalProposal ? "Your Swiftline external rate proposal" : "Your Swiftline rate card",
    blocks
  };
}
