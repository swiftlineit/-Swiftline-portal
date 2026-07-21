import crypto from "node:crypto";

function safeEqualHex(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyRazorpayCheckoutSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
  secret: string;
}) {
  const expected = crypto
    .createHmac("sha256", input.secret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest("hex");

  return safeEqualHex(expected, input.signature);
}

export function verifyRazorpayWebhookSignature(input: {
  rawBody: Buffer;
  signature: string;
  secret: string;
}) {
  const expected = crypto
    .createHmac("sha256", input.secret)
    .update(input.rawBody)
    .digest("hex");

  return safeEqualHex(expected, input.signature);
}

export function hashWebhookPayload(rawBody: Buffer) {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}
