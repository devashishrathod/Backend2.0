const crypto = require("crypto");
const { WEBHOOK_DEFAULTS } = require("../../constants/webhook");

/**
 * Verify a Razorpay webhook signature.
 *
 * Razorpay signs the **raw request body** with the webhook secret — not the
 * re-serialised JSON. `JSON.stringify(req.body)` will not match, because key
 * order and whitespace differ. `index.js` therefore stashes the untouched buffer
 * on `req.rawBody` via the body-parser `verify` hook.
 *
 * This is the only thing standing between the endpoint and anyone who knows the
 * URL, since a webhook cannot carry a JWT. There is no fallback: no secret
 * configured means every delivery is rejected rather than trusted.
 *
 * `timingSafeEqual` is used so the comparison cannot be probed byte by byte.
 *
 * @returns {{ ok: boolean, reason?: string }}
 */
exports.verifyRazorpayWebhook = (rawBody, signature) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return {
      ok: false,
      reason:
        "RAZORPAY_WEBHOOK_SECRET is not configured — webhook deliveries cannot be verified.",
    };
  }
  if (!signature) {
    return {
      ok: false,
      reason: `Missing ${WEBHOOK_DEFAULTS.signatureHeader} header.`,
    };
  }
  if (!rawBody || !rawBody.length) {
    return {
      ok: false,
      reason:
        "Raw request body unavailable — the webhook route must receive the untouched payload.",
    };
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const received = String(signature);
  if (expected.length !== received.length) {
    return { ok: false, reason: "Signature mismatch." };
  }

  const matches = crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(received, "utf8"),
  );

  return matches ? { ok: true } : { ok: false, reason: "Signature mismatch." };
};
