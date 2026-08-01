import type { EmailContent } from "../layout.js";
import type { EmailTemplateContext } from "./index.js";
import { asText, firstNameOf, formatDateTime } from "../format.js";

export function passwordResetTemplate(context: EmailTemplateContext): EmailContent {
  const { payload, recipientName } = context;

  return {
    subject: "Reset your Swiftline Portal password",
    preheader: "Use the secure link to choose a new password.",
    heading: "Reset your password",
    blocks: [
      { kind: "paragraph", text: `Hello ${firstNameOf(recipientName)},` },
      {
        kind: "paragraph",
        text: "We received a request to reset the password on your Swiftline Portal account. Choose a new password using the secure link below."
      },
      { kind: "button", label: "Choose a new password", url: asText(payload.resetUrl, "") },
      {
        kind: "callout",
        tone: "warning",
        text: `This reset link expires on ${formatDateTime(payload.expiresAt as string)}.`
      },
      {
        kind: "note",
        text: "If you did not request a password reset you can ignore this email — your current password stays active."
      }
    ]
  };
}
