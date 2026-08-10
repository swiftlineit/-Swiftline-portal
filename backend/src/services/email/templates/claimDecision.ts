import type { EmailBlock, EmailContent } from "../layout.js";
import type { EmailTemplateContext } from "./index.js";
import { asNumber, asText, firstNameOf, formatDate, toAbsoluteUrl } from "../format.js";

/**
 * The claim decision email.
 *
 * Worth a bespoke template rather than the generic one because it is the single
 * message a client is most likely to forward, print, or argue with. It has to
 * carry the outcome, the arithmetic behind it, and the deadline to challenge it,
 * without the reader having to open the portal to find any of them.
 */

function money(minor: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(minor / 100);
}

export function claimDecisionTemplate(context: EmailTemplateContext): EmailContent {
  const { payload, recipientName, appUrl } = context;

  const claimNumber = asText(payload.claimNumber, "your claim");
  const outcome = asText(payload.outcome, "");
  const requested = asNumber(payload.requestedAmountMinor, 0);
  const approved = asNumber(payload.approvedAmountMinor, 0);
  const declared = asNumber(payload.declaredValueMinor, 0);
  const explanation = asText(payload.customerExplanation, "");
  const trackingNumber = asText(payload.trackingNumber, "");
  const appealDeadline = payload.appealDeadlineAt
    ? formatDate(payload.appealDeadlineAt as string)
    : "";
  const href = asText(payload.href, "");

  const rejected = outcome === "REJECTED";
  const partial = outcome === "PARTIALLY_APPROVED";

  const heading = rejected
    ? `Claim ${claimNumber} was not approved`
    : partial
      ? `Claim ${claimNumber} was partly approved`
      : `Claim ${claimNumber} was approved`;

  const blocks: EmailBlock[] = [
    { kind: "paragraph", text: `Dear ${firstNameOf(recipientName)},` },
    {
      kind: "paragraph",
      text: rejected
        ? `We have completed our review of claim ${claimNumber} and are unable to approve it. Our reasoning is set out below.`
        : `We have completed our review of claim ${claimNumber} and have approved ${money(approved)}.`
    },
    {
      kind: "facts",
      rows: [
        { label: "Claim", value: claimNumber },
        ...(trackingNumber ? [{ label: "Shipment", value: trackingNumber }] : []),
        { label: "Amount claimed", value: money(requested) },
        // Shown even on a rejection: it is the figure most decisions turn on,
        // and its absence is the first thing a disputing client asks about.
        { label: "Declared value at booking", value: money(declared) },
        { label: "Amount approved", value: rejected ? "Nil" : money(approved) }
      ]
    }
  ];

  if (explanation) {
    blocks.push({ kind: "paragraph", text: explanation });
  }

  if (!rejected) {
    blocks.push({
      kind: "paragraph",
      text: "To receive this settlement, please accept it in the portal and confirm the bank account it should be paid into. We verify those details before releasing payment."
    });
  }

  if (appealDeadline) {
    blocks.push({
      kind: "paragraph",
      text: `If you disagree with this outcome you may appeal once, up to ${appealDeadline}. An appeal needs a reason or new evidence. After that date the decision is final.`
    });
  }

  if (href) {
    blocks.push({
      kind: "button",
      label: rejected ? "View the decision" : "Accept and add bank details",
      url: toAbsoluteUrl(appUrl, href)
    });
  }

  return {
    subject: heading,
    preheader: rejected
      ? "Our review is complete. Details and your right to appeal are inside."
      : `${money(approved)} approved. Accept in the portal to arrange payment.`,
    heading,
    blocks
  };
}
