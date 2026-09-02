import type { EmailContent } from "../layout.js";
import type { EmailTemplateContext } from "./index.js";
import { asNumber, asText, firstNameOf } from "../format.js";

export function businessAccountOtpTemplate(context: EmailTemplateContext): EmailContent {
  const { payload, recipientName } = context;
  const code = asText(payload.code, "");
  const minutes = asNumber(payload.expiresInMinutes, 10);

  return {
    subject: "Verify your Swiftline business account request",
    preheader: `${code} is your verification code. It expires in ${minutes} minutes.`,
    heading: "Verify your email",
    blocks: [
      { kind: "paragraph", text: `Hello ${firstNameOf(recipientName)},` },
      { kind: "paragraph", text: "Use this code to verify your email and continue your Swiftline business account request." },
      { kind: "code", value: code },
      {
        kind: "callout",
        tone: "warning",
        text: `This code expires in ${minutes} minutes and can only be used once. If you did not request a business account, you can ignore this email.`
      },
      {
        kind: "note",
        text: "This is an automated email - please do not reply. For help, contact Info@swiftlinefreight.com or +91 70271 16600."
      }
    ]
  };
}
