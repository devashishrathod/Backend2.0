const { asyncWrapper, sendSuccess } = require("../../utils");
const { handleRazorpayWebhook } = require("../../services/transactions");
const { WEBHOOK_DEFAULTS } = require("../../constants/webhook");
const { RAZORPAY_ACCOUNTS } = require("../../constants/transaction");

/**
 * Public endpoint for the **VENDOR** Razorpay account — subscription payments.
 * Its twin for customer voucher claims is `razorpayCustomerWebhook.js`.
 *
 * Razorpay cannot present a JWT, so authenticity comes from the HMAC over the
 * raw body instead. The account, though, comes from *this route* — not from
 * whichever secret matched — so that a secret shared between two dashboards
 * could never route one account's payments into the other's lookup.
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
    account: RAZORPAY_ACCOUNTS.VENDOR,
    sourceIp: req.headers["x-forwarded-for"] || req.socket?.remoteAddress,
  });
  return sendSuccess(res, 200, "Webhook received", result);
});
