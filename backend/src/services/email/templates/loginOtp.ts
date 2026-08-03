import type { EmailContent } from "../layout.js";
import type { EmailTemplateContext } from "./index.js";
import { asNumber, asText, firstNameOf } from "../format.js";

export function loginOtpTemplate(context: EmailTemplateContext): EmailContent {
  const { payload, recipientName } = context;
  const code = asText(payload.code, "");
  const minutes = asNumber(payload.expiresInMinutes, 10);

  return {
    subject: "Your Swiftline Portal sign-in code",
    // The code belongs in the preview text: most people can read it from the
    // inbox list and never have to open the message.
    preheader: `${code} is your sign-in code. It expires in ${minutes} minutes.`,
    heading: "Your sign-in code",
    blocks: [
      { kind: "paragraph", text: `Hello ${firstNameOf(recipientName)},` },
      { kind: "paragraph", text: "Enter this code on the Swiftline Portal sign-in screen to continue." },
      { kind: "code", value: code },
      {
        kind: "callout",
        tone: "warning",
        text: `This code expires in ${minutes} minutes and can only be used once.`
      },
      {
        kind: "note",
        text: "Swiftline will never ask you for this code by phone, WhatsApp or email. If you did not try to sign in, ignore this message and consider changing your password."
      }
    ]
  };
}
