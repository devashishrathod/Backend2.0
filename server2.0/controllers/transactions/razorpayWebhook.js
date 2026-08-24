const { asyncWrapper, sendSuccess } = require("../../utils");
const { handleRazorpayWebhook } = require("../../services/transactions");
const { WEBHOOK_DEFAULTS } = require("../../constants/webhook");

/**
 * Public endpoint — Razorpay cannot present a JWT, so authenticity comes from the
 * HMAC over the raw body instead.
 *
 * Always answers 200 once the signature checks out, whatever the outcome:
 * Razorpay retries on any non-2xx, so an event we cannot act on has to be
 * acknowledged rather than redelivered forever. The `status` in the response
 * says what actually happened.
 */
exports.razorpayWebhook = asyncWrapper(async (req, res) => {
  const result = await handleRazorpayWebhook({
    // Stashed by the body-parser `verify` hook in index.js — Razorpay signs the
    // untouched bytes, so re-serialised JSON would not match.
    rawBody: req.rawBody,
    signature: req.headers[WEBHOOK_DEFAULTS.signatureHeader],
    eventId: req.headers[WEBHOOK_DEFAULTS.eventIdHeader],
    body: req.body,
  });
  return sendSuccess(res, 200, "Webhook received", result);
});
