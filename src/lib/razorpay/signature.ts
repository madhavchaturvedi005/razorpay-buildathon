import crypto from "crypto";

// ─── HMAC-SHA256 webhook signature verification ───────────────────────────────
// Razorpay signs every webhook payload with the webhook secret.
// Docs: https://razorpay.com/docs/webhooks/validate-test/

export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(signature, "hex"),
  );
}

// ─── Payment signature verification (checkout flow) ──────────────────────────
// Used after a customer pays — verify the payment is authentic before fulfillment.

export function verifyPaymentSignature(params: {
  order_id: string;
  payment_id: string;
  signature: string;
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET ?? "";
  const message = `${params.order_id}|${params.payment_id}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");
  return expected === params.signature;
}
