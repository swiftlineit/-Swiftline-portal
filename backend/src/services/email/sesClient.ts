import { SESv2Client } from "@aws-sdk/client-sesv2";
import { env } from "../../config/env.js";

let client: SESv2Client | null = null;

/**
 * One client for the process. The SDK pools connections internally, so building
 * a new client per send would discard the pool and re-resolve credentials on
 * every message.
 *
 * Static keys are used only when both are supplied; otherwise the default
 * provider chain runs, which is what picks up the EC2/ECS instance role in
 * production. Passing `credentials: undefined` explicitly is what keeps that
 * fallback intact.
 */
export function getSesClient() {
  if (client) return client;

  const hasStaticCredentials = Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);

  client = new SESv2Client({
    region: env.AWS_REGION,
    credentials: hasStaticCredentials
      ? {
        accessKeyId: env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY as string
      }
      : undefined
  });

  return client;
}
