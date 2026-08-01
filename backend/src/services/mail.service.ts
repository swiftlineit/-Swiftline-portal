import crypto from "crypto";
import { env } from "../config/env.js";
import { enqueueEmails } from "./email/enqueue.js";
import { flushOutboxRow } from "./email/dispatcher.js";
import { isMailConfigured } from "./email/transport.js";

type ClientInvitationEmailInput = {
  to: string;
  name: string;
  companyName: string;
  activationUrl: string;
  expiresAt: Date;
};

type PasswordResetEmailInput = {
  to: string;
  name: string;
  resetUrl: string;
  expiresAt: Date;
};

export type MailDeliveryResult = {
  sent: boolean;
  skipped: boolean;
};

/**
 * Both of these carry a single-use secret in their link, so the URL is what
 * identifies the message. Re-issuing an invitation mints a new token and
 * therefore a new email, while a duplicate submit of the same token reuses the
 * queued row instead of sending twice.
 */
function keyForUrl(prefix: string, url: string) {
  return `${prefix}:${crypto.createHash("sha256").update(url).digest("hex").slice(0, 32)}`;
}

/**
 * Queues the message and sends it in the same call.
 *
 * Account-access mail is the one place where a person is waiting on the result:
 * an admin needs to know the invitation went out, and "queued" is not an answer
 * they can act on. Everything driven by a domain event goes through the drain
 * instead and is never awaited on a request.
 */
async function enqueueAndSendNow(params: {
  notificationType: "CLIENT_INVITATION" | "PASSWORD_RESET";
  idempotencyKey: string;
  to: string;
  name: string;
  subject: string;
  payload: Record<string, unknown>;
  context: Record<string, unknown>;
}): Promise<MailDeliveryResult> {
  if (!isMailConfigured()) {
    // Production has no acceptable fallback here: a client who cannot receive
    // an activation or reset link cannot use the portal at all.
    if (env.NODE_ENV === "production") throw new Error("Mail transport is not configured.");

    console.info(`${params.notificationType} email skipped: mail transport is not configured.`, params.context);
    return { sent: false, skipped: true };
  }

  await enqueueEmails({
    notificationType: params.notificationType,
    idempotencyKey: params.idempotencyKey,
    templateKey: params.notificationType,
    recipients: [{ userId: null, email: params.to, name: params.name }],
    subject: params.subject,
    payload: params.payload
  });

  const result = await flushOutboxRow(`${params.idempotencyKey}:${params.to.toLowerCase()}:email`);
  if (!result.sent && !result.skipped) {
    throw new Error(result.error || `${params.notificationType} email could not be delivered.`);
  }

  console.info(`${params.notificationType} email dispatched.`, { ...params.context, status: result.status });
  return { sent: result.sent, skipped: !result.sent };
}

export async function sendClientInvitationEmail(input: ClientInvitationEmailInput): Promise<MailDeliveryResult> {
  return enqueueAndSendNow({
    notificationType: "CLIENT_INVITATION",
    idempotencyKey: keyForUrl("CLIENT_INVITATION", input.activationUrl),
    to: input.to,
    name: input.name,
    subject: `Activate your Swiftline Portal access for ${input.companyName}`,
    payload: {
      companyName: input.companyName,
      activationUrl: input.activationUrl,
      expiresAt: input.expiresAt
    },
    context: { to: input.to, companyName: input.companyName }
  });
}

export async function sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<MailDeliveryResult> {
  return enqueueAndSendNow({
    notificationType: "PASSWORD_RESET",
    idempotencyKey: keyForUrl("PASSWORD_RESET", input.resetUrl),
    to: input.to,
    name: input.name,
    subject: "Reset your Swiftline Portal password",
    payload: {
      resetUrl: input.resetUrl,
      expiresAt: input.expiresAt
    },
    context: { to: input.to }
  });
}
