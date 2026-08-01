import type { EmailContent } from "../layout.js";
import type { EmailTemplateContext } from "./index.js";
import { asText, firstNameOf, formatDateTime } from "../format.js";

export function clientInvitationTemplate(context: EmailTemplateContext): EmailContent {
  const { payload, recipientName } = context;
  const companyName = asText(payload.companyName, "your organisation");

  return {
    subject: `Activate your Swiftline Portal access for ${companyName}`,
    preheader: "Create your password to activate your Swiftline Portal account.",
    heading: "Activate your portal access",
    blocks: [
      { kind: "paragraph", text: `Hello ${firstNameOf(recipientName)},` },
      {
        kind: "paragraph",
        text: `You have been invited to access ${companyName} on the Swiftline Portal. Use the secure link below to create your password and activate your account.`
      },
      { kind: "button", label: "Create your password", url: asText(payload.activationUrl, "") },
      {
        kind: "callout",
        tone: "warning",
        text: `This activation link expires on ${formatDateTime(payload.expiresAt as string)}.`
      },
      { kind: "note", text: "If you were not expecting this invitation you can safely ignore this email." }
    ]
  };
}
