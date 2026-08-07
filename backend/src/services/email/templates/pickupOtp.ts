import type { EmailTemplate } from "./index.js";
import { asText, firstNameOf } from "../format.js";

export const pickupOtpTemplate: EmailTemplate = ({ recipientName, payload }) => {
  const code = asText(payload.code, "");
  const requestNumber = asText(payload.requestNumber, "your pickup");
  const expiresInMinutes = asText(payload.expiresInMinutes, "10");
  return {
    subject: `Pickup verification code for ${requestNumber}`,
    preheader: `Your Swiftline pickup verification code is ${code}.`,
    heading: "Confirm parcel handover",
    blocks: [
      { kind: "paragraph", text: `Hello ${firstNameOf(recipientName)},` },
      { kind: "paragraph", text: `Give this code to the pickup driver only after checking the parcels being collected for ${requestNumber}.` },
      { kind: "code", value: code },
      { kind: "paragraph", text: `This code expires in ${expiresInMinutes} minutes. Swiftline will never ask for it before the driver arrives.` }
    ]
  };
};
